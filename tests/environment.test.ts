import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { FileService } from '../src/host/files';
import { WorkspaceService } from '../src/host/workspaces';
import { SettingsService } from '../src/host/settings';
import { EnvironmentService } from '../src/host/environment';
import { reversibleStorage, SecretStore } from '../src/host/keystore';
import { GitService } from '../src/git/service';
import { GitHubCli } from '../src/git/github';
import { GitProcess } from '../src/git/process';
import { setLanguage } from '../src/domain/i18n';
import { fakeGh, git, remote } from './fixtures/github';
import { iroriAgentSkills, yourAiStarter } from '../prompts';

// Messages are matched in English.
setLanguage('en');

/** One device: its own data folder, services and parent for clones. */
async function device(base: string, name: string, gh: string) {
  const dir = path.join(base, name);
  const files = new FileService(path.join(dir, 'data'));
  await files.init();
  const workspaces = new WorkspaceService(files);
  const settings = new SettingsService(files.dataDir);
  const github = new GitHubCli(async () => gh);
  const service = new GitService(
    files,
    () => true,
    undefined,
    new GitProcess('git', async () => undefined),
    github,
  );
  const agentRoot = path.join(dir, 'irori', 'you');
  // A store that protects nothing stands in for the OS key, as in the UI smokes.
  const secrets = new SecretStore(path.join(dir, 'data', 'secrets.json'), reversibleStorage);
  const environment = new EnvironmentService({
    secrets,
    files,
    workspaces,
    github,
    git: service,
    settings,
    agentRoot: async () => agentRoot,
    register: (root, label, category) => files.register(root, label, category),
    defaultParent: async () => path.join(dir, 'irori'),
    appVersion: '0.0.0-test',
    now: () => new Date('2026-10-06T00:00:00.000Z'),
  });
  return { dir, files, workspaces, settings, service, environment, agentRoot, secrets };
}

async function fixture(t: any) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori environment 日本語 '));
  const kbScope = {
    schemaVersion: 1,
    scopeId: '0f7d5a3c-2b1e-4c9a-8d6f-1a2b3c4d5e6f',
    name: 'Research',
    category: 'personal',
    contents: ['contents'],
  };
  const kb = await remote(base, 'kb', {
    '.irori/scope.json': JSON.stringify(kbScope, null, 2) + '\n',
    '.gitignore': '/contents/\n',
    'knowledge/note.md': '# Note\n',
  });
  const you = await remote(base, 'you', { 'AGENTS.md': '# irori agent\n' });
  const globalConfig = path.join(base, 'gitconfig');
  await writeFile(
    globalConfig,
    `[user]\n\tname = Git fixture\n\temail = fixture@example.invalid\n[commit]\n\tgpgsign = false\n` +
      `[url "${kb.bare}"]\n\tinsteadOf = ${kb.url}\n[url "${you.bare}"]\n\tinsteadOf = ${you.url}\n`,
  );
  const previous = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = globalConfig;
  const fake = await fakeGh(base);
  const a = await device(base, 'a', fake.gh);
  const b = await device(base, 'b', fake.gh);
  t.after(async () => {
    await a.service.close();
    await b.service.close();
    if (previous === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previous;
    await rm(base, { recursive: true, force: true });
  });
  return { base, kb, you, kbScope, fake, a, b };
}

/** Device A: a GitHub vault, a plain folder, a workspace and group, a dark theme, an agent repository. */
async function deviceA(f: Awaited<ReturnType<typeof fixture>>) {
  const checkout = path.join(f.a.dir, 'irori', 'kb');
  await mkdir(path.dirname(checkout), { recursive: true });
  git(f.a.dir, 'clone', '--quiet', f.kb.url, checkout);
  const research = await f.a.files.register(checkout, 'ignored', 'personal');
  const plainRoot = path.join(f.a.dir, 'Local notes');
  await mkdir(plainRoot, { recursive: true });
  const plain = await f.a.files.register(plainRoot, 'Local notes', 'personal');
  const lab = await f.a.workspaces.save('Lab', [research.scopeId, plain.scopeId]);
  await f.a.workspaces.saveGroups(lab.id, [
    {
      id: '6c1f0a52-8d3b-4e7a-9f21-0b5c4d3e2a19',
      name: 'Both',
      scopeIds: [research.scopeId, plain.scopeId],
      open: true,
    },
  ]);
  await f.a.settings.save({ theme: 'dark', language: 'en', layouts: { device: 'only' } });
  git(f.a.dir, 'clone', '--quiet', f.you.url, f.a.agentRoot);
  return { research, plain, lab };
}

