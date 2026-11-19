import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  giveSkills,
  openCodeSkillNames,
  openCodeSkillPaths,
  pruneGivenSkills,
} from '../src/agents/given-skills';
import { sharedSkillReach } from '../src/domain/schema-reach';
import { agentIds } from '../src/domain/types';

const posix = { skip: process.platform === 'win32' && 'POSIX links' };

async function writeSkill(root: string, name: string, body = 'Do it.') {
  await mkdir(path.join(root, name), { recursive: true });
  await writeFile(
    path.join(root, name, 'SKILL.md'),
    `---\nname: ${name}\ndescription: The ${name} skill.\n---\n\n${body}\n`,
  );
  return path.join(root, name);
}

test('every CLI has a way the shared Schema skills reach it (ADR 066)', () => {
  assert.deepEqual(Object.keys(sharedSkillReach).sort(), [...agentIds].sort());
});

test(
  'given skills: links, or copies; the first of a name wins, skipped names stay out',
  posix,
  async (t) => {
    const base = await mkdtemp(path.join(tmpdir(), 'irori given skills '));
    t.after(() => rm(base, { recursive: true, force: true }));
    const data = path.join(base, 'data');
    const shared = path.join(base, 'shared');
    const alpha = await writeSkill(shared, 'alpha', 'ALPHA');
    const beta = await writeSkill(shared, 'beta');
    await writeFile(path.join(alpha, 'template.md'), 'TEMPLATE\n');
    // A link inside a skill, and one that leads nowhere.
    await writeFile(path.join(base, 'outside.md'), 'OUTSIDE\n');
    await symlink(path.join(base, 'outside.md'), path.join(alpha, 'outside.md'));
    await symlink(path.join(base, 'missing.md'), path.join(alpha, 'missing.md'));
    const skills = [
      { name: 'alpha', folder: alpha },
      { name: 'alpha', folder: beta },
      { name: 'beta', folder: beta },
      { name: 'own', folder: beta },
    ];
    const linked = await giveSkills(data, 'conversation-1', skills, new Set(['own']), false);
    assert.deepEqual(linked, {
      root: path.join(data, 'given-skills', 'conversation-1'),
      skills: path.join(data, 'given-skills', 'conversation-1', '.agents', 'skills'),
      names: ['alpha', 'beta'],
    });
    assert.equal(await readlink(path.join(linked!.skills, 'alpha')), alpha);
    assert.equal(await readlink(path.join(linked!.skills, 'beta')), beta);
    // A copy holds the skill's other files too, the contents of a link inside it
    // and not the link, and changing it leaves the shared Schema be.
    const copied = await giveSkills(data, 'conversation-2', skills, new Set(['beta', 'own']), true);
    assert.deepEqual(copied!.names, ['alpha']);
    const copy = path.join(copied!.skills, 'alpha');
    assert.ok((await lstat(copy)).isDirectory());
    assert.equal(await readFile(path.join(copy, 'template.md'), 'utf8'), 'TEMPLATE\n');
    assert.ok((await lstat(path.join(copy, 'outside.md'))).isFile());
    assert.equal(await readFile(path.join(copy, 'outside.md'), 'utf8'), 'OUTSIDE\n');
    assert.deepEqual((await readdir(copy)).sort(), ['SKILL.md', 'outside.md', 'template.md']);
    await writeFile(path.join(copy, 'SKILL.md'), 'changed\n');
    await writeFile(path.join(copy, 'outside.md'), 'changed\n');
    assert.match(await readFile(path.join(alpha, 'SKILL.md'), 'utf8'), /ALPHA/);
    assert.equal(await readFile(path.join(base, 'outside.md'), 'utf8'), 'OUTSIDE\n');
    // Given again in the same conversation: the same place, holding only what is given now.
    const again = await giveSkills(data, 'conversation-2', skills, new Set(['alpha', 'own']), true);
    assert.equal(again!.skills, copied!.skills);
    assert.deepEqual(await readdir(again!.skills), ['beta']);
    // Nothing left to give: no folder, and none left from before.
    assert.equal(
      await giveSkills(data, 'conversation-1', skills, new Set(['alpha', 'beta', 'own']), false),
      undefined,
    );
    assert.deepEqual(await readdir(path.join(data, 'given-skills')), ['conversation-2']);
    // Folders of conversations no longer running are removed; a running one's stays.
    await giveSkills(data, 'conversation-3', skills, new Set(), false);
    await pruneGivenSkills(data, (id) => id === 'conversation-2');
    assert.deepEqual(await readdir(path.join(data, 'given-skills')), ['conversation-2']);
  },
);

test("OpenCode's other skill folders keep their names from the shared Schema", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'irori opencode skills '));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeSkill(path.join(root, '.claude', 'skills'), 'from-claude');
  await writeSkill(path.join(root, '.opencode', 'skills'), 'from-opencode');
  await writeSkill(path.join(root, '.opencode', 'skill'), 'from-singular');
  await writeFile(path.join(root, '.opencode', 'skills', 'not-a-skill.md'), '');
  assert.deepEqual((await openCodeSkillNames(root)).sort(), [
    'from-claude',
    'from-opencode',
    'from-singular',
  ]);
});

test("irori's OpenCode plugin adds its folders to the person's skill paths", async (t) => {
  const data = await mkdtemp(path.join(tmpdir(), 'irori opencode plugin '));
  t.after(() => rm(data, { recursive: true, force: true }));
  const env = await openCodeSkillPaths(data, ['/given/skills'], {
    OPENCODE_CONFIG_CONTENT: JSON.stringify({ plugin: ['/other/plugin.js'], agent: { a: {} } }),
  });
  const content = JSON.parse(env.OPENCODE_CONFIG_CONTENT!);
  // Other plugins and settings stay; no skill path is set that would replace the person's.
  assert.equal(content.plugin[0], '/other/plugin.js');
  assert.deepEqual(content.agent, { a: {} });
  assert.equal(content.skills, undefined);
  const plugin = await import(pathToFileURL(content.plugin[1]).href);
  const old = process.env.IRORI_SKILL_PATHS;
  process.env.IRORI_SKILL_PATHS = env.IRORI_SKILL_PATHS;
  t.after(() => {
    if (old === undefined) delete process.env.IRORI_SKILL_PATHS;
    else process.env.IRORI_SKILL_PATHS = old;
  });
  const hooks = await plugin.IroriSkillPaths({});
  const own = { skills: { paths: ['~/my-skills'], urls: ['https://example.com/skills'] } };
  await hooks.config(own);
  assert.deepEqual(own.skills, {
    paths: ['~/my-skills', '/given/skills'],
    urls: ['https://example.com/skills'],
  });
  const none: { skills?: { paths: string[] } } = {};
  await hooks.config(none);
  assert.deepEqual(none.skills, { paths: ['/given/skills'] });
});
