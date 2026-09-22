import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
  stat,
  chmod,
  rmdir,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { mountNameError } from '../src/domain/connections';
import { WorkspaceService, inspectRepository, githubRepository } from '../src/host/workspaces';
import { FileService } from '../src/host/files';
import { CloudService } from '../src/cloud/service';
import { CloudAccounts } from '../src/cloud/accounts';
import { WorkspaceCloudStorage } from '../src/cloud/storage';
import { CloudOutbox } from '../src/cloud/outbox';
import { KnowledgeStore } from '../src/knowledge/store';
import type { RcloneAPI } from '../src/cloud/rclone';

class FixtureRclone implements RcloneAPI {
  calls: { method: string; params: any }[] = [];
  folders = [
    { ID: 'folder-one', Name: 'Drive original name', IsDir: true },
    { ID: 'folder-two', Name: 'Drive original name', IsDir: true },
  ];
  async call(method: string, params: Record<string, any> = {}): Promise<any> {
    this.calls.push({ method, params });
    if (method === 'operations/list') return { list: this.folders };
    if (method === 'operations/fsinfo') return { Name: params.fs._name, Root: '' };
    if (method === 'core/version') return { version: 'fixture' };
    if (method === 'mount/types') return { mountTypes: ['mount'] };
    if (method === 'backend/command') return { result: [{ id: 'shared-drive', name: 'Shared' }] };
    if (method === 'config/create' || method === 'config/update')
      return { jobid: this.calls.length };
    if (method === 'job/status') return { finished: true, success: true, output: {} };
    return {};
  }
  async close() {}
}
async function fixture(t: any) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori cloud 日本語 '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const root = path.join(base, 'KB');
  await mkdir(root);
  const space = await files.register(root, 'Personal', 'personal');
  const accountId = randomUUID(),
    secondAccountId = randomUUID();
  await writeFile(
    path.join(files.dataDir, 'cloud-accounts.json'),
    JSON.stringify([
      { id: accountId, name: 'Personal account', provider: 'google-drive', state: 'ready' },
      { id: secondAccountId, name: 'Team account', provider: 'google-drive', state: 'ready' },
    ]),
  );
  const rpc = new FixtureRclone();
  const cloud = new CloudService(files, async () => {}, rpc);
  files.cloud = cloud;
  return { base, files, space, accountId, secondAccountId, rpc, cloud };
}

async function mountedFixture(t: any) {
  const value = await fixture(t);
  const { cloud, space, accountId, rpc } = value;
  const connection = await cloud.add({
    scopeId: space.scopeId,
    accountId,
    folder: { id: 'folder-one', parentId: 'root', name: 'Source' },
    contentsRoot: 'contents',
    name: 'Mounted fixture',
  });
  const target = path.join(space.root, 'contents', connection.name);
  await mkdir(target, { recursive: true });
  const info = await stat(target);
  const key = `${space.scopeId}:${connection.mountId}`;
  // Model a previously verified mount; ordinary test directories are never mounted.
  cloud['mounted'].set(key, {
    attachment: connection,
    target,
    device: info.dev,
    inode: info.ino,
    filesystem: 'fixture:',
  });
  cloud['states'].set(key, { state: 'mounted' });
  const original = rpc.call.bind(rpc);
  const state = {
    mounts: [{ MountPoint: target, Fs: 'fixture:' }],
    listingFails: false,
    malformedListing: false,
    unmountFails: false,
    closed: false,
  };
  rpc.call = async (method, params) => {
    if (method === 'mount/listmounts') {
      if (state.listingFails) throw Error('Mount listing unavailable');
      if (state.malformedListing) return {};
      return { mountPoints: state.mounts };
    }
    if (method === 'mount/unmount' && state.unmountFails) throw Error('Unmount failed');
    return original(method, params);
  };
  rpc.close = async () => {
    state.closed = true;
  };
  return { ...value, connection, target, state };
}

