import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  maxSkillBytes,
  maxSkills,
  promptWithSkill,
  retirementNotice,
  skillVisible,
  skillsRoot,
} from '../src/domain/skills';
import { skillReachRules, userSkillRoots } from '../src/domain/skill-reach';
import { FileService } from '../src/host/files';
import {
  parseRetired,
  parseSkill,
  readSkillReach,
  readSkills,
  requireSkill,
} from '../src/host/skills';
import { messageInput } from '../src/domain/conversation';

const body = (
  name: string,
  description = 'Does one bounded thing.',
  instructions = '# Steps\n\n1. Read.',
) => `---\nname: ${name}\ndescription: ${description}\n---\n\n${instructions}\n`;
const retiredBody =
  '---\nretired: 2026-09-21\nreason: Folded into journal.\nreplacement: journal\n---\n';

test('A skill package declares a name matching its directory, a description and instructions', () => {
  const skill = parseSkill('capture', body('capture'));
  assert.equal(skill.name, 'capture');
  assert.equal(skill.description, 'Does one bounded thing.');
  assert.equal(skill.instructions, '# Steps\n\n1. Read.');
  assert.equal(skill.path, '.agents/skills/capture/SKILL.md');
  assert.deepEqual([skill.roles, skill.projects], [[], []], 'unscoped by default');

  // A BOM, CRLF, quoted values and ordinary YAML metadata are valid authoring.
  const quoted = parseSkill(
    'journal',
    '﻿---\r\nname: "journal"\r\ndescription: >-\r\n  Writes yesterday\'s\r\n  journal.\r\nmetadata:\r\n  owner: user\r\n---\r\nBody\r\n',
  );
  assert.equal(quoted.description, "Writes yesterday's journal.");
  assert.equal(quoted.instructions, 'Body');

  for (const [text, reason] of [
    ['no front matter at all', /front matter/],
    ['---\ndescription: d\n---\nB', /name/],
    ['---\nname: capture\n---\nB', /description/],
    ['---\nname: other\ndescription: d\n---\nB', /does not match its directory/],
    ['---\nname: capture\nname: capture\ndescription: d\n---\nB', /unique/i],
    ['---\nname: capture\ndescription:\n  nested: value\n---\nB', /description/],
    ['---\nname: capture\ndescription: d\n---\n   \n', /no instructions/],
    [`---\nname: capture\ndescription: ${'d'.repeat(401)}\n---\nB`, /400/],
  ] as const)
    assert.throws(() => parseSkill('capture', text), reason, text.slice(0, 30));

  assert.throws(() => parseSkill('Capture', body('Capture')), /lowercase/);
  assert.throws(
    () => parseSkill('capture', body('capture', 'd', 'x'.repeat(maxSkillBytes))),
    /at most/,
  );
  assert.throws(
    () => parseSkill('capture', body('capture', 'd', 'あ'.repeat(Math.ceil(maxSkillBytes / 3)))),
    /bytes/,
    'the package limit is measured as UTF-8 bytes, not JavaScript characters',
  );
  assert.equal(
    parseSkill('capture', '---\n# a comment\nname: capture\ndescription: d\n---\nB').name,
    'capture',
  );
});

test('A skill may name the roles and projects it is for, and a reader who chose one sees it', () => {
  // The Agent Skills convention keeps metadata values as strings; a list is tolerated.
  const scoped = parseSkill(
    'promote',
    '---\nname: promote\ndescription: d\nmetadata:\n  roles: editor, 研究者\n  projects:\n    - thesis\n---\nB',
  );
  assert.deepEqual(scoped.roles, ['editor', '研究者']);
  assert.deepEqual(scoped.projects, ['thesis']);
  assert.throws(
    () =>
      parseSkill(
        'promote',
        '---\nname: promote\ndescription: d\nmetadata:\n  roles: a b/c\n---\nB',
      ),
    /role or project/,
  );

  const everyone = { ...scoped, roles: [], projects: [] };
  const editors = { ...scoped, roles: ['editor'], projects: [] };
  const thesis = { ...scoped, roles: ['editor'], projects: ['thesis'] };
  assert.equal(skillVisible(everyone, {}), true);
  assert.equal(skillVisible(everyone, { role: 'pm', project: 'other' }), true);
  assert.equal(skillVisible(editors, {}), true, 'no choice means no narrowing');
  assert.equal(skillVisible(editors, { role: 'editor' }), true);
  assert.equal(skillVisible(editors, { role: 'pm' }), false);
  assert.equal(skillVisible(thesis, { role: 'editor' }), true);
  assert.equal(skillVisible(thesis, { role: 'editor', project: 'other' }), false);
  assert.equal(skillVisible(thesis, { role: 'pm', project: 'thesis' }), false);
});

test('A retirement marker says when, why and what replaces a skill, and never looks like one', () => {
  const old = parseRetired('old', retiredBody);
  assert.deepEqual(old, {
    name: 'old',
    retired: '2026-09-21',
    reason: 'Folded into journal.',
    replacement: 'journal',
    path: '.agents/skills/old/RETIRED.md',
  });
  assert.equal(
    retirementNotice(old),
    'old スキルは 2026-09-21 に退役しました: Folded into journal.（代わりに journal）',
  );
  assert.equal(
    parseRetired('old', '---\nretired: 2026-09-21\nreason: r\n---\nWhy.\n').replacement,
    undefined,
  );
  for (const [text, reason] of [
    ['---\nretired: yesterday\nreason: r\n---\n', /YYYY-MM-DD/],
    ['---\nretired: 2026-09-21\n---\n', /reason/],
    ['---\nretired: 2026-09-21\nreason: r\nreplacement: ../x\n---\n', /lowercase/],
    // Pi loads a nested .md under .agents/skills as a skill once it has a description.
    ['---\nretired: 2026-09-21\nreason: r\ndescription: d\n---\n', /must not declare/],
    ['---\nretired: 2026-09-21\nreason: r\nname: old\n---\n', /must not declare/],
    ['Just prose.', /front matter/],
  ] as const)
    assert.throws(() => parseRetired('old', text), reason, text);
});

