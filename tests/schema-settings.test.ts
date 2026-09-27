import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  readHooks,
  readSkillText,
  settingKind,
  writeHooks,
  writeSkillText,
  yamlString,
} from '../src/domain/schema-settings';
import { hostArguments } from '../src/domain/host-requests';
import { FileService, hash } from '../src/host/files';
import { SearchService } from '../src/host/search';
import { SchemaSettingsService } from '../src/host/schema-settings';
import { parseSkill } from '../src/host/skills';

test('Only the paths behind the Schema settings are settings', () => {
  for (const [relative, kind] of [
    ['AGENTS.md', 'instructions'],
    ['Knowledge_Base/projects/AGENTS.md', 'instructions'],
    ['.claude/rules/tone.md', 'rule'],
    ['.claude/rules/日本語 の規則.md', 'rule'],
    ['.claude/settings.json', 'settings'],
    ['.agents/skills/distill/SKILL.md', 'skill'],
    ['.agents/skills/distill/scripts/run.py', 'skill'],
    ['.agents/skills/distill/template.md', 'skill'],
  ] as const)
    assert.equal(settingKind(relative), kind, relative);
  for (const relative of [
    'README.md',
    'CLAUDE.md',
    '.claude/settings.local.json',
    '.claude/rules/nested/tone.md',
    '.claude/rules/tone.txt',
    '.claude/rules/.hidden.md',
    '.agents/skills/distill',
    '.agents/skills/Distill/SKILL.md',
    '.agents/skills/distill/RETIRED.md',
    '.agents/skills/distill/.env',
    '.agents/skills/distill/a/b/c/d/e.py',
    '.agents/skills/../skills/distill/SKILL.md',
    '.git/AGENTS.md',
    '.obsidian/AGENTS.md',
    'notes/../AGENTS.md',
    '/AGENTS.md',
    'notes\\AGENTS.md',
  ])
    assert.equal(settingKind(relative), undefined, relative);
});

test('A skill form writes name, description and instructions and keeps other metadata', () => {
  const before =
    '---\n# owned by the editors\nname: distill\ndescription: >-\n  Files yesterday\n  into the library.\nmetadata:\n  roles: editor\nlicense: MIT\n---\n\nOnly ever append.\n';
  assert.deepEqual(readSkillText(before), {
    name: 'distill',
    description: 'Files yesterday into the library.',
    body: 'Only ever append.',
    frontMatter: true,
  });
  const after = writeSkillText(before, {
    name: 'file-away',
    description: 'Files: yesterday, "quoted"',
    body: '\n# Steps\n\n1. Read.\n',
  });
  assert.equal(
    after,
    '---\n# owned by the editors\nname: file-away\ndescription: "Files: yesterday, \\"quoted\\""\nmetadata:\n  roles: editor\nlicense: MIT\n---\n\n# Steps\n\n1. Read.\n',
  );
  // The host's own YAML reader agrees with what the form wrote.
  const parsed = parseSkill('file-away', after);
  assert.equal(parsed.description, 'Files: yesterday, "quoted"');
  assert.deepEqual(parsed.roles, ['editor']);
  assert.equal(parsed.instructions, '# Steps\n\n1. Read.');

  const fresh = writeSkillText(undefined, {
    name: 'journal',
    description: '日付ごとに記録する',
    body: 'Append only.',
  });
  assert.equal(fresh, '---\nname: journal\ndescription: 日付ごとに記録する\n---\n\nAppend only.\n');
  assert.equal(parseSkill('journal', fresh).description, '日付ごとに記録する');
  assert.equal(readSkillText('Just prose.').frontMatter, false);
  for (const value of ['true', 'null', '42', ' padded', '- item', 'a: b', 'a #b', "it's"])
    assert.notEqual(yamlString(value), value, value);
  assert.equal(yamlString('Plain words, and more'), 'Plain words, and more');
});