test('a device saves its GitHub vaults, workspaces and preferences to a private repository', async (t) => {
  const f = await fixture(t);
  const { research, plain, lab } = await deviceA(f);
  assert.equal(research.scopeId, f.kbScope.scopeId);

  const before = await f.a.environment.state();
  assert.equal(before.account, 'octo');
  assert.equal(before.saved, undefined);
  assert.deepEqual(before.local, {
    vaults: 1,
    left: ['Local notes'],
    agent: 'octo/you',
    routines: 0,
    routinesLeft: [],
    agentFiles: 1,
    agentFilesLeft: [],
    secrets: [],
    secretsAvailable: true,
  });
  // Looking creates nothing on the account.
  assert.ok(!(await f.fake.calls()).some((call) => call.includes('POST')));

  const after = await f.a.environment.save();
  assert.equal(
    await readFile(path.join(f.fake.github, 'octo', 'irori-settings', '.private'), 'utf8'),
    'true',
  );
  const saved = JSON.parse(await f.fake.stored());
  assert.deepEqual(saved.vaults, [
    { scopeId: research.scopeId, name: 'Research', repository: 'octo/kb' },
  ]);
  // The plain folder cannot be restored elsewhere, so it leaves the workspace and its group.
  assert.deepEqual(saved.workspaces, [
    {
      id: lab.id,
      name: 'Lab',
      scopeIds: [research.scopeId],
      groups: [
        {
          id: '6c1f0a52-8d3b-4e7a-9f21-0b5c4d3e2a19',
          name: 'Both',
          scopeIds: [research.scopeId],
          open: true,
        },
      ],
    },
  ]);
  assert.ok(!JSON.stringify(saved).includes(plain.scopeId));
  assert.equal(saved.preferences.theme, 'dark');
  assert.equal(saved.preferences.language, 'en');
  assert.equal('layouts' in saved.preferences, false);
  assert.deepEqual(saved.agent, { repository: 'octo/you' });
  // No folder of this device goes to GitHub.
  assert.ok(!JSON.stringify(saved).includes(f.base));
  assert.equal(after.saved?.savedAt, '2026-10-06T00:00:00.000Z');
  assert.deepEqual(
    after.saved?.vaults.map((item) => item.here),
    [true],
  );
  assert.deepEqual(after.saved?.workspaces, ['Lab']);
  // With no routine in the irori agent's folder, no routines file is made.
  await assert.rejects(f.fake.stored('routines.json'));

  // A second save replaces the file, naming the sha it read.
  await f.a.environment.save();
  const puts = (await f.fake.calls()).filter((call) => call.includes('PUT'));
  // Each save writes the environment and the irori agent's files.
  assert.equal(puts.filter((call) => call.includes('environment.json')).length, 2);
  assert.equal(puts.filter((call) => call.includes('irori-agent.json')).length, 2);
  assert.equal(puts.length, 4);
  assert.equal((await f.fake.calls()).filter((call) => call.includes('POST')).length, 1);
});

