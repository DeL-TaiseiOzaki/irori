import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CloudService } from '../src/cloud/service';
import { WorkspaceCloudStorage } from '../src/cloud/storage';
import { WorkspaceService } from '../src/host/workspaces';
import { ImageService } from '../src/host/images';
import { fixture, mountedFixture } from './fixtures/cloud';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6VEQAAAAASUVORK5CYII=',
  'base64',
);

test('An editable Drive note accepts pasted images, dedupes identical bytes, and rejects a mismatched file at the same name', async (t) => {
  const { files, cloud, space, connection, target } = await mountedFixture(t, { writable: true });
  const notePath = `contents/${connection.name}/note.md`;
  await writeFile(path.join(target, 'note.md'), '# Note\n');
  // Wired the way src/host/main.ts wires it: files.cloud and ImageService share one CloudService.
  const images = new ImageService(files, cloud);
  const url = await images.save(space.scopeId, notePath, png);
  assert.match(url, /^_assets\/image-[a-f0-9]{64}\.png$/);
  assert.deepEqual(await readFile(path.join(target, url)), png);
  assert.equal((await readdir(path.join(target, '_assets'))).length, 1);
  // Saving the identical bytes again reuses the same file.
  assert.equal(await images.save(space.scopeId, notePath, png), url);
  // Reading it back through the host gives a data URL of the same bytes.
  assert.equal(
    await images.read(space.scopeId, notePath, url),
    `data:image/png;base64,${png.toString('base64')}`,
  );
  // A different file already at the name these bytes would take is refused, untouched.
  const collision = path.join(target, url);
  const different = Buffer.from('not the same bytes');
  await writeFile(collision, different);
  await assert.rejects(images.save(space.scopeId, notePath, png), /変更されています/);
  assert.deepEqual(await readFile(collision), different);
});

test(
  'A symlinked _assets folder in a Drive connection is refused',
  { skip: process.platform === 'win32' && 'POSIX symlink fixture' },
  async (t) => {
    const { files, cloud, space, connection, target, base } = await mountedFixture(t, {
      writable: true,
    });
    const notePath = `contents/${connection.name}/note.md`;
    await writeFile(path.join(target, 'note.md'), '# Note\n');
    const outside = path.join(base, 'outside');
    await mkdir(outside);
    await symlink(outside, path.join(target, '_assets'), 'dir');
    const images = new ImageService(files, cloud);
    await assert.rejects(images.save(space.scopeId, notePath, png), /escapes its mount/);
    assert.deepEqual(await readdir(outside), []);
  },
);

test('A read-only Drive connection refuses a pasted image', async (t) => {
  const { files, cloud, space, connection, target } = await mountedFixture(t, { writable: false });
  const notePath = `contents/${connection.name}/note.md`;
  await writeFile(path.join(target, 'note.md'), '# Note\n');
  const images = new ImageService(files, cloud);
  await assert.rejects(images.save(space.scopeId, notePath, png), /読み取り専用/);
  // Refused before any write: no _assets folder was created.
  assert.deepEqual(await readdir(target), ['note.md']);
});

test('A workspace-scoped Drive note accepts a pasted image', async (t) => {
  // A workspace scope is unknown to FileService; only WorkspaceCloudStorage knows its root.
  const { files, rpc, accountId } = await fixture(t);
  const workspaces = new WorkspaceService(files);
  const workspace = await workspaces.save('Drive only', []);
  const cloud = new CloudService(new WorkspaceCloudStorage(files, workspaces), async () => {}, rpc);
  files.cloud = cloud;
  const root = await cloud.workspaceRoot(workspace.id);
  const connection = await cloud.add({
    scopeId: workspace.id,
    accountId,
    contentsRoot: 'contents',
    name: '資料',
    folder: { id: 'folder-one', name: 'Original', parentId: 'root' },
  });
  const target = path.join(root.root, 'contents', '資料');
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, 'note.md'), '# Shared\n');
  const info = await stat(target);
  // Model a previously verified mount, as tests/connections.test.ts does for a workspace.
  cloud['mounted'].set(`${workspace.id}:${connection.mountId}`, {
    attachment: connection,
    target,
    device: info.dev,
    inode: info.ino,
    filesystem: 'fixture:',
    remote: { _name: 'fixture' },
    writable: true,
  });
  const original = rpc.call.bind(rpc);
  rpc.call = async (method, params) =>
    method === 'mount/listmounts'
      ? { mountPoints: [{ MountPoint: target, Fs: 'fixture:' }] }
      : original(method, params);
  const images = new ImageService(files, cloud);
  const notePath = 'contents/資料/note.md';
  const url = await images.save(workspace.id, notePath, png);
  assert.match(url, /^_assets\/image-[a-f0-9]{64}\.png$/);
  assert.deepEqual(await readFile(path.join(target, url)), png);
  assert.equal(
    await images.read(workspace.id, notePath, url),
    `data:image/png;base64,${png.toString('base64')}`,
  );
});