test('A recovered mount clears its transient error on refresh and explicit reconnect', async (t) => {
  const { cloud, space, connection, rpc, state } = await mountedFixture(t);
  for (const recover of [
    () => cloud.connections(space.scopeId),
    () => cloud.connect(space.scopeId, connection.mountId),
  ]) {
    state.listingFails = true;
    assert.equal((await cloud.connections(space.scopeId))[0].state, 'error');
    state.listingFails = false;
    await recover();
    assert.deepEqual(cloud['states'].get(`${space.scopeId}:${connection.mountId}`), {
      state: 'mounted',
    });
    assert.equal((await cloud.rootEntries(space.scopeId, 'contents'))![0].blocked, undefined);
  }
  assert(!rpc.calls.some((item) => item.method === 'mount/mount'));
});

test('Closing after a disappeared mount succeeds when its service and filesystem agree', async (t) => {
  for (const removeTarget of [false, true]) {
    const { cloud, target, state } = await mountedFixture(t);
    if (removeTarget) await rmdir(target);
    else await writeFile(path.join(target, 'keep.txt'), 'Preserve replacement local bytes');
    state.mounts = [];
    state.unmountFails = true;
    await cloud.close();
    assert.equal(state.closed, true);
    if (!removeTarget)
      assert.equal(
        await readFile(path.join(target, 'keep.txt'), 'utf8'),
        'Preserve replacement local bytes',
      );
  }
});

test('An in-flight mount refresh cannot undo an explicit disconnect', async (t) => {
  const { cloud, space, connection, rpc, state } = await mountedFixture(t);
  let finishListing!: (value: unknown) => void;
  let startedListing!: () => void;
  const started = new Promise<void>((resolve) => {
    startedListing = resolve;
  });
  const original = rpc.call.bind(rpc);
  rpc.call = async (method, params) => {
    if (method === 'mount/listmounts') {
      startedListing();
      return new Promise((resolve) => {
        finishListing = resolve;
      });
    }
    return original(method, params);
  };
  const refresh = cloud.connections(space.scopeId);
  await started;
  await cloud.disconnect(space.scopeId, connection.mountId);
  finishListing({ mountPoints: state.mounts });
  assert.equal((await refresh)[0].state, 'disconnected');
});

test('Unmount failures remain visible when mount absence cannot be verified', async (t) => {
  for (const stateChange of [
    'still-listed',
    'listing-fails',
    'malformed-list',
    'foreign-mount',
    'alias',
  ] as const) {
    const { cloud, space, connection, target, base, state } = await mountedFixture(t);
    state.unmountFails = true;
    if (stateChange === 'listing-fails') state.listingFails = true;
    if (stateChange === 'malformed-list') state.malformedListing = true;
    if (stateChange === 'foreign-mount') state.mounts[0].Fs = 'another-remote:';
    if (stateChange === 'alias') {
      state.mounts = [];
      await rmdir(target);
      await symlink(base, target, 'dir');
    }
    await assert.rejects(cloud.disconnect(space.scopeId, connection.mountId));
    await assert.rejects(cloud.close());
    assert.equal(state.closed, false);
    assert.equal(cloud['mounted'].size, 1);
  }
});