test('another device restores the vaults, workspaces, preferences and irori agent', async (t) => {
  const f = await fixture(t);
  const { research, lab } = await deviceA(f);
  await f.a.environment.save();

  // Device B already has a workspace named Lab of its own.
  const ownRoot = path.join(f.b.dir, 'Own');
  await mkdir(ownRoot, { recursive: true });
  const own = await f.b.files.register(ownRoot, 'Own', 'personal');
  const ownLab = await f.b.workspaces.save('Lab', [own.scopeId]);

  const state = await f.b.environment.state();
  assert.deepEqual(state.saved?.vaults, [
    { scopeId: research.scopeId, name: 'Research', repository: 'octo/kb', here: false },
  ]);
  assert.deepEqual(state.saved?.agent, { repository: 'octo/you', here: false });
  assert.equal(state.parent, path.join(f.b.dir, 'irori'));

  const result = await f.b.environment.restore({ scopeIds: [research.scopeId], agent: true });
  assert.deepEqual(result, {
    restored: ['Research'],
    failed: [],
    workspaces: 1,
    routines: [],
    agentFiles: [],
    agentFilesKept: [],
    secrets: [],
    agent: 'restored',
  });
  const restored = f.b.files.list().find((space) => space.scopeId === research.scopeId);
  assert.equal(restored?.root, path.join(f.b.dir, 'irori', 'kb'));
  assert.equal(await readFile(path.join(f.b.agentRoot, 'AGENTS.md'), 'utf8'), '# irori agent\n');
  const profiles = await f.b.workspaces.list();
  assert.deepEqual(
    profiles.map((item) => [item.id, item.name, item.scopeIds]),
    [
      [ownLab.id, 'Lab', [own.scopeId]],
      [lab.id, 'Lab (2)', [research.scopeId]],
    ],
  );
  const settings = await f.b.settings.read();
  assert.equal(settings.theme, 'dark');
  assert.equal(settings.language, 'en');
  assert.deepEqual(settings.layouts, {});

  // Everything is here now: a second restore changes nothing.
  const again = await f.b.environment.restore({ scopeIds: [research.scopeId], agent: true });
  assert.deepEqual(again, {
    restored: [],
    failed: [],
    workspaces: 0,
    routines: [],
    agentFiles: [],
    agentFilesKept: [],
    secrets: [],
    agent: 'unchanged',
  });
  assert.deepEqual(
    (await f.b.environment.state()).saved?.vaults.map((item) => item.here),
    [true],
  );
});

test('restoring keeps what is in the way and reports it', async (t) => {
  const f = await fixture(t);
  const { research } = await deviceA(f);
  await f.a.environment.save();
  // A different folder where the clone would go, and an irori agent folder with other files.
  await mkdir(path.join(f.b.dir, 'irori', 'kb'), { recursive: true });
  await writeFile(path.join(f.b.dir, 'irori', 'kb', 'mine.md'), 'mine\n');
  await mkdir(f.b.agentRoot, { recursive: true });
  await writeFile(path.join(f.b.agentRoot, 'notes.md'), 'mine\n');

  const result = await f.b.environment.restore({ scopeIds: [research.scopeId], agent: true });
  assert.deepEqual(result.restored, []);
  assert.deepEqual(
    result.failed.map((item) => item.name),
    ['Research', 'irori agent'],
  );
  assert.equal(result.agent, 'failed');
  assert.equal(await readFile(path.join(f.b.dir, 'irori', 'kb', 'mine.md'), 'utf8'), 'mine\n');
  assert.equal(await readFile(path.join(f.b.agentRoot, 'notes.md'), 'utf8'), 'mine\n');

  // An unselected vault is not cloned; the workspace still comes, its vault unavailable.
  const other = await device(f.base, 'c', f.fake.gh);
  t.after(() => other.service.close());
  const skipped = await other.environment.restore({ scopeIds: [], agent: false });
  assert.deepEqual(skipped, {
    restored: [],
    failed: [],
    workspaces: 1,
    routines: [],
    agentFiles: [],
    agentFilesKept: [],
    secrets: [],
    agent: 'unchanged',
  });
  assert.equal(other.files.list().length, 0);
  assert.deepEqual((await other.workspaces.list())[0].scopeIds, [research.scopeId]);
});

/** Routines in device A's irori agent folder: a script, a binary file, and one holding a link. */
async function routinesA(f: Awaited<ReturnType<typeof fixture>>) {
  const dir = path.join(f.a.agentRoot, 'routines');
  await mkdir(path.join(dir, 'Inbox', 'lib'), { recursive: true });
  await writeFile(
    path.join(dir, 'Inbox', 'routine.yaml'),
    'name: 受信箱\nsteps:\n  - run: fetch.sh\n',
  );
  await writeFile(path.join(dir, 'Inbox', 'fetch.sh'), '#!/bin/sh\necho ok\n');
  await chmod(path.join(dir, 'Inbox', 'fetch.sh'), 0o755);
  await writeFile(path.join(dir, 'Inbox', 'lib', 'icon.bin'), Buffer.from([0, 255, 1, 2]));
  await mkdir(path.join(dir, 'Linked'), { recursive: true });
  await writeFile(path.join(dir, 'Linked', 'routine.yaml'), 'name: Linked\nsteps: []\n');
  await symlink(path.join(f.base, 'gitconfig'), path.join(dir, 'Linked', 'config'));
  // A folder without routine.yaml is not a routine.
  await mkdir(path.join(dir, 'drafts'), { recursive: true });
  await writeFile(path.join(dir, 'drafts', 'note.md'), 'draft\n');
}

