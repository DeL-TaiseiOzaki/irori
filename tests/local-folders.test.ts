import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { CloudService } from '../src/cloud/service';
import { fixture, retiredDeclaration, writeRetired } from './fixtures/cloud';

/** A hibachi with a folder outside it, standing for one a sync app keeps on this device. */
async function local(t: any) {
  const value = await fixture(t);
  const folder = path.join(value.base, 'Sync 同期', 'Research');
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, 'note.md'), '# Synced\n');
  return { ...value, folder };
}

test('A local folder appears in contents through a link and is edited in place', async (t) => {
  const { files, space, cloud, folder } = await local(t);
  const connection = await cloud.addLocal({
    scopeId: space.scopeId,
    path: folder,
    contentsRoot: 'contents',
    name: '調査',
  });
  assert.equal(connection.provider, 'local');
  assert.equal(connection.state, 'disconnected');
  assert.equal(connection.folderName, 'Research');
  // The hibachi's record names the connection, never the device's path.
  const record = await readFile(path.join(space.root, '.irori', 'local-folders.json'), 'utf8');
  assert(!record.includes(folder));
  await cloud.connect(space.scopeId, connection.mountId);
  const entry = path.join(space.root, 'contents', '調査');
  assert((await lstat(entry)).isSymbolicLink());
  assert.equal(await readlink(entry), folder);
  assert.deepEqual(cloud.localFolders(space.scopeId), [folder]);
  const [listed] = await files.entries(space.scopeId, 'contents');
  assert.equal(listed.blocked, undefined);
  assert.equal(listed.writable, true);
  const rel = 'contents/調査/note.md';
  const doc = await files.read(space.scopeId, rel);
  assert.equal(doc.readOnly, false);
  await files.save({ ...doc, text: '# Synced\n\nEdited\n' });
  assert.equal(await readFile(path.join(folder, 'note.md'), 'utf8'), '# Synced\n\nEdited\n');
  await cloud.createNote(space.scopeId, 'contents/調査', 'Idea');
  await cloud.moveEntry(space.scopeId, 'contents/調査/Idea.md', 'contents/調査/Plan.md');
  assert.deepEqual((await readdir(folder)).sort(), ['Plan.md', 'note.md']);
  // Disconnecting removes only the link; the folder and its files stay.
  await cloud.disconnect(space.scopeId, connection.mountId);
  await assert.rejects(lstat(entry), { code: 'ENOENT' });
  assert.deepEqual((await readdir(folder)).sort(), ['Plan.md', 'note.md']);
  assert.deepEqual(cloud.localFolders(space.scopeId), []);
  await assert.rejects(files.read(space.scopeId, rel), /未接続/);
});

test('A read-only local folder refuses changes, and access changes reconnect it', async (t) => {
  const { files, space, cloud, folder } = await local(t);
  const { mountId } = await cloud.addLocal({
    scopeId: space.scopeId,
    path: folder,
    contentsRoot: 'contents',
    name: 'Research',
    access: 'read-only',
  });
  await cloud.connect(space.scopeId, mountId);
  const doc = await files.read(space.scopeId, 'contents/Research/note.md');
  assert.equal(doc.readOnly, true);
  await assert.rejects(files.save({ ...doc, text: 'Changed' }), /読み取り専用/);
  await cloud.setAccess(space.scopeId, mountId, 'read-write');
  const [connection] = await cloud.connections(space.scopeId);
  assert.equal(connection.state, 'mounted');
  assert.equal(connection.writable, true);
  assert.equal((await files.read(space.scopeId, 'contents/Research/note.md')).readOnly, false);
});

test('Folders overlapping a hibachi or irori data, and taken names, are refused', async (t) => {
  const { base, files, space, cloud, folder } = await local(t);
  const add = (chosen: string, name = 'Other') =>
    cloud.addLocal({ scopeId: space.scopeId, path: chosen, contentsRoot: 'contents', name });
  await mkdir(path.join(space.root, 'contents'));
  await assert.rejects(add(space.root), /重なる/);
  await assert.rejects(add(path.join(space.root, 'contents')), /重なる/);
  await assert.rejects(add(base), /重なる/);
  await assert.rejects(add(files.dataDir), /重なる/);
  await assert.rejects(add(path.join(base, 'missing')), /見つかりません/);
  await assert.rejects(add('relative/path'), /見つかりません/);
  // A retired Drive connection still holds its name until it is switched or unregistered.
  await writeRetired(space, retiredDeclaration(space, { name: 'Drive' }));
  await assert.rejects(add(folder, 'drive'), /同じ名前/);
  await mkdir(path.join(space.root, 'contents', 'Kept'), { recursive: true });
  await assert.rejects(add(folder, 'kept'), /同じ名前/);
  const { mountId } = await add(folder, 'Research');
  await assert.rejects(add(folder, 'RESEARCH'), /同じ名前/);
  await assert.rejects(cloud.edit(space.scopeId, mountId, 'Drive'), /同じ名前/);
});

