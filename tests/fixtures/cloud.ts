// Shared fixtures for the cloud service: a protocol-level rclone stand-in, a KB with
// two signed-in accounts, and a connection modelled as already mounted.
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileService } from '../../src/host/files';
import { CloudService } from '../../src/cloud/service';
import type { RcloneAPI } from '../../src/cloud/rclone';

export class FixtureRclone implements RcloneAPI {
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
export async function fixture(t: any) {
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

export async function mountedFixture(t: any, { writable = false } = {}) {
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
    writable,
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