test('Preparation retains the bound account and drive and rejects delivery after rebinding', async (t) => {
  const { cloud, files, space, accountId, secondAccountId, rpc } = await fixture(t);
  const connection = await cloud.add({
    scopeId: space.scopeId,
    accountId,
    folder: { id: 'folder-one', parentId: 'root', driveId: 'shared-drive', name: 'Source' },
    contentsRoot: 'contents',
    name: 'Destination',
  });
  const callsBeforePreparation = rpc.calls.length;
  const target = await cloud.writeTarget(space.scopeId, connection.mountId);
  assert.deepEqual(target, {
    ownerId: space.scopeId,
    mountId: connection.mountId,
    folderId: 'folder-one',
    accountId,
    driveId: 'shared-drive',
  });
  assert.equal(
    rpc.calls.length,
    callsBeforePreparation,
    'Preparation does not contact Google or mount',
  );
  const note = await files.createNote(space.scopeId, 'Retained');
  const knowledge = new KnowledgeStore(files.dataDir, (ref) =>
    files.resolve(ref.scopeId, ref.path),
  );
  const outbox = new CloudOutbox(files.dataDir, knowledge);
  const prepared = await outbox.prepare(target, note);
  const remote = {
    observe: async () => {
      throw Error('Delivery must stop before observing the remote');
    },
    copy: async () => {
      throw Error('Delivery must stop before copying');
    },
  };
  await cloud.bind(space.scopeId, connection.mountId, secondAccountId);
  await assert.rejects(
    outbox.deliver(
      space.scopeId,
      prepared.id,
      await cloud.writeTarget(space.scopeId, connection.mountId),
      remote,
    ),
    /識別情報/,
  );
  await cloud.bind(space.scopeId, connection.mountId, accountId);
  const declarationFile = path.join(space.root, '.irori/cloud-mounts.json');
  const [record] = await cloud.declarations(space.scopeId);
  await writeFile(declarationFile, JSON.stringify([{ ...record, driveId: 'another-drive' }]));
  await assert.rejects(
    outbox.deliver(
      space.scopeId,
      prepared.id,
      await cloud.writeTarget(space.scopeId, connection.mountId),
      remote,
    ),
    /識別情報/,
  );
  assert.equal(await knowledge.sourceText(prepared.source), note.text);
  await rm(
    path.join(files.dataDir, 'cloud-bindings', `${space.scopeId}-${connection.mountId}.json`),
  );
  await assert.rejects(cloud.writeTarget(space.scopeId, connection.mountId), /紐づけ/);
  assert.equal((await outbox.list(space.scopeId))[0].accountId, accountId);
});

test('workspace Drive connections are independent of KB membership and survive restart without writing KB metadata', async (t) => {
  const { base, files, space, rpc, accountId } = await fixture(t);
  const workspaces = new WorkspaceService(files);
  const first = await workspaces.save('Research', [space.scopeId]);
  const second = await workspaces.save('Drive only', []);
  const cloud = new CloudService(new WorkspaceCloudStorage(files, workspaces), async () => {}, rpc);
  files.cloud = cloud;
  const root = await cloud.workspaceRoot(first.id);
  assert.equal(root.workspace, true);
  assert.equal(files.list().length, 1, 'Cloud storage is not registered as a KB');
  const connection = await cloud.add({
    scopeId: first.id,
    accountId,
    contentsRoot: 'contents',
    name: '資料',
    folder: { id: 'folder-one', name: 'Original', parentId: 'root' },
  });
  assert.equal((await cloud.connections(first.id))[0].accountName, 'Personal account');
  await assert.rejects(
    cloud.removeWorkspace(first.id, () => workspaces.remove(first.id)),
    /登録解除/,
  );
  assert.deepEqual(await cloud.connections(second.id), []);
  await assert.rejects(readFile(path.join(space.root, '.irori/cloud-mounts.json')), {
    code: 'ENOENT',
  });
  await workspaces.save('Renamed', [], first.id);
  assert.equal((await cloud.workspaceRoot(first.id)).root, root.root);
  assert.equal((await cloud.connections(first.id))[0].mountId, connection.mountId);

  await mkdir(path.join(root.root, 'contents', '資料'), { recursive: true });
  await writeFile(path.join(root.root, 'contents', '資料', 'note.md'), 'Existing local data');
  await assert.rejects(cloud.read(first.id, 'contents/資料/note.md'), /未接続/);
  await assert.rejects(cloud.read(first.id, '../outside.md'), /Invalid cloud path/);
  await assert.rejects(
    files.register(path.join(root.root, 'contents', '資料'), 'Invalid KB', 'personal'),
    /workspace cloud storage/,
  );
  await cloud.edit(first.id, connection.mountId);
  assert.equal(
    await readFile(path.join(root.root, 'contents', '資料', 'note.md'), 'utf8'),
    'Existing local data',
  );

  const other = await cloud.add({
    scopeId: second.id,
    accountId,
    contentsRoot: 'contents',
    name: 'Independent',
    folder: { id: 'folder-two', name: 'Second folder', parentId: 'root' },
  });
  const restarted = new FileService(path.join(base, 'device'));
  await restarted.init();
  const restored = new CloudService(
    new WorkspaceCloudStorage(restarted, new WorkspaceService(restarted)),
    async () => {},
    rpc,
  );
  assert.equal((await restored.connections(second.id))[0].mountId, other.mountId);
  assert.equal((await restored.connections(second.id))[0].state, 'disconnected');
  const records = await readFile(
    path.join((await restored.workspaceRoot(second.id)).root, '.irori/cloud-mounts.json'),
    'utf8',
  );
  assert(!records.includes(accountId));
  assert(!records.includes(base));
});

