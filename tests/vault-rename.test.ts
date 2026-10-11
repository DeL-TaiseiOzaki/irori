import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  fromSavedEnvironment,
  migrateToVault,
  routineWithVaultKeys,
  toVault,
} from '../src/host/vault-rename';
import { iroriAgentSkills } from '../prompts';
import { FileService, hash } from '../src/host/files';
import { YourAiService } from '../src/host/you';
import { WorkspaceService } from '../src/host/workspaces';
import { SettingsService } from '../src/host/settings';
import { RoutineService } from '../src/host/routines';
import { routineKey } from '../src/domain/routines';
import { SecretStore } from '../src/host/keystore';

async function temp(t: TestContext) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori vault rename '));
  t.after(() => rm(base, { recursive: true, force: true }));
  return base;
}
const json = async (file: string) => JSON.parse(await readFile(file, 'utf8'));
const write = async (file: string, text: string) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
};

test('the old name becomes the new one in every case, and only the old keys move', () => {
  assert.equal(
    toVault('HIBACHI Hibachis hibachi-notes, the hibachi agent'),
    'VAULT Vaults vault-notes, the vault agent',
  );
  assert.equal(
    routineWithVaultKeys(
      `name: Sort # hibachis stay in comments
steps:
  - agent: irori
    hibachis: [Product, Research]
    prompt: Sort the hibachi's mail.
  - agent: "hibachi"
  -   agent: hibachi # its own
`,
    ),
    `name: Sort # hibachis stay in comments
steps:
  - agent: irori
    vaults: [Product, Research]
    prompt: Sort the hibachi's mail.
  - agent: "vault"
  -   agent: vault # its own
`,
  );
  assert.deepEqual(
    fromSavedEnvironment({
      schemaVersion: 1,
      hibachis: [{ scopeId: 'a' }],
      preferences: { theme: 'dark', hibachiAgent: true },
    }),
    {
      schemaVersion: 1,
      vaults: [{ scopeId: 'a' }],
      preferences: { theme: 'dark', vaultAgent: true },
    },
  );
  // A new environment is read as it is.
  const saved = { schemaVersion: 1, vaults: [], preferences: { vaultAgent: false } };
  assert.deepEqual(fromSavedEnvironment(saved), saved);
});

test('a device’s records and the irori agent’s folder are renamed once', async (t) => {
  const base = await temp(t);
  const data = path.join(base, 'data');
  const agent = path.join(base, 'you');
  await write(
    path.join(data, 'device-settings.json'),
    JSON.stringify({ theme: 'dark', hibachiAgent: true }),
  );
  const conversation = path.join(data, 'conversations', 'c1', 'meta.json');
  await write(
    conversation,
    JSON.stringify({ id: 'c1', owner: { kind: 'hibachi', id: 'v', name: 'Notes' }, hibachis: [] }),
  );
  const irori = path.join(data, 'conversations', 'c2', 'meta.json');
  await write(
    irori,
    JSON.stringify({
      id: 'c2',
      owner: { kind: 'irori-agent', id: 'y', name: 'irori agent' },
      hibachis: ['v'],
    }),
  );
  const run = path.join(data, 'routines', 'runs', 'r', 'one.json');
  await write(run, JSON.stringify({ steps: [{ label: 'hibachi agent' }, { label: 'fetch.js' }] }));
  await write(
    path.join(agent, '.claude', 'agents', 'hibachi-notes.md'),
    '---\nname: hibachi-notes\n---\n\nYou are the hibachi agent of the Notes hibachi.\n',
  );
  await write(
    path.join(agent, '.codex', 'agents', 'hibachi-notes.toml'),
    'name = "hibachi-notes"\n',
  );
  // A definition whose new name is taken already, and the person's own, stay.
  await write(path.join(agent, '.opencode', 'agents', 'hibachi-lab.md'), 'old\n');
  await write(path.join(agent, '.opencode', 'agents', 'vault-lab.md'), 'new\n');
  await write(path.join(agent, '.claude', 'agents', 'reviewer.md'), 'Reviews each hibachi.\n');
  await write(
    path.join(agent, 'AGENTS.md'),
    '# irori agent\n\nHand each hibachi to `hibachi-<name>`.\n',
  );
  await write(path.join(agent, '.agents', 'skills', 'add-hibachis', 'SKILL.md'), 'Add hibachis.\n');
  await write(
    path.join(agent, '.agents', 'skills', 'irori-guide', 'SKILL.md'),
    'A hibachi is a folder.\n',
  );
  await write(path.join(agent, '.agents', 'skills', 'mine', 'SKILL.md'), 'My hibachi grill.\n');

  assert.deepEqual(await migrateToVault(data, agent), []);

  assert.deepEqual(await json(path.join(data, 'device-settings.json')), {
    theme: 'dark',
    vaultAgent: true,
  });
  assert.deepEqual(await json(conversation), {
    id: 'c1',
    owner: { kind: 'vault', id: 'v', name: 'Notes' },
    vaults: [],
  });
  assert.deepEqual((await json(irori)).vaults, ['v']);
  assert.deepEqual((await json(run)).steps, [{ label: 'vault agent' }, { label: 'fetch.js' }]);
  assert.deepEqual(await readdir(path.join(agent, '.claude', 'agents')), [
    'reviewer.md',
    'vault-notes.md',
  ]);
  assert.equal(
    await readFile(path.join(agent, '.claude', 'agents', 'vault-notes.md'), 'utf8'),
    '---\nname: vault-notes\n---\n\nYou are the vault agent of the Notes vault.\n',
  );
  assert.equal(
    await readFile(path.join(agent, '.claude', 'agents', 'reviewer.md'), 'utf8'),
    'Reviews each hibachi.\n',
  );
  assert.equal(
    await readFile(path.join(agent, '.codex', 'agents', 'vault-notes.toml'), 'utf8'),
    'name = "vault-notes"\n',
  );
  assert.deepEqual(await readdir(path.join(agent, '.opencode', 'agents')), [
    'hibachi-lab.md',
    'vault-lab.md',
  ]);
  assert.equal(
    await readFile(path.join(agent, 'AGENTS.md'), 'utf8'),
    '# irori agent\n\nHand each vault to `vault-<name>`.\n',
  );
  const skills = path.join(agent, '.agents', 'skills');
  assert.deepEqual((await readdir(skills)).sort(), ['add-vaults', 'irori-guide', 'mine']);
  assert.equal(
    await readFile(path.join(skills, 'add-vaults', 'SKILL.md'), 'utf8'),
    'Add vaults.\n',
  );
  assert.ok(Object.hasOwn(iroriAgentSkills, 'irori-guide'));
  assert.equal(
    await readFile(path.join(skills, 'irori-guide', 'SKILL.md'), 'utf8'),
    'A vault is a folder.\n',
  );
  assert.equal(
    await readFile(path.join(skills, 'mine', 'SKILL.md'), 'utf8'),
    'My hibachi grill.\n',
  );

  // Once done, a later start leaves everything alone, even the old name written again.
  await write(path.join(agent, 'AGENTS.md'), 'A hibachi grill.\n');
  assert.equal(await migrateToVault(data, agent), undefined);
  assert.equal(await readFile(path.join(agent, 'AGENTS.md'), 'utf8'), 'A hibachi grill.\n');
});