test("the irori agent's routines and the routine runtimes travel with the environment", async (t) => {
  const f = await fixture(t);
  await deviceA(f);
  await routinesA(f);
  await f.a.settings.save({ routineRuntimes: ['javascript'] });

  const before = await f.a.environment.state();
  assert.equal(before.local.routines, 1);
  // A routine holding a link is left out, as a run would refuse it.
  assert.deepEqual(before.local.routinesLeft, ['Linked']);
  await f.a.environment.save();
  const saved = JSON.parse(await f.fake.stored('routines.json'));
  assert.deepEqual(saved.routines, [
    {
      folder: 'Inbox',
      name: '受信箱',
      files: [
        { path: 'fetch.sh', text: '#!/bin/sh\necho ok\n', executable: true },
        { path: 'lib/icon.bin', base64: Buffer.from([0, 255, 1, 2]).toString('base64') },
        { path: 'routine.yaml', text: 'name: 受信箱\nsteps:\n  - run: fetch.sh\n' },
      ],
    },
  ]);
  assert.ok(!JSON.stringify(saved).includes(f.base));
  assert.deepEqual(JSON.parse(await f.fake.stored()).preferences.routineRuntimes, ['javascript']);

  // Device B restores the irori agent's folder by cloning it, then adds the routine to it.
  const state = await f.b.environment.state();
  assert.deepEqual(state.saved?.routines, [{ folder: 'Inbox', name: '受信箱', here: false }]);
  const result = await f.b.environment.restore({ scopeIds: [], agent: true, routines: ['Inbox'] });
  assert.deepEqual(result.routines, ['受信箱']);
  assert.deepEqual(result.failed, []);
  const added = path.join(f.b.agentRoot, 'routines', 'Inbox');
  assert.equal(await readFile(path.join(added, 'fetch.sh'), 'utf8'), '#!/bin/sh\necho ok\n');
  assert.deepEqual([...(await readFile(path.join(added, 'lib', 'icon.bin')))], [0, 255, 1, 2]);
  if (process.platform !== 'win32')
    assert.ok((await stat(path.join(added, 'fetch.sh'))).mode & 0o100);
  assert.deepEqual((await f.b.settings.read()).routineRuntimes, ['javascript']);
  assert.deepEqual(
    (await f.b.environment.state()).saved?.routines.map((item) => item.here),
    [true],
  );

  // A routine folder already here is left as it is.
  await writeFile(path.join(added, 'routine.yaml'), 'name: Mine\nsteps: []\n');
  const again = await f.b.environment.restore({ scopeIds: [], agent: true, routines: ['Inbox'] });
  assert.deepEqual(again.routines, []);
  assert.equal(await readFile(path.join(added, 'routine.yaml'), 'utf8'), 'name: Mine\nsteps: []\n');

  // Saving with no routines left empties the saved list instead of keeping the old one.
  await rm(path.join(f.a.agentRoot, 'routines'), { recursive: true });
  await f.a.environment.save();
  assert.deepEqual(JSON.parse(await f.fake.stored('routines.json')).routines, []);
});

test('routines are not added where the irori agent is not set up', async (t) => {
  const f = await fixture(t);
  await deviceA(f);
  await routinesA(f);
  await f.a.environment.save();

  const result = await f.b.environment.restore({ scopeIds: [], agent: false, routines: ['Inbox'] });
  assert.deepEqual(result.routines, []);
  assert.deepEqual(
    result.failed.map((item) => item.name),
    ['受信箱'],
  );
  // The folder stays absent, so the irori agent can still be set up there.
  await assert.rejects(stat(f.b.agentRoot));

  // A damaged routines file is read as an error, and never replaced by a save.
  const file = path.join(f.fake.github, 'octo', 'irori-settings', 'routines.json');
  await writeFile(file, '{"schemaVersion":1,"routines":[{"folder":"../x"}]}');
  await assert.rejects(f.b.environment.state(), /Could not read routines\.json/);
  await assert.rejects(f.a.environment.save(), /Could not read routines\.json/);
});