test('Hooks are read from and written to .claude/settings.json without touching other keys', () => {
  const settings = JSON.stringify({
    permissions: { allow: ['Bash(npm test)'] },
    hooks: {
      PostToolUse: [
        {
          matcher: 'Edit|Write',
          hooks: [
            { type: 'command', command: 'npm run format', timeout: 30 },
            { type: 'command', command: 'npm run lint' },
          ],
        },
      ],
      Stop: [{ hooks: [{ type: 'prompt', prompt: 'Check the work' }] }],
    },
    model: 'opus',
  });
  const hooks = readHooks(settings);
  assert.deepEqual(hooks, [
    {
      event: 'PostToolUse',
      matcher: 'Edit|Write',
      type: 'command',
      command: 'npm run format',
      extra: { timeout: 30 },
    },
    {
      event: 'PostToolUse',
      matcher: 'Edit|Write',
      type: 'command',
      command: 'npm run lint',
      extra: {},
    },
    { event: 'Stop', type: 'prompt', command: '', extra: { prompt: 'Check the work' } },
  ]);
  // Unchanged entries write back the same structure.
  assert.deepEqual(JSON.parse(writeHooks(settings, hooks)), JSON.parse(settings));
  const edited = writeHooks(settings, [
    hooks[0],
    { event: 'SessionStart', type: 'command', command: 'cat NOTES.md', extra: {} },
    hooks[2],
  ]);
  assert.ok(edited.endsWith('}\n'));
  assert.ok(edited.includes('\n  "permissions": {\n'), 'two-space JSON');
  const value = JSON.parse(edited);
  assert.deepEqual(Object.keys(value), ['permissions', 'hooks', 'model'], 'key order is kept');
  assert.deepEqual(value.hooks, {
    PostToolUse: [
      {
        matcher: 'Edit|Write',
        hooks: [{ type: 'command', command: 'npm run format', timeout: 30 }],
      },
    ],
    SessionStart: [{ hooks: [{ type: 'command', command: 'cat NOTES.md' }] }],
    Stop: [{ hooks: [{ type: 'prompt', prompt: 'Check the work' }] }],
  });
  assert.deepEqual(JSON.parse(writeHooks(settings, [])), {
    permissions: { allow: ['Bash(npm test)'] },
    model: 'opus',
  });
  assert.equal(
    writeHooks(undefined, [{ event: 'Stop', type: 'command', command: 'echo done', extra: {} }]),
    '{\n  "hooks": {\n    "Stop": [\n      {\n        "hooks": [\n          {\n            "type": "command",\n            "command": "echo done"\n          }\n        ]\n      }\n    ]\n  }\n}\n',
  );
  assert.deepEqual(readHooks(undefined), []);
  assert.deepEqual(readHooks('{"model":"opus"}'), []);
  for (const text of [
    '[]',
    '{"hooks": []}',
    '{"hooks": {"Stop": {}}}',
    '{"hooks": {"Stop": [{"hooks": "echo"}]}}',
    '{"hooks": {"Stop": [{"hooks": [{"command": "echo"}]}]}}',
    '{"hooks": {"Stop": [{"matcher": 1, "hooks": []}]}}',
  ])
    assert.throws(() => readHooks(text), Error, text);
});

