// Google Drive connections irori made itself before 0.1.67 are listed as retired: they
// can be unregistered or switched to a folder on this computer, nothing else (ADR 023).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import type { CloudAttachment, Space } from '../src/domain/types';
import { fixture, retiredDeclaration, syncedFolder, writeRetired } from './fixtures/cloud';

const retiredMessage = /Google Drive への直接接続は終了しました/;
const exists = (filename: string) =>
  lstat(filename).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return false;
    },
  );
const declared = async (space: Space, name: string) =>
  JSON.parse(await readFile(path.join(space.root, '.irori', name), 'utf8').catch(() => '[]'));

/**
 * The device record a Drive connection had, with the identity of the folder irori
 * made as its mount point when `placeholder` names one.
 */
async function deviceRecord(
  dataDir: string,
  space: Space,
  record: CloudAttachment,
  placeholder?: string,
) {
  const info = placeholder ? await stat(placeholder) : undefined;
  const filename = path.join(dataDir, 'cloud-bindings', `${space.scopeId}-${record.mountId}.json`);
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(
    filename,
    JSON.stringify({
      scopeId: space.scopeId,
      mountId: record.mountId,
      root: space.root,
      accountId: '00000000-0000-4000-8000-000000000000',
      ...(info ? { placeholder: { dev: info.dev, ino: info.ino } } : {}),
    }),
  );
  return filename;
}

test('Retired Drive connections are listed after folders and blocked in contents', async (t) => {
  const { base, files, space, cloud } = await fixture(t);
  const drive = retiredDeclaration(space, { name: '共有 資料' });
  const readOnly = retiredDeclaration(space, { name: 'Reports', access: 'read-only' });
  await writeRetired(space, drive, readOnly);
  const local = await cloud.addLocal({
    scopeId: space.scopeId,
    path: await syncedFolder(base),
    contentsRoot: 'contents',
    name: 'Local',
  });
  const connections = await cloud.connections(space.scopeId);
  assert.deepEqual(
    connections.map((item) => [item.mountId, item.provider, item.state, item.access]),
    [
      [local.mountId, 'local', 'disconnected', 'read-write'],
      [drive.mountId, 'google-drive', 'retired', 'read-write'],
      [readOnly.mountId, 'google-drive', 'retired', 'read-only'],
    ],
  );
  assert.match(connections[1].detail!, retiredMessage);
  assert.equal(connections[1].writable, undefined);
  const entries = await files.entries(space.scopeId, 'contents');
  const retired = entries.find((entry) => entry.name === '共有 資料')!;
  assert.equal(retired.connection, true);
  assert.equal(retired.local, undefined);
  assert.equal(retired.writable, undefined);
  assert.match(retired.blocked!, retiredMessage);
  await assert.rejects(files.read(space.scopeId, 'contents/共有 資料/note.md'), /未接続/);
  await assert.rejects(files.entries(space.scopeId, 'contents/共有 資料'), /未接続/);
});

test('A retired connection cannot be connected, renamed or have its access changed', async (t) => {
  const { space, cloud } = await fixture(t);
  const record = retiredDeclaration(space);
  await writeRetired(space, record);
  await assert.rejects(cloud.connect(space.scopeId, record.mountId), retiredMessage);
  await assert.rejects(cloud.setAccess(space.scopeId, record.mountId, 'read-only'), retiredMessage);
  await assert.rejects(cloud.edit(space.scopeId, record.mountId, 'Renamed'), retiredMessage);
  await assert.rejects(cloud.bindLocal(space.scopeId, record.mountId, '/'), /Unknown/);
  assert.deepEqual(await declared(space, 'cloud-mounts.json'), [record]);
  assert.equal((await cloud.connections(space.scopeId))[0].state, 'retired');
});