/** Writes files into a folder, making the folders on the way. */
async function put(root: string, files: Record<string, string | Buffer>) {
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await writeFile(path.join(root, rel), content);
  }
}

test("the irori agent's files and the shared Schema travel without a repository", async (t) => {
  const f = await fixture(t);
  // Device A's irori agent folder is not a repository.
  await put(f.a.agentRoot, {
    'AGENTS.md': '# My irori agent\n',
    '.agents/skills/irori-setup/SKILL.md':
      '---\nname: irori-setup\ndescription: Mine.\n---\n\nMine.\n',
    '.claude/rules/dates.md': 'Use YYYY-MM-DD.\n',
    '.irori/shared/AGENTS.md': '# Shared\n',
    '.irori/shared/.claude/rules/tone.md': 'Be brief.\n',
    '.irori/shared/.claude/settings.json': '{"hooks":{}}\n',
    'notes/plan.md': '# Plan\n',
    'bin/run.sh': '#!/bin/sh\necho ok\n',
    'assets/icon.bin': Buffer.from([0, 255, 1, 2]),
    // Past GitHub's limit for one file of the settings repository.
    'notes/big.txt': 'z'.repeat(950 * 1024),
    // Written for this device alone, or kept apart: these do not travel.
    '.claude/agents/vault-research.md': `---\nname: vault-research\n---\n\n${f.base}\n`,
    '.claude/settings.local.json': '{}\n',
    'node_modules/x/index.js': '',
    'routines/Inbox/routine.yaml': 'name: Inbox\nsteps: []\n',
  });
  await chmod(path.join(f.a.agentRoot, 'bin', 'run.sh'), 0o755);
  await symlink(path.join(f.base, 'gitconfig'), path.join(f.a.agentRoot, 'link.md'));

  const before = await f.a.environment.state();
  assert.equal(before.local.agent, undefined);
  assert.equal(before.local.agentFiles, 9);
  assert.deepEqual(before.local.agentFilesLeft, ['link.md', 'notes/big.txt']);
  await f.a.environment.save();
  const stored = JSON.parse(await f.fake.stored('irori-agent.json'));
  assert.deepEqual(
    stored.files.map((file: { path: string }) => file.path),
    [
      '.agents/skills/irori-setup/SKILL.md',
      '.claude/rules/dates.md',
      '.irori/shared/.claude/rules/tone.md',
      '.irori/shared/.claude/settings.json',
      '.irori/shared/AGENTS.md',
      'AGENTS.md',
      'assets/icon.bin',
      'bin/run.sh',
      'notes/plan.md',
    ],
  );
  assert.ok(!JSON.stringify(stored).includes(f.base));

  // Device B set its irori agent up with the starter, and wrote a plan of its own.
  for (const [rel, text] of Object.entries(yourAiStarter))
    await put(f.b.agentRoot, { [rel]: text });
  for (const [name, text] of Object.entries(iroriAgentSkills))
    await put(f.b.agentRoot, { [`.agents/skills/${name}/SKILL.md`]: text });
  await put(f.b.agentRoot, { 'notes/plan.md': '# Their plan\n' });
  const state = await f.b.environment.state();
  assert.deepEqual(state.saved?.agentFiles, { files: 9, missing: 6 });

  const result = await f.b.environment.restore({ scopeIds: [], agent: false, agentFiles: true });
  assert.deepEqual(result.failed, []);
  // What irori set up and nobody changed gives way; the person's own file stays.
  assert.deepEqual(result.agentFiles.sort(), [
    '.agents/skills/irori-setup/SKILL.md',
    '.claude/rules/dates.md',
    '.irori/shared/.claude/rules/tone.md',
    '.irori/shared/.claude/settings.json',
    '.irori/shared/AGENTS.md',
    'AGENTS.md',
    'assets/icon.bin',
    'bin/run.sh',
  ]);
  assert.deepEqual(result.agentFilesKept, ['notes/plan.md']);
  assert.equal(await readFile(path.join(f.b.agentRoot, 'AGENTS.md'), 'utf8'), '# My irori agent\n');
  assert.equal(
    await readFile(
      path.join(f.b.agentRoot, '.irori', 'shared', '.claude', 'rules', 'tone.md'),
      'utf8',
    ),
    'Be brief.\n',
  );
  assert.equal(
    await readFile(path.join(f.b.agentRoot, 'notes', 'plan.md'), 'utf8'),
    '# Their plan\n',
  );
  assert.deepEqual(
    [...(await readFile(path.join(f.b.agentRoot, 'assets', 'icon.bin')))],
    [0, 255, 1, 2],
  );
  if (process.platform !== 'win32')
    assert.ok((await stat(path.join(f.b.agentRoot, 'bin', 'run.sh'))).mode & 0o100);
  assert.deepEqual((await f.b.environment.state()).saved?.agentFiles, { files: 9, missing: 0 });

  // A device without the irori agent gets the whole folder, AGENTS.md included.
  const c = await device(f.base, 'c', f.fake.gh);
  t.after(() => c.service.close());
  const fresh = await c.environment.restore({ scopeIds: [], agent: false, agentFiles: true });
  assert.equal(fresh.agentFiles.length, 9);
  assert.equal(await readFile(path.join(c.agentRoot, 'AGENTS.md'), 'utf8'), '# My irori agent\n');

  // A folder holding other files but no irori agent is not written into.
  const d = await device(f.base, 'd', f.fake.gh);
  t.after(() => d.service.close());
  await put(d.agentRoot, { 'mine.md': 'mine\n' });
  const blocked = await d.environment.restore({ scopeIds: [], agent: false, agentFiles: true });
  assert.deepEqual(
    blocked.failed.map((item) => item.name),
    ['irori agent'],
  );
  await assert.rejects(stat(path.join(d.agentRoot, 'AGENTS.md')));

  // Saving from a device without the irori agent keeps the saved files.
  await d.environment.save();
  assert.equal(JSON.parse(await f.fake.stored('irori-agent.json')).files.length, 9);
});