test('A replaced link or folder is refused, and links inside the folder are not followed', async (t) => {
  const { base, files, space, cloud, folder } = await local(t);
  const { mountId } = await cloud.addLocal({
    scopeId: space.scopeId,
    path: folder,
    contentsRoot: 'contents',
    name: 'Research',
  });
  await cloud.connect(space.scopeId, mountId);
  const outside = path.join(base, 'Outside');
  await mkdir(outside);
  await writeFile(path.join(outside, 'secret.md'), 'secret');
  await symlink(outside, path.join(folder, 'escape'));
  const inner = await files.entries(space.scopeId, 'contents/Research');
  assert(inner.find((item) => item.name === 'escape')?.blocked);
  await assert.rejects(files.read(space.scopeId, 'contents/Research/escape/secret.md'), /alias/);
  // The folder moved and another took its place: nothing is read from the newcomer.
  await rename(folder, `${folder}-moved`);
  await mkdir(folder);
  await writeFile(path.join(folder, 'note.md'), 'newcomer');
  await assert.rejects(files.read(space.scopeId, 'contents/Research/note.md'), /識別情報/);
  assert.equal((await cloud.connections(space.scopeId))[0].state, 'error');
  // The link was replaced: it is left alone on disconnect.
  const entry = path.join(space.root, 'contents', 'Research');
  await rm(entry);
  await symlink(outside, entry);
  await cloud.disconnect(space.scopeId, mountId);
  assert.equal(await readlink(entry), outside);
  await assert.rejects(cloud.connect(space.scopeId, mountId), /同じ名前/);
});

test('A link left by a stop without disconnecting is used again or cleared', async (t) => {
  const { files, space, cloud, folder } = await local(t);
  const { mountId } = await cloud.addLocal({
    scopeId: space.scopeId,
    path: folder,
    contentsRoot: 'contents',
    name: 'Research',
  });
  await cloud.connect(space.scopeId, mountId);
  // A new service stands for the next start after a crash: the link is still there.
  const restarted = new CloudService(files);
  files.cloud = restarted;
  assert.equal((await restarted.connections(space.scopeId))[0].state, 'disconnected');
  await restarted.connect(space.scopeId, mountId);
  assert.equal((await files.read(space.scopeId, 'contents/Research/note.md')).text, '# Synced\n');
  const again = new CloudService(files);
  files.cloud = again;
  await again.edit(space.scopeId, mountId, 'Renamed');
  await assert.rejects(lstat(path.join(space.root, 'contents', 'Research')), { code: 'ENOENT' });
  await again.edit(space.scopeId, mountId);
  assert.deepEqual(await again.connections(space.scopeId), []);
  assert.deepEqual(await readdir(folder), ['note.md']);
});

test('Another device binds its own folder, and deletion uses the system trash', async (t) => {
  const { base, space, cloud, folder, files, trashed } = await local(t);
  const { mountId } = await cloud.addLocal({
    scopeId: space.scopeId,
    path: folder,
    contentsRoot: 'contents',
    name: 'Research',
  });
  // Without this device's binding the connection waits for a folder to be chosen.
  await rm(path.join(files.dataDir, 'local-bindings'), { recursive: true });
  assert.equal((await cloud.connections(space.scopeId))[0].state, 'unconfigured');
  await assert.rejects(cloud.connect(space.scopeId, mountId), /フォルダを選んで/);
  const elsewhere = path.join(base, 'Dropbox', 'Papers');
  await mkdir(elsewhere, { recursive: true });
  await writeFile(path.join(elsewhere, 'old.md'), 'old');
  await cloud.bindLocal(space.scopeId, mountId, elsewhere);
  assert.equal((await cloud.connections(space.scopeId))[0].folderName, 'Papers');
  await cloud.connect(space.scopeId, mountId);
  await assert.rejects(cloud.bindLocal(space.scopeId, mountId, folder), /接続を解除/);
  await cloud.deleteEntry(space.scopeId, 'contents/Research/old.md');
  assert.deepEqual(trashed, [path.join(elsewhere, 'old.md')]);
  // Without a trash nothing local is deleted.
  const plain = new CloudService(files);
  files.cloud = plain;
  await plain.connect(space.scopeId, mountId);
  await writeFile(path.join(elsewhere, 'kept.md'), 'kept');
  await assert.rejects(plain.deleteEntry(space.scopeId, 'contents/Research/kept.md'), /ごみ箱/);
  assert.deepEqual(await readdir(elsewhere), ['kept.md']);
});