test(
  'Unregistering a retired connection removes its records and the empty folder irori made for it',
  { skip: process.platform === 'win32' && 'POSIX placeholder fixture' },
  async (t) => {
    const { files, space, cloud } = await fixture(t);
    const record = retiredDeclaration(space);
    const other = retiredDeclaration(space, { name: 'Other' });
    await writeRetired(space, record, other);
    const placeholder = path.join(space.root, 'contents', 'Drive');
    await mkdir(placeholder, { recursive: true });
    // irori made its mount points without permissions, so nothing could be put in one.
    await chmod(placeholder, 0);
    const binding = await deviceRecord(files.dataDir, space, record, placeholder);
    const otherBinding = await deviceRecord(files.dataDir, space, other);
    await cloud.edit(space.scopeId, record.mountId);
    assert.deepEqual(await declared(space, 'cloud-mounts.json'), [other]);
    assert.equal(await exists(binding), false);
    assert.equal(await exists(placeholder), false);
    // Another retired connection keeps its records.
    assert.equal(await exists(otherBinding), true);
    assert.deepEqual(
      (await cloud.connections(space.scopeId)).map((item) => item.mountId),
      [other.mountId],
    );
    await assert.rejects(cloud.edit(space.scopeId, record.mountId), /Unknown cloud connection/);
  },
);

test(
  'Unregistering a retired connection never removes a folder with contents or with another identity',
  { skip: process.platform === 'win32' && 'POSIX placeholder fixture' },
  async (t) => {
    const { base, files, space, cloud } = await fixture(t);
    // The folder irori made, with something put in it since.
    const filled = retiredDeclaration(space, { name: 'Filled' });
    // Another folder at the place irori made one, told apart by its identity.
    const replaced = retiredDeclaration(space, { name: 'Replaced' });
    // A link at that place, and a folder without any device record.
    const linked = retiredDeclaration(space, { name: 'Linked' });
    const unrecorded = retiredDeclaration(space, { name: 'Unrecorded' });
    await writeRetired(space, filled, replaced, linked, unrecorded);
    const contents = path.join(space.root, 'contents');
    for (const name of ['Filled', 'Replaced', 'Unrecorded'])
      await mkdir(path.join(contents, name), { recursive: true });
    await writeFile(path.join(contents, 'Filled', 'keep.md'), 'Keep');
    await chmod(path.join(contents, 'Filled'), 0o500);
    await deviceRecord(files.dataDir, space, filled, path.join(contents, 'Filled'));
    const elsewhere = path.join(base, 'Elsewhere');
    await mkdir(elsewhere);
    await deviceRecord(files.dataDir, space, replaced, elsewhere);
    const linkTarget = await syncedFolder(base, 'Linked');
    await symlink(linkTarget, path.join(contents, 'Linked'), 'dir');
    await deviceRecord(files.dataDir, space, linked, linkTarget);
    for (const record of [filled, replaced, linked, unrecorded])
      await cloud.edit(space.scopeId, record.mountId);
    assert.deepEqual(await declared(space, 'cloud-mounts.json'), []);
    assert.deepEqual(await readdir(path.join(files.dataDir, 'cloud-bindings')), []);
    assert.deepEqual(
      (await readdir(contents)).sort(),
      ['Filled', 'Linked', 'Replaced', 'Unrecorded'].sort(),
    );
    // The filled folder keeps its bytes and the permissions it had.
    assert.equal(await readFile(path.join(contents, 'Filled', 'keep.md'), 'utf8'), 'Keep');
    assert.equal((await stat(path.join(contents, 'Filled'))).mode & 0o777, 0o500);
    await chmod(path.join(contents, 'Filled'), 0o700); // Lets the disposable fixture be removed.
    assert.equal(await readlink(path.join(contents, 'Linked')), linkTarget);
    assert.equal(await exists(elsewhere), true);
    // What stays is shown as local data that is not registered.
    const entries = await files.entries(space.scopeId, 'contents');
    assert.ok(entries.every((entry) => entry.blocked?.includes('登録されていない')));
  },
);