test('routine secrets travel sealed with a passphrase, never as their values', async (t) => {
  const f = await fixture(t);
  await deviceA(f);
  const token = 'xoxb-1111-2222-abcdefghijkl';
  await f.a.secrets.update({ SLACK_TOKEN: token, GMAIL_TOKEN: 'gmail-refresh-0123456789' });
  const passphrase = 'correct horse battery';

  // Without a passphrase the secrets stay on the device.
  await f.a.environment.save();
  assert.equal(await f.fake.stored('routine-keys.json').catch(() => undefined), undefined);
  assert.deepEqual((await f.a.environment.state()).local.secrets, ['GMAIL_TOKEN', 'SLACK_TOKEN']);

  await f.a.environment.save(passphrase);
  const text = await f.fake.stored('routine-keys.json');
  const sealed = JSON.parse(text);
  assert.deepEqual(sealed.names, ['GMAIL_TOKEN', 'SLACK_TOKEN']);
  assert.equal(sealed.cipher, 'aes-256-gcm');
  // Neither the values, the device's own sealing nor the passphrase reach GitHub.
  const device = JSON.parse(await readFile(path.join(f.a.dir, 'data', 'secrets.json'), 'utf8'));
  for (const hidden of [token, 'gmail-refresh', passphrase, device.values.SLACK_TOKEN])
    assert.ok(!text.includes(hidden));
  for (const encoding of ['base64', 'hex'] as const)
    assert.ok(!text.includes(Buffer.from(token).toString(encoding)));

  // Device B already keeps a GMAIL_TOKEN of its own.
  await f.b.secrets.update({ GMAIL_TOKEN: 'device-b-own-value' });
  const state = await f.b.environment.state();
  assert.deepEqual(state.saved?.secrets, [
    { name: 'GMAIL_TOKEN', here: true },
    { name: 'SLACK_TOKEN', here: false },
  ]);
  // A wrong passphrase stops the restore before anything is cloned.
  await assert.rejects(
    f.b.environment.restore({
      scopeIds: [f.kbScope.scopeId],
      agent: false,
      secrets: ['SLACK_TOKEN'],
      passphrase: 'wrong horse battery',
    }),
    /passphrase does not open/,
  );
  assert.deepEqual(f.b.files.list(), []);
  await assert.rejects(
    f.b.environment.restore({ scopeIds: [], agent: false, secrets: ['SLACK_TOKEN'] }),
    /needs the passphrase/,
  );

  const result = await f.b.environment.restore({
    scopeIds: [],
    agent: false,
    secrets: ['SLACK_TOKEN', 'GMAIL_TOKEN'],
    passphrase,
  });
  assert.deepEqual(result.secrets, ['SLACK_TOKEN']);
  assert.deepEqual(await f.b.secrets.values(['SLACK_TOKEN', 'GMAIL_TOKEN']), {
    SLACK_TOKEN: token,
    GMAIL_TOKEN: 'device-b-own-value',
  });

  // A changed name list or sealed data no longer opens.
  const file = path.join(f.fake.github, 'octo', 'irori-settings', 'routine-keys.json');
  await writeFile(file, JSON.stringify({ ...sealed, names: ['GMAIL_TOKEN', 'OTHER_TOKEN'] }));
  await assert.rejects(
    f.b.environment.restore({ scopeIds: [], agent: false, secrets: ['OTHER_TOKEN'], passphrase }),
    /passphrase does not open/,
  );
  // A file asking for an unbounded key derivation is refused as damaged.
  await writeFile(file, JSON.stringify({ ...sealed, kdf: { ...sealed.kdf, N: 2 ** 24 } }));
  await assert.rejects(f.b.environment.state(), /Could not read routine-keys\.json/);

  // Saving again with a passphrase replaces the saved set with this device's.
  await writeFile(file, text);
  await f.b.environment.save('another long passphrase');
  const replaced = JSON.parse(await f.fake.stored('routine-keys.json'));
  assert.deepEqual(replaced.names, ['GMAIL_TOKEN', 'SLACK_TOKEN']);
  assert.notEqual(replaced.data, sealed.data);
});