test("The chosen skill precedes the request and is named as this KB's own content", () => {
  const skill = parseSkill('distill', body('distill'));
  const composed = promptWithSkill(skill, 'Sort out yesterday.');
  assert(
    composed.indexOf('# Steps') < composed.indexOf('Sort out yesterday.'),
    'the request stays last',
  );
  assert(composed.includes('.agents/skills/distill/SKILL.md'), 'the source is stated');
  assert(composed.includes('from .agents/skills/distill/'), 'package-relative paths have a base');
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

  assert.deepEqual(await readSkills(files, space.scopeId), {
    skills: [],
    retired: [],
    problems: [],
  });

  const pkg = async (name: string, text?: string) => {
    await mkdir(path.join(root, skillsRoot, name), { recursive: true });
    if (text !== undefined) await writeFile(path.join(root, skillsRoot, name, 'SKILL.md'), text);
  };
  await pkg('promote', body('promote'));
  await pkg('capture', body('capture'));
  await pkg('empty');
  await pkg('broken', '---\nname: mismatch\ndescription: d\n---\nB');
  for (let index = 0; index < maxSkills; index++)
    await pkg(`a-empty-${String(index).padStart(2, '0')}`);
  await pkg('z-last', body('z-last'));

  const listing = await readSkills(files, space.scopeId);
  assert.deepEqual(
    listing.skills.map((skill) => skill.name),
    ['capture', 'promote', 'z-last'],
    'sorted, and directories without SKILL.md do not consume the package limit',
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
    assert.equal(aliased.skills.length, 3, 'an alias never becomes a skill');

    await symlink(
      path.join(root, skillsRoot, 'capture'),
      path.join(root, skillsRoot, 'linked'),
      'dir',
    );
    const linked = await readSkills(files, space.scopeId);
    assert.deepEqual(
      linked.problems.map((problem) => problem.directory),
      ['.agents/skills/broken', '.agents/skills/linked'],
      'an aliased package directory is reported rather than silently omitted',
    );
    assert(linked.problems.every((problem) => /alias/.test(problem.message)));
  }
});

test('A retired skill is listed with its reason, refused for a run, and checked against user-scope copies', async (t) => {
  const base = await mkdtemp(path.join(tmpdir(), 'irori retired skills '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const root = path.join(base, 'KB');
  await mkdir(root);
  const space = await files.register(root, 'Knowledge', 'personal');
  const write = async (relative: string, text: string) => {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), text);
  };
  await write(`${skillsRoot}/capture/SKILL.md`, body('capture'));
  await write(`${skillsRoot}/promote/SKILL.md`, body('promote'));
  await write(`${skillsRoot}/old/RETIRED.md`, retiredBody);
  // Retirement replaces SKILL.md; a package carrying both is neither offered nor retired.
  await write(`${skillsRoot}/both/SKILL.md`, body('both'));
  await write(`${skillsRoot}/both/RETIRED.md`, retiredBody);

  const listing = await readSkills(files, space.scopeId);
  assert.deepEqual(
    listing.skills.map((skill) => skill.name),
    ['capture', 'promote'],
  );
  assert.deepEqual(listing.retired, [
    {
      name: 'old',
      retired: '2026-09-21',
      reason: 'Folded into journal.',
      replacement: 'journal',
      path: '.agents/skills/old/RETIRED.md',
    },
  ]);
  assert.deepEqual(
    listing.problems.map((problem) => problem.directory),
    ['.agents/skills/both'],
  );
  assert.match(listing.problems[0].message, /must not keep its SKILL.md/);
  await assert.rejects(
    () => requireSkill(files, space.scopeId, 'old'),
    /old スキルは 2026-09-21 に退役しました: Folded into journal\.（代わりに journal）/,
    'a run naming a retired skill fails with the reason, not as unknown',
  );
  await assert.rejects(() => requireSkill(files, space.scopeId, 'both'), /must not keep/);

  // A disposable home stands in for the user's; the real one is never read here.
  const home = path.join(base, 'home');
  const personal = async (dir: string, name: string, text?: string) => {
    await mkdir(path.join(home, dir, name), { recursive: true });
    if (text !== undefined) await writeFile(path.join(home, dir, name, 'SKILL.md'), text);
  };
  await personal('.claude/skills', 'capture', body('capture'));
  await personal('.agents/skills', 'old', body('old'));
  await personal('.codex/skills', 'promote');
  await personal('.pi/agent/skills', 'promote', body('promote'));
  const reach = await readSkillReach(files, space.scopeId, home);
  assert.deepEqual(reach.entries, [
    { name: 'capture', found: ['~/.claude/skills'] },
    { name: 'old', retired: 'Folded into journal.', found: ['~/.agents/skills'] },
    { name: 'promote', found: ['~/.pi/agent/skills'] },
  ]);
  assert.equal(JSON.stringify(reach).includes(home), false, 'no machine path leaves the host');
  assert.deepEqual(userSkillRoots, [
    '~/.agents/skills',
    '~/.codex/skills',
    '~/.claude/skills',
    '~/.config/opencode/skills',
    '~/.pi/agent/skills',
  ]);
  assert.ok(
    Object.values(skillReachRules).every((rule) => rule.user.every((dir) => dir.startsWith('~/'))),
  );
});