test('The host lists, writes and removes Schema settings only inside the brain', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'irori schema settings '));
  try {
    const root = path.join(base, 'KB');
    const outside = path.join(base, 'outside');
    await mkdir(path.join(root, 'Knowledge_Base', 'projects', 'alpha'), { recursive: true });
    await mkdir(path.join(root, '.agents', 'skills', 'distill', 'scripts'), { recursive: true });
    await mkdir(path.join(root, '.claude', 'rules'), { recursive: true });
    await mkdir(outside);
    await writeFile(path.join(root, 'AGENTS.md'), '# Always\n');
    await writeFile(path.join(root, 'Knowledge_Base', 'projects', 'AGENTS.md'), '# Projects\n');
    await writeFile(path.join(root, '.obsidian-AGENTS.md'), 'x');
    await writeFile(path.join(root, '.claude', 'rules', 'tone.md'), 'Be brief.\n');
    await writeFile(path.join(root, '.claude', 'rules', 'notes.txt'), 'not a rule');
    await writeFile(
      path.join(root, '.agents', 'skills', 'distill', 'SKILL.md'),
      '---\nname: distill\ndescription: d\n---\n\nB\n',
    );
    await writeFile(
      path.join(root, '.agents', 'skills', 'distill', 'scripts', 'run.py'),
      'print(1)\n',
    );
    await writeFile(path.join(root, '.agents', 'skills', 'distill', '.env'), 'SECRET=1\n');
    const files = new FileService(path.join(base, 'device'));
    await files.init();
    const space = await files.register(root, 'KB', 'personal');
    const id = space.scopeId;
    const service = new SchemaSettingsService(files, new SearchService(files));

    const listing = await service.list(id);
    assert.deepEqual(listing.instructions, ['AGENTS.md', 'Knowledge_Base/projects/AGENTS.md']);
    assert.deepEqual(listing.rules, ['.claude/rules/tone.md']);
    assert.deepEqual(listing.attachments, { distill: ['scripts/run.py'] });
    assert.ok(listing.folders.includes('Knowledge_Base/projects/alpha'));
    assert.ok(!listing.folders.includes('Knowledge_Base/projects'), 'already has instructions');
    assert.equal(listing.incomplete, undefined);
    assert.equal(listing.claudeSettings, false);

    // A .py file is text the form edits, though the note editor does not open it.
    const script = await service.read(id, '.agents/skills/distill/scripts/run.py');
    assert.equal(script.text, 'print(1)\n');
    const replaced = await service.write(id, script.path, 'print(2)\n', script.hash);
    assert.equal(replaced?.text, 'print(2)\n');
    await assert.rejects(service.write(id, script.path, 'print(3)\n', script.hash), /CONFLICT/);
    await assert.rejects(service.write(id, script.path, 'x', null), /既に|already exists/);

    // A new skill with an attached file creates its folders.
    const skill = await service.write(
      id,
      '.agents/skills/journal/SKILL.md',
      writeSkillText(undefined, { name: 'journal', description: 'Dated.', body: 'Append.' }),
      null,
    );
    assert.ok(skill);
    await service.write(id, '.agents/skills/journal/templates/day.md', '# Day\n', null);
    assert.equal(
      await readFile(path.join(root, '.agents/skills/journal/templates/day.md'), 'utf8'),
      '# Day\n',
    );
    // Renaming the package moves its files; the new name must be free.
    await assert.rejects(service.moveSkill(id, 'journal', 'distill'), /既に|already exists/);
    await service.moveSkill(id, 'journal', 'diary');
    assert.deepEqual((await readdir(path.join(root, '.agents/skills'))).sort(), [
      'diary',
      'distill',
    ]);
    // Deleting the last file of a subfolder removes the folder, not the package.
    const day = await service.read(id, '.agents/skills/diary/templates/day.md');
    assert.equal(await service.write(id, day.path, null, day.hash), null);
    assert.deepEqual((await readdir(path.join(root, '.agents/skills/diary'))).sort(), ['SKILL.md']);
    await service.moveSkill(id, 'diary', null);
    assert.deepEqual(await readdir(path.join(root, '.agents/skills')), ['distill']);

    // Rules, settings and a folder's instructions.
    await service.write(id, '.claude/settings.json', '{}\n', null);
    await service.write(id, 'Knowledge_Base/projects/alpha/AGENTS.md', '# Alpha\n', null);
    const tone = await service.read(id, '.claude/rules/tone.md');
    await service.write(id, tone.path, null, tone.hash);
    assert.equal((await service.list(id)).claudeSettings, true);
    assert.deepEqual((await service.list(id)).instructions, [
      'AGENTS.md',
      'Knowledge_Base/projects/AGENTS.md',
      'Knowledge_Base/projects/alpha/AGENTS.md',
    ]);

    // Nothing else is reachable, and no alias leads out of the brain.
    for (const relative of [
      'README.md',
      '.git/config',
      '.claude/settings.local.json',
      '.agents/skills/distill/.env',
      '.agents/skills/distill/RETIRED.md',
      '.irori/scope.json',
    ])
      await assert.rejects(
        service.write(id, relative, 'x', null),
        /変更できません|cannot be changed/,
        relative,
      );
    await symlink(outside, path.join(root, '.agents', 'skills', 'escape'));
    await assert.rejects(
      service.write(id, '.agents/skills/escape/SKILL.md', 'x', null),
      /変更できません|cannot be changed/,
    );
    await assert.rejects(service.moveSkill(id, 'escape', null), /変更できません|cannot be changed/);
    await symlink(path.join(outside, 'AGENTS.md'), path.join(root, 'Knowledge_Base', 'AGENTS.md'));
    await assert.rejects(
      service.write(id, 'Knowledge_Base/AGENTS.md', 'x', hash('')),
      /通常のファイル|ordinary file/,
    );
    assert.deepEqual(await readdir(outside), []);
    await assert.rejects(
      service.read(id, '.agents/skills/distill/.env'),
      /変更できません|cannot be changed/,
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('The Schema settings requests cross the boundary validated', () => {
  const id = '6f3b3f9e-1111-4a2b-9c3d-0123456789ab';
  const version = 'a'.repeat(64);
  assert.equal(hostArguments.writeSchemaFile.safeParse([id, 'AGENTS.md', 'x', null]).success, true);
  assert.equal(
    hostArguments.writeSchemaFile.safeParse([id, 'AGENTS.md', null, version]).success,
    true,
  );
  assert.equal(
    hostArguments.writeSchemaFile.safeParse([id, 'AGENTS.md', 'x', 'nope']).success,
    false,
  );
  assert.equal(hostArguments.moveSkill.safeParse([id, 'distill', null]).success, true);
  assert.equal(hostArguments.moveSkill.safeParse([id, 'distill', '../x']).success, false);
  assert.equal(hostArguments.moveSkill.safeParse([id, '../x', 'distill']).success, false);
});