test('a public settings repository, a newer file and a concurrent save are refused', async (t) => {
  const f = await fixture(t);
  await deviceA(f);
  await assert.rejects(
    f.b.environment.restore({ scopeIds: [], agent: false }),
    /no saved environment/i,
  );

  await f.a.environment.save();
  const stale = await f.b.environment.state();
  assert.ok(stale.saved);
  // Another device writes in between this device's read and write.
  const file = path.join(f.fake.github, 'octo', 'irori-settings', 'environment.json');
  const github = new GitHubCli(async () => f.fake.gh);
  const { sha } = (await github.readFile('octo/irori-settings', 'environment.json'))!;
  await writeFile(file, (await readFile(file, 'utf8')).replace('Lab', 'Lab B'));
  await assert.rejects(
    github.writeFile('octo/irori-settings', 'environment.json', '{}', 'x', sha),
    /Another device saved first/,
  );
  await github.close();

  await writeFile(file, JSON.stringify({ schemaVersion: 2 }));
  await assert.rejects(f.b.environment.state(), /newer irori/);
  await writeFile(file, 'not json');
  await assert.rejects(f.b.environment.state(), /Could not read environment\.json/);
  // A damaged file is never replaced by a save.
  await assert.rejects(f.a.environment.save(), /Could not read environment\.json/);
  assert.equal(await readFile(file, 'utf8'), 'not json');

  await writeFile(path.join(f.fake.github, 'octo', 'irori-settings', '.private'), 'false');
  await assert.rejects(f.a.environment.save(), /is public/);
  await assert.rejects(f.b.environment.state(), /is public/);
});

test('a GitHub answer larger than 64 KB arrives whole, with its multibyte text intact', async (t) => {
  const base = await mkdtemp(path.join(tmpdir(), 'irori gh answer '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const fake = await fakeGh(base);
  await mkdir(path.join(fake.github, 'octo', 'irori-settings'), { recursive: true });
  const text = JSON.stringify({ notes: '日本語のメモ'.repeat(20000) });
  await writeFile(path.join(fake.github, 'octo', 'irori-settings', 'environment.json'), text);
  const github = new GitHubCli(async () => fake.gh);
  t.after(() => github.close());
  const file = await github.readFile('octo/irori-settings', 'environment.json');
  assert.equal(file?.text, text);
});