test('workspace cloud storage rejects aliases and retains legacy KB attachments in place', async (t) => {
  const { base, files, space, rpc, accountId, cloud: legacy } = await fixture(t);
  const attachment = await legacy.add({
    scopeId: space.scopeId,
    accountId,
    contentsRoot: 'contents',
    name: 'Legacy',
    folder: { id: 'folder-one', name: 'Original', parentId: 'root' },
  });
  const workspaces = new WorkspaceService(files);
  const profile = await workspaces.save('Workspace', [space.scopeId]);
  const cloud = new CloudService(new WorkspaceCloudStorage(files, workspaces), async () => {}, rpc);
  assert.equal((await cloud.connections(space.scopeId))[0].mountId, attachment.mountId);
  const directory = path.join(files.dataDir, 'workspace-cloud');
  await mkdir(directory);
  const outside = path.join(base, 'outside');
  await mkdir(outside);
  await symlink(outside, path.join(directory, profile.id), 'dir');
  await assert.rejects(cloud.workspaceRoot(profile.id), /must not be an alias/);
  await assert.rejects(readFile(path.join(outside, '.irori/cloud-mounts.json')), {
    code: 'ENOENT',
  });
  assert.equal((await cloud.connections(space.scopeId))[0].mountId, attachment.mountId);
});

test('Mount names support Japanese and spaces, and reject traversal and incompatible names', () => {
  for (const name of ['調査 資料', 'team-docs', 'équipe'])
    assert.equal(mountNameError(name), undefined);
  for (const name of [
    '',
    '.',
    '..',
    '../escape',
    'folder/sub',
    'a\\b',
    'name:',
    'NUL.txt',
    'COM¹',
    '資料.',
    ' leading',
    'a\0b',
    '資'.repeat(100),
  ])
    assert.ok(mountNameError(name), name);
});

test('Cloud declarations retain user names and provider IDs across restart, account and scope boundaries', async (t) => {
  const { base, files, space, accountId, secondAccountId, rpc, cloud } = await fixture(t);
  const folder = { id: 'folder-two', parentId: 'root', name: 'Drive original name' };
  const first = await cloud.add({
    scopeId: space.scopeId,
    accountId,
    folder,
    contentsRoot: 'contents',
    name: '調査 資料',
  });
  const second = await cloud.add({
    scopeId: space.scopeId,
    accountId: secondAccountId,
    folder: { ...folder, id: 'folder-one', driveId: 'shared-drive' },
    contentsRoot: 'contents',
    name: '共有資料',
  });
  assert.equal(first.folderId, 'folder-two');
  assert.equal(second.driveId, 'shared-drive');
  const portable = await readFile(path.join(space.root, '.irori/cloud-mounts.json'), 'utf8');
  assert.ok(!portable.includes(accountId));
  assert.ok(!portable.includes(base));
  assert.ok(!portable.includes('token'));
  await assert.rejects(stat(path.join(space.root, 'contents')), { code: 'ENOENT' });
  rpc.folders[1].Name = 'Renamed at provider';
  const restarted = new CloudService(files, async () => {}, rpc);
  const connections = await restarted.connections(space.scopeId);
  assert.deepEqual(
    connections.map((item) => [item.name, item.accountName, item.state]),
    [
      ['調査 資料', 'Personal account', 'disconnected'],
      ['共有資料', 'Team account', 'disconnected'],
    ],
  );
  await restarted.bind(space.scopeId, first.mountId, secondAccountId);
  assert.equal((await restarted.connections(space.scopeId))[0].name, '調査 資料');
  const otherRoot = path.join(base, 'Other KB');
  await mkdir(otherRoot);
  const other = await files.register(otherRoot, 'Other', 'team');
  await cloud.add({
    scopeId: other.scopeId,
    accountId,
    folder,
    contentsRoot: 'contents',
    name: '調査 資料',
  });
  assert.equal((await cloud.connections(other.scopeId)).length, 1);
  assert.equal((await cloud.connections(space.scopeId)).length, 2);
});