test(
  'Switching to a folder keeps the identity, name, place and access, and connecting links it',
  { skip: process.platform === 'win32' && 'POSIX placeholder fixture' },
  async (t) => {
    const { base, files, space, cloud } = await fixture(t);
    const record = retiredDeclaration(space, { name: '調査 資料', access: 'read-only' });
    const other = retiredDeclaration(space, { name: 'Other' });
    await writeRetired(space, record, other);
    const placeholder = path.join(space.root, 'contents', '調査 資料');
    await mkdir(placeholder, { recursive: true });
    await chmod(placeholder, 0);
    const binding = await deviceRecord(files.dataDir, space, record, placeholder);
    // Drive for desktop keeps the same Drive folder on this device.
    const folder = await syncedFolder(base, 'Research');
    await writeFile(path.join(folder, 'note.md'), '# Synced\n');
    // A folder overlapping the hibachi is refused, and the retired record stays as it was.
    await assert.rejects(cloud.switchToLocal(space.scopeId, record.mountId, space.root), /重なる/);
    assert.deepEqual(await declared(space, 'cloud-mounts.json'), [record, other]);
    assert.equal(await exists(binding), true);
    await assert.rejects(
      cloud.switchToLocal(space.scopeId, '00000000-0000-4000-8000-000000000000', folder),
      /Unknown cloud connection/,
    );
    await cloud.switchToLocal(space.scopeId, record.mountId, folder);
    assert.deepEqual(await declared(space, 'cloud-mounts.json'), [other]);
    assert.deepEqual(await declared(space, 'local-folders.json'), [
      {
        schemaVersion: 1,
        mountId: record.mountId,
        scopeId: space.scopeId,
        provider: 'local',
        folderName: 'Research',
        contentsRoot: 'contents',
        name: '調査 資料',
        access: 'read-only',
      },
    ]);
    // The hibachi's record names the connection, never this device's path.
    assert.ok(
      !(await readFile(path.join(space.root, '.irori', 'local-folders.json'), 'utf8')).includes(
        base,
      ),
    );
    assert.equal(await exists(binding), false);
    assert.equal(await exists(placeholder), false);
    const [switched] = await cloud.connections(space.scopeId);
    assert.deepEqual(
      [switched.mountId, switched.provider, switched.state],
      [record.mountId, 'local', 'disconnected'],
    );
    // Switched once, it is no longer a retired connection.
    await assert.rejects(
      cloud.switchToLocal(space.scopeId, record.mountId, folder),
      /Unknown cloud connection/,
    );
    await cloud.connect(space.scopeId, record.mountId);
    assert.equal(await readlink(placeholder), folder);
    const doc = await files.read(space.scopeId, 'contents/調査 資料/note.md');
    assert.equal(doc.text, '# Synced\n');
    assert.equal(doc.readOnly, true);
    await assert.rejects(files.save({ ...doc, text: 'Changed' }), /読み取り専用/);
  },
);

test('A folder left at a switched connection’s place is kept, and connecting asks to clear it', async (t) => {
  const { base, files, space, cloud } = await fixture(t);
  const record = retiredDeclaration(space);
  await writeRetired(space, record);
  const left = path.join(space.root, 'contents', 'Drive');
  await mkdir(left, { recursive: true });
  await writeFile(path.join(left, 'local.md'), 'Kept');
  await deviceRecord(files.dataDir, space, record, left);
  const folder = await syncedFolder(base);
  await cloud.switchToLocal(space.scopeId, record.mountId, folder);
  assert.equal(await readFile(path.join(left, 'local.md'), 'utf8'), 'Kept');
  await assert.rejects(cloud.connect(space.scopeId, record.mountId), /同じ名前/);
  assert.equal((await cloud.connections(space.scopeId))[0].state, 'error');
  assert.equal(await readFile(path.join(left, 'local.md'), 'utf8'), 'Kept');
});

test('A retired connection’s name stays taken for new folders until it is unregistered', async (t) => {
  const { base, space, cloud } = await fixture(t);
  const record = retiredDeclaration(space, { name: 'Équipe' });
  await writeRetired(space, record);
  const folder = await syncedFolder(base);
  const add = (name: string) =>
    cloud.addLocal({ scopeId: space.scopeId, path: folder, contentsRoot: 'contents', name });
  await assert.rejects(add('équipe'), /同じ名前/);
  await assert.rejects(add('ÉQUIPE'), /同じ名前/);
  assert.deepEqual(await declared(space, 'local-folders.json'), []);
  await cloud.edit(space.scopeId, record.mountId);
  const added = await add('équipe');
  assert.equal(added.provider, 'local');
});
