import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { FileService } from '../src/host/files';
import { WorkspaceService } from '../src/host/workspaces';
import { SettingsService } from '../src/host/settings';
import { EnvironmentService } from '../src/host/environment';
import { GitService } from '../src/git/service';
import { GitHubCli } from '../src/git/github';
import { GitProcess } from '../src/git/process';
import { setLanguage } from '../src/domain/i18n';
import { fakeGh, git, remote } from './fixtures/github';

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
  const environment = new EnvironmentService({
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
  return { dir, files, workspaces, settings, service, environment, agentRoot };
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

/** Device A: a GitHub hibachi, a plain folder, a workspace and group, a dark theme, an agent repository. */
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

test('a device saves its GitHub hibachis, workspaces and preferences to a private repository', async (t) => {
  const f = await fixture(t);
  const { research, plain, lab } = await deviceA(f);
  assert.equal(research.scopeId, f.kbScope.scopeId);

  const before = await f.a.environment.state();
  assert.equal(before.account, 'octo');
  assert.equal(before.saved, undefined);
  assert.deepEqual(before.local, { hibachis: 1, left: ['Local notes'], agent: 'octo/you' });
  // Looking creates nothing on the account.
  assert.ok(!(await f.fake.calls()).some((call) => call.includes('POST')));

  const after = await f.a.environment.save();
  assert.equal(
    await readFile(path.join(f.fake.github, 'octo', 'irori-settings', '.private'), 'utf8'),
    'true',
  );
  const saved = JSON.parse(await f.fake.stored());
  assert.deepEqual(saved.hibachis, [
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
    after.saved?.hibachis.map((item) => item.here),
    [true],
  );
  assert.deepEqual(after.saved?.workspaces, ['Lab']);

  // A second save replaces the file, naming the sha it read.
  await f.a.environment.save();
  const puts = (await f.fake.calls()).filter((call) => call.includes('PUT'));
  assert.equal(puts.length, 2);
  assert.equal((await f.fake.calls()).filter((call) => call.includes('POST')).length, 1);
});

test('another device restores the hibachis, workspaces, preferences and irori agent', async (t) => {
  const f = await fixture(t);
  const { research, lab } = await deviceA(f);
  await f.a.environment.save();

  // Device B already has a workspace named Lab of its own.
  const ownRoot = path.join(f.b.dir, 'Own');
  await mkdir(ownRoot, { recursive: true });
  const own = await f.b.files.register(ownRoot, 'Own', 'personal');
  const ownLab = await f.b.workspaces.save('Lab', [own.scopeId]);

  const state = await f.b.environment.state();
  assert.deepEqual(state.saved?.hibachis, [
    { scopeId: research.scopeId, name: 'Research', repository: 'octo/kb', here: false },
  ]);
  assert.deepEqual(state.saved?.agent, { repository: 'octo/you', here: false });
  assert.equal(state.parent, path.join(f.b.dir, 'irori'));

  const result = await f.b.environment.restore({ scopeIds: [research.scopeId], agent: true });
  assert.deepEqual(result, {
    restored: ['Research'],
    failed: [],
    workspaces: 1,
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
  assert.deepEqual(again, { restored: [], failed: [], workspaces: 0, agent: 'unchanged' });
  assert.deepEqual(
    (await f.b.environment.state()).saved?.hibachis.map((item) => item.here),
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

  // An unselected hibachi is not cloned; the workspace still comes, its hibachi unavailable.
  const other = await device(f.base, 'c', f.fake.gh);
  t.after(() => other.service.close());
  const skipped = await other.environment.restore({ scopeIds: [], agent: false });
  assert.deepEqual(skipped, { restored: [], failed: [], workspaces: 1, agent: 'unchanged' });
  assert.equal(other.files.list().length, 0);
  assert.deepEqual((await other.workspaces.list())[0].scopeIds, [research.scopeId]);
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