test('Registration rejects duplicate aliases, occupied paths, missing IDs and contents symlinks', async (t) => {
  const { base, files, space, accountId, rpc, cloud } = await fixture(t);
  const input = {
    scopeId: space.scopeId,
    accountId,
    folder: { id: 'folder-one', parentId: 'root', name: 'Drive original name' },
    contentsRoot: 'contents',
    name: 'Équipe',
  };
  await cloud.add(input);
  await assert.rejects(cloud.add({ ...input, name: 'e\u0301QUIPE' }), /同じ名前/);
  await mkdir(path.join(space.root, 'contents'));
  await writeFile(path.join(space.root, 'contents/occupied'), 'Keep local bytes');
  await assert.rejects(cloud.add({ ...input, name: 'occupied' }), /同じ名前/);
  assert.equal(
    await readFile(path.join(space.root, 'contents/occupied'), 'utf8'),
    'Keep local bytes',
  );
  rpc.folders = [{ ID: 'different-id', Name: input.folder.name, IsDir: true }];
  await assert.rejects(cloud.add({ ...input, name: 'another' }), /識別情報/);
  assert.equal((await cloud.connections(space.scopeId)).length, 1);
  const entries = await files.entries(space.scopeId, 'contents');
  assert.ok(entries.find((item) => item.name === 'occupied')?.blocked?.includes('ローカルデータ'));
  const otherRoot = path.join(base, 'Alias KB');
  await mkdir(otherRoot);
  const other = await files.register(otherRoot, 'Alias', 'personal');
  await symlink(path.join(space.root, 'contents'), path.join(otherRoot, 'contents'), 'dir');
  await assert.rejects(cloud.add({ ...input, scopeId: other.scopeId, name: 'safe' }), /リンク/);
});

test(
  'A reported mount with ordinary local filesystem identity is rejected and remains unreadable',
  { skip: process.platform === 'win32' && 'POSIX placeholder fixture' },
  async (t) => {
    const { files, space, accountId, rpc, cloud } = await fixture(t);
    const connection = await cloud.add({
      scopeId: space.scopeId,
      accountId,
      folder: { id: 'folder-one', parentId: 'root', name: 'Source' },
      contentsRoot: 'contents',
      name: '資料',
    });
    cloud.setup = async () => ({
      available: true,
      oauthConfigured: true,
      mountAvailable: true,
      detail: 'Protocol fixture only',
    });
    await assert.rejects(cloud.connect(space.scopeId, connection.mountId), /ファイルシステム/);
    assert.equal((await cloud.connections(space.scopeId))[0].state, 'error');
    const request = rpc.calls.find((item) => item.method === 'mount/mount')!;
    assert.equal(request.params.vfsOpt.ReadOnly, true);
    assert.equal(request.params.fs.root_folder_id, 'folder-one');
    assert.ok(rpc.calls.some((item) => item.method === 'mount/unmount'));
    await assert.rejects(files.resolve(space.scopeId, 'contents/資料'), /未接続/);
    const target = path.join(space.root, 'contents/資料');
    if (process.platform !== 'win32') assert.equal((await stat(target)).mode & 0o777, 0);
    await chmod(target, 0o700); // Cleanup and mutation of a disposable placeholder only.
    await writeFile(path.join(target, 'external.txt'), 'Keep');
    await assert.rejects(cloud.connect(space.scopeId, connection.mountId), /同じ名前/);
    await chmod(target, 0o700);
    assert.equal(await readFile(path.join(target, 'external.txt'), 'utf8'), 'Keep');
    await assert.rejects(
      files.save({
        scopeId: space.scopeId,
        path: 'contents/資料/note.md',
        text: 'unsafe',
        hash: '0'.repeat(64),
      }),
      /読み取り専用/,
    );
  },
);

