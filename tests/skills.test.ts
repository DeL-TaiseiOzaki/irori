import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  maxSkillBytes,
  parseSkill,
  parseSkillFrontMatter,
  promptWithSkill,
  skillsRoot,
} from '../src/domain/skills';
import { FileService } from '../src/host/files';
import { readSkills, requireSkill } from '../src/host/skills';
import { messageInput } from '../src/domain/conversation';

const body = (
  name: string,
  description = 'Does one bounded thing.',
  instructions = '# Steps\n\n1. Read.',
) => `---\nname: ${name}\ndescription: ${description}\n---\n\n${instructions}\n`;

test('A skill package declares a name matching its directory, a description and instructions', () => {
  const skill = parseSkill('capture', body('capture'));
  assert.equal(skill.name, 'capture');
  assert.equal(skill.description, 'Does one bounded thing.');
  assert.equal(skill.instructions, '# Steps\n\n1. Read.');
  assert.equal(skill.path, '.agents/skills/capture/SKILL.md');

  // A BOM, CRLF and quoted values are ordinary authoring, not errors.
  const quoted = parseSkill(
    'journal',
    '﻿---\r\nname: "journal"\r\ndescription: \'Writes\'\r\n---\r\nBody\r\n',
  );
  assert.equal(quoted.description, 'Writes');
  assert.equal(quoted.instructions, 'Body');

  for (const [text, reason] of [
    ['no front matter at all', /front matter/],
    ['---\ndescription: d\n---\nB', /must declare name/],
    ['---\nname: capture\n---\nB', /must declare description/],
    ['---\nname: other\ndescription: d\n---\nB', /does not match its directory/],
    ['---\nname: capture\nname: capture\ndescription: d\n---\nB', /repeats name/],
    ['---\nname: capture\ndescription: d\n  nested:\n    deep: 1\n---\nB', /"key: value"/],
    ['---\nname: capture\ndescription: d\n---\n   \n', /no instructions/],
    [`---\nname: capture\ndescription: ${'d'.repeat(401)}\n---\nB`, /at most 400/],
  ] as const)
    assert.throws(() => parseSkill('capture', text), reason, text.slice(0, 30));

  assert.throws(() => parseSkill('Capture', body('Capture')), /lowercase/);
  assert.throws(
    () => parseSkill('capture', body('capture', 'd', 'x'.repeat(maxSkillBytes))),
    /at most/,
  );
  assert.deepEqual(parseSkillFrontMatter('---\n# a comment\n\nname: a\n---\nB'), { name: 'a' });
});

test("The chosen skill precedes the request and is named as this KB's own content", () => {
  const skill = parseSkill('distill', body('distill'));
  const composed = promptWithSkill(skill, 'Sort out yesterday.');
  assert(
    composed.indexOf('# Steps') < composed.indexOf('Sort out yesterday.'),
    'the request stays last',
  );
  assert(composed.includes('.agents/skills/distill/SKILL.md'), 'the source is stated');
  assert(composed.includes('schema layer'));
  // The run input accepts a skill name and refuses anything that is not one.
  assert.equal(messageInput.parse({ prompt: 'x', skill: 'distill' }).skill, 'distill');
  assert.equal(messageInput.parse({ prompt: 'x' }).skill, undefined);
  for (const skill of ['../escape', 'Capture', 'a b', ''])
    assert.throws(() => messageInput.parse({ prompt: 'x', skill }));
});

test('Skill listing is scoped to the schema layer, ordered, and reports what it could not read', async (t) => {
  const base = await mkdtemp(path.join(tmpdir(), 'irori skills 日本語 '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const root = path.join(base, 'KB');
  await mkdir(root);
  const space = await files.register(root, 'Knowledge', 'personal');

  assert.deepEqual(await readSkills(files, space.scopeId), { skills: [], problems: [] });

  const pkg = async (name: string, text?: string) => {
    await mkdir(path.join(root, skillsRoot, name), { recursive: true });
    if (text !== undefined) await writeFile(path.join(root, skillsRoot, name, 'SKILL.md'), text);
  };
  await pkg('promote', body('promote'));
  await pkg('capture', body('capture'));
  await pkg('empty');
  await pkg('broken', '---\nname: mismatch\ndescription: d\n---\nB');

  const listing = await readSkills(files, space.scopeId);
  assert.deepEqual(
    listing.skills.map((skill) => skill.name),
    ['capture', 'promote'],
    'sorted, and a directory without SKILL.md is not a skill',
  );
  assert.deepEqual(
    listing.problems.map((problem) => problem.directory),
    ['.agents/skills/broken'],
    'a malformed package is reported rather than silently dropped',
  );

  assert.equal((await requireSkill(files, space.scopeId, 'capture')).name, 'capture');
  await assert.rejects(() => requireSkill(files, space.scopeId, 'empty'), /スキルがありません/);
  await assert.rejects(() => requireSkill(files, space.scopeId, 'unknown'), /スキルがありません/);

  if (process.platform !== 'win32') {
    await rm(path.join(root, skillsRoot, 'broken', 'SKILL.md'));
    await symlink(
      path.join(root, '.irori', 'scope.json'),
      path.join(root, skillsRoot, 'broken', 'SKILL.md'),
    );
    const aliased = await readSkills(files, space.scopeId);
    assert.match(aliased.problems[0].message, /alias/);
    assert.equal(aliased.skills.length, 2, 'an alias never becomes a skill');
  }
});