test('a device without records or an irori agent folder is marked done', async (t) => {
  const base = await temp(t);
  const data = path.join(base, 'data');
  assert.deepEqual(await migrateToVault(data, path.join(base, 'missing')), []);
  assert.ok((await lstat(path.join(data, 'vault-migrated.json'))).isFile());
});

test('a routine with the old keys takes the new ones, and one the person confirmed stays confirmed', async (t) => {
  const base = await temp(t);
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const root = path.join(base, 'Product');
  await mkdir(root);
  const space = await files.register(root, 'Product', 'team');
  const you = new YourAiService(files.dataDir, path.join(base, 'home'));
  await you.create();
  const workspaces = new WorkspaceService(files);
  const workspace = await workspaces.save('Lab', [space.scopeId]);
  const settings = new SettingsService(files.dataDir);
  const routines = new RoutineService({
    dataDir: files.dataDir,
    files,
    you,
    agents: undefined as never,
    workspaces: () => workspaces.list(),
    settings: () => settings.read(),
    gitStatus: async () => ({}) as never,
    secrets: new SecretStore(path.join(files.dataDir, 'secrets.json')),
    canStart: () => {},
    emit: () => {},
  });
  const old =
    'name: Sort\nsteps:\n  - agent: hibachi\n    access: default\n    prompt: Sort the mail.\n';
  const now = old.replace('agent: hibachi', 'agent: vault');
  const folderOf = (folder: string) => path.join(root, '.irori', 'routines', folder);
  /** A routine as an earlier irori left it, with what the person confirmed of it. */
  const routine = async (folder: string, confirmed?: string) => {
    await write(path.join(folderOf(folder), 'routine.yaml'), old);
    if (confirmed === undefined) return;
    const ref = { owner: space.scopeId, folder };
    const files = [{ path: 'routine.yaml', hash: hash(confirmed), size: confirmed.length }];
    await write(
      path.join(base, 'device', 'routines', 'reviews', `${hash(routineKey(ref))}.json`),
      JSON.stringify({
        schemaVersion: 1,
        ...ref,
        digest: hash(JSON.stringify(files.map((file) => [file.path, file.hash]))),
        reviewedAt: new Date(0).toISOString(),
        files,
      }),
    );
  };
  await routine('confirmed', old);
  await routine('unconfirmed');
  await routine('changed', 'name: Sort\nsteps:\n  - agent: hibachi\n    prompt: Something else.\n');
  const listed = await routines.list(workspace.id);
  const review = (folder: string) => listed.find((item) => item.ref.folder === folder)?.review;
  assert.equal(review('confirmed'), 'reviewed');
  assert.equal(review('unconfirmed'), 'unreviewed');
  assert.equal(review('changed'), 'changed');
  for (const folder of ['confirmed', 'unconfirmed', 'changed']) {
    assert.equal(await readFile(path.join(folderOf(folder), 'routine.yaml'), 'utf8'), now);
    assert.equal(listed.find((item) => item.ref.folder === folder)?.problem, undefined);
  }
});