test('OAuth follows only supported native questions and does not publish provider configuration', async (t) => {
  const base = await mkdtemp(path.join(tmpdir(), 'irori auth fixture '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const rpc = new FixtureRclone();
  let step = 0;
  const original = rpc.call.bind(rpc);
  rpc.call = async (method, params) => {
    if (method === 'job/status') {
      const output =
        step++ === 0
          ? { State: 'oauth', Option: { Name: 'config_is_local' } }
          : step === 2
            ? { State: 'shared', Option: { Name: 'config_change_team_drive' } }
            : {};
      return { finished: true, success: true, output };
    }
    return original(method, params);
  };
  const accounts = new CloudAccounts(
    base,
    rpc,
    async () => {
      throw Error('No real browser expected');
    },
    { clientId: 'fixture-client', clientSecret: 'fixture-secret' },
  );
  await accounts.add('仕事用');
  for (let n = 0; n < 100 && (await accounts.list())[0].state === 'authorizing'; n++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal((await accounts.list())[0].state, 'ready');
  assert.deepEqual(
    rpc.calls
      .filter((item) => item.method === 'config/update')
      .map((item) => item.params.opt.result),
    ['true', 'false'],
  );
  const publicState =
    JSON.stringify(await accounts.list()) +
    (await readFile(path.join(base, 'cloud-accounts.json'), 'utf8'));
  assert.ok(!publicState.includes('fixture-secret'));
  assert.ok(!publicState.includes('fixture-client'));
  await accounts.close();
});

test('OAuth config errors remain incomplete without exposing provider error bodies', async (t) => {
  const base = await mkdtemp(path.join(tmpdir(), 'irori auth failure '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const rpc = new FixtureRclone();
  const original = rpc.call.bind(rpc);
  rpc.call = async (method, params) =>
    method === 'job/status'
      ? { finished: true, success: true, output: { Error: 'secret-provider-body' } }
      : original(method, params);
  const accounts = new CloudAccounts(base, rpc, async () => {}, {
    clientId: 'fixture',
    clientSecret: 'fixture',
  });
  const added = await accounts.add('Failed account');
  for (let n = 0; n < 100 && (await accounts.list())[0].state === 'authorizing'; n++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal((await accounts.list())[0].state, 'incomplete');
  assert.ok(!JSON.stringify(await accounts.list()).includes('secret-provider-body'));
  await accounts.cancel(added.id);
  assert.deepEqual(await accounts.list(), []);
  assert.ok(rpc.calls.some((item) => item.method === 'config/delete'));
});

test('Cancelling pending OAuth stops its native job and removes only the unfinished account', async (t) => {
  const base = await mkdtemp(path.join(tmpdir(), 'irori auth cancellation '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const rpc = new FixtureRclone();
  const original = rpc.call.bind(rpc);
  rpc.call = async (method, params) =>
    method === 'job/status' ? { finished: false } : original(method, params);
  const accounts = new CloudAccounts(base, rpc, async () => {}, {
    clientId: 'fixture',
    clientSecret: 'fixture',
  });
  const added = await accounts.add('Pending account');
  await accounts.cancel(added.id);
  assert.deepEqual(await accounts.list(), []);
  assert.ok(rpc.calls.some((item) => item.method === 'job/stop'));
  assert.ok(rpc.calls.some((item) => item.method === 'config/oauthstop'));
  assert.equal(rpc.calls.filter((item) => item.method === 'config/delete').length, 1);
  assert.deepEqual(JSON.parse(await readFile(path.join(base, 'cloud-accounts.json'), 'utf8')), []);
});

test('Workspace profiles persist independent scopes and Git inspection preserves dirty checkouts and redacts credentials', async (t) => {
  const { base, files, space } = await fixture(t);
  const otherRoot = path.join(base, 'Team');
  await mkdir(otherRoot);
  const other = await files.register(otherRoot, 'Team', 'team');
  const service = new WorkspaceService(files);
  const profile = await service.save('Work', [space.scopeId, other.scopeId, space.scopeId]);
  assert.deepEqual((await new WorkspaceService(files).list())[0].scopeIds, [
    space.scopeId,
    other.scopeId,
  ]);
  await assert.rejects(service.save('Invalid', [randomUUID()]), /Unknown space/);
  await assert.rejects(service.save('Work', [space.scopeId]), /同じ名前/);
  assert.equal((await service.save('Renamed', [other.scopeId], profile.id)).id, profile.id);
  assert.equal(
    githubRepository('https://user:secret@github.com/example/notes.git?token=secret'),
    'example/notes',
  );
  const git = (...args: string[]) => execFileSync('git', args, { cwd: space.root, stdio: 'pipe' });
  git('init');
  git('remote', 'add', 'origin', 'https://user:secret@github.com/example/notes.git');
  await writeFile(path.join(space.root, 'draft.md'), 'User draft');
  const info = await inspectRepository(space.root);
  assert.equal(info.kind, 'github');
  assert.equal(info.repository, 'example/notes');
  assert.equal(info.changed, true);
  assert.ok(!JSON.stringify(info).includes('secret'));
  assert.equal(await readFile(path.join(space.root, 'draft.md'), 'utf8'), 'User draft');
  await mkdir(path.join(space.root, 'nested'));
  assert.equal((await inspectRepository(path.join(space.root, 'nested'))).kind, 'unavailable');
  await Promise.all([service.remove(profile.id), service.save('Another', [space.scopeId])]);
  assert.deepEqual(
    (await new WorkspaceService(files).list()).map((item) => item.name),
    ['Another'],
  );
  await assert.rejects(service.remove(profile.id), /Unknown workspace/);
  assert.equal(await readFile(path.join(space.root, 'draft.md'), 'utf8'), 'User draft');
  assert.equal(files.list().length, 2);
});

test('Cloud rename/removal preserves provider identity, other connections and existing local bytes', async (t) => {
  const { files, space, accountId, rpc, cloud } = await fixture(t);
  const input = {
    scopeId: space.scopeId,
    accountId,
    folder: { id: 'folder-one', parentId: 'root', name: 'Source' },
    contentsRoot: 'contents',
    name: 'Before',
  };
  const first = await cloud.add(input);
  const second = await cloud.add({ ...input, name: 'Reserved' });
  const beforeCalls = rpc.calls.length;
  await assert.rejects(cloud.edit(space.scopeId, first.mountId, '../unsafe'), /フォルダ/);
  await assert.rejects(cloud.edit(space.scopeId, first.mountId, 'reserved'), /同じ名前/);
  await mkdir(path.join(space.root, 'contents/Occupied'), { recursive: true });
  await writeFile(path.join(space.root, 'contents/Occupied/keep.md'), 'Keep');
  await assert.rejects(cloud.edit(space.scopeId, first.mountId, 'Occupied'), /同じ名前/);
  await cloud.edit(space.scopeId, first.mountId, '新しい 資料');
  const restarted = new CloudService(files, async () => {}, rpc);
  const renamed = (await restarted.connections(space.scopeId))[0];
  assert.deepEqual(
    [renamed.name, renamed.mountId, renamed.folderId, renamed.accountName],
    ['新しい 資料', first.mountId, 'folder-one', 'Personal account'],
  );
  await mkdir(path.join(space.root, 'contents/新しい 資料'));
  await writeFile(path.join(space.root, 'contents/新しい 資料/local.md'), 'User bytes');
  await restarted.edit(space.scopeId, first.mountId);
  assert.deepEqual(
    (await restarted.declarations(space.scopeId)).map((item) => item.mountId),
    [second.mountId],
  );
  assert.equal(
    await readFile(path.join(space.root, 'contents/新しい 資料/local.md'), 'utf8'),
    'User bytes',
  );
  assert.equal(await readFile(path.join(space.root, 'contents/Occupied/keep.md'), 'utf8'), 'Keep');
  await assert.rejects(
    stat(path.join(files.dataDir, 'cloud-bindings', `${space.scopeId}-${first.mountId}.json`)),
    { code: 'ENOENT' },
  );
  assert.equal(rpc.calls.length, beforeCalls, 'Metadata edits must not modify the remote');
});

test('Workspace edits preserve offline scopes while rejecting newly invented scope IDs', async (t) => {
  const { files, space } = await fixture(t);
  const service = new WorkspaceService(files);
  const profile = await service.save('Before', [space.scopeId]);
  // Simulate a disconnected checkout; only device metadata is available after restart.
  await rm(space.root, { recursive: true });
  const restartedFiles = new FileService(files.dataDir);
  await restartedFiles.init();
  assert.equal(restartedFiles.list().length, 0);
  const restarted = new WorkspaceService(restartedFiles);
  const updated = await restarted.save('After', profile.scopeIds, profile.id);
  assert.deepEqual(updated.scopeIds, profile.scopeIds);
  await assert.rejects(restarted.save('Invalid', [randomUUID()], profile.id), /Unknown space/);
  await restarted.remove(profile.id);
  assert.deepEqual(await restarted.list(), []);
});

test(
  'Missing placeholders can be recreated and only owned empty placeholders are cleaned up',
  { skip: process.platform === 'win32' && 'POSIX placeholder fixture' },
  async (t) => {
    const { space, accountId, cloud } = await fixture(t);
    const connection = await cloud.add({
      scopeId: space.scopeId,
      accountId,
      folder: { id: 'folder-one', parentId: 'root', name: 'Source' },
      contentsRoot: 'contents',
      name: 'Before',
    });
    cloud.setup = async () => ({
      available: true,
      oauthConfigured: true,
      mountAvailable: true,
      detail: 'Fixture',
    });
    const target = path.join(space.root, 'contents/Before');
    await assert.rejects(cloud.connect(space.scopeId, connection.mountId), /ファイルシステム/);
    await rmdir(target);
    await assert.rejects(cloud.connect(space.scopeId, connection.mountId), /ファイルシステム/);
    await cloud.edit(space.scopeId, connection.mountId, 'After');
    await assert.rejects(stat(target), { code: 'ENOENT' });
    await assert.rejects(cloud.connect(space.scopeId, connection.mountId), /ファイルシステム/);
    await cloud.edit(space.scopeId, connection.mountId);
    await assert.rejects(stat(path.join(space.root, 'contents/After')), { code: 'ENOENT' });
  },
);

test('Account removal refuses bindings from offline scopes and removes only unused irori credentials', async (t) => {
  const { files, space, accountId, secondAccountId, rpc, cloud } = await fixture(t);
  const connection = await cloud.add({
    scopeId: space.scopeId,
    accountId,
    folder: { id: 'folder-one', parentId: 'root', name: 'Source' },
    contentsRoot: 'contents',
    name: '資料',
  });
  await assert.rejects(cloud.removeAccount(accountId), /接続先があります/);
  const offlineBinding = path.join(files.dataDir, 'cloud-bindings', `${randomUUID()}.json`);
  await writeFile(
    offlineBinding,
    JSON.stringify({
      scopeId: randomUUID(),
      mountId: randomUUID(),
      root: '/offline',
      accountId: secondAccountId,
    }),
  );
  await assert.rejects(cloud.removeAccount(secondAccountId), /接続先があります/);
  assert.equal(rpc.calls.filter((item) => item.method === 'config/delete').length, 0);
  await cloud.edit(space.scopeId, connection.mountId);
  await cloud.removeAccount(accountId);
  assert.deepEqual(
    (await cloud.accounts.list()).map((item) => item.id),
    [secondAccountId],
  );
  assert.deepEqual(
    rpc.calls.filter((item) => item.method === 'config/delete').map((item) => item.params.name),
    ['irori_' + accountId.replaceAll('-', '')],
  );
});

test('Connection limit rejects additions before writing an unreadable declaration', async (t) => {
  const { space, accountId, cloud } = await fixture(t);
  const input = {
    scopeId: space.scopeId,
    accountId,
    folder: { id: 'folder-one', parentId: 'root', name: 'Source' },
    contentsRoot: 'contents',
    name: 'First',
  };
  const connection = await cloud.add(input);
  const { accountName: _account, state: _state, ...record } = connection;
  await writeFile(
    path.join(space.root, '.irori/cloud-mounts.json'),
    JSON.stringify(
      Array.from({ length: 100 }, (_, i) => ({
        ...record,
        mountId: randomUUID(),
        name: `Folder-${i}`,
      })),
    ),
  );
  await assert.rejects(cloud.add({ ...input, name: 'Overflow' }), /100件/);
  assert.equal((await cloud.declarations(space.scopeId)).length, 100);
});
