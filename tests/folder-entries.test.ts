// Renaming, moving and deleting files and folders inside an editable connected
// folder, reached through the link irori makes in contents.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { draftFile } from '../src/host/files';
import { connectedFixture, connectionRoot as root, syncedFolder } from './fixtures/cloud';

const exists = (filename: string) =>
  stat(filename).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return false;
    },
  );

test('A file is renamed and moved in place, keeping its identity and bytes', async (t) => {
  const { cloud, space, target } = await connectedFixture(t, { writable: true });
  await writeFile(path.join(target, 'note.md'), '# Remote\n');
  await mkdir(path.join(target, 'Folder'));
  const inode = (await stat(path.join(target, 'note.md'))).ino;
  const renamed = await cloud.moveEntry(space.scopeId, `${root}/note.md`, `${root}/renamed.md`);
  assert.deepEqual(renamed, {
    path: `${root}/renamed.md`,
    name: 'renamed.md',
    directory: false,
    layer: 'contents',
    note: true,
    writable: true,
  });
  // The same file under a new name, so a sync app keeps its identity, history and sharing.
  assert.equal((await stat(path.join(target, 'renamed.md'))).ino, inode);
  assert.equal(await readFile(path.join(target, 'renamed.md'), 'utf8'), '# Remote\n');
  assert.equal(await exists(path.join(target, 'note.md')), false);
  const moved = await cloud.moveEntry(
    space.scopeId,
    `${root}/renamed.md`,
    `${root}/Folder/renamed.md`,
  );
  assert.equal(moved.path, `${root}/Folder/renamed.md`);
  assert.equal((await stat(path.join(target, 'Folder', 'renamed.md'))).ino, inode);
  assert.deepEqual(await readdir(target), ['Folder']);
  // A change of case alone is a rename as well, whatever the file system makes of case.
  const cased = await cloud.moveEntry(
    space.scopeId,
    `${root}/Folder/renamed.md`,
    `${root}/Folder/Renamed.md`,
  );
  assert.equal(cased.name, 'Renamed.md');
  assert.deepEqual(await readdir(path.join(target, 'Folder')), ['Renamed.md']);
  assert.equal((await stat(path.join(target, 'Folder', 'Renamed.md'))).ino, inode);
  const same = await cloud.moveEntry(
    space.scopeId,
    `${root}/Folder/Renamed.md`,
    `${root}/Folder/Renamed.md`,
  );
  assert.equal(same.path, `${root}/Folder/Renamed.md`);
  assert.deepEqual(await readdir(path.join(target, 'Folder')), ['Renamed.md']);
});

test('A folder is moved with everything inside it', async (t) => {
  const { cloud, space, target } = await connectedFixture(t, { writable: true });
  await mkdir(path.join(target, 'Folder', 'Inner'), { recursive: true });
  await mkdir(path.join(target, 'Archive'));
  await writeFile(path.join(target, 'Folder', 'Inner', 'deep.md'), '# Deep\n');
  const inode = (await stat(path.join(target, 'Folder'))).ino;
  const moved = await cloud.moveEntry(space.scopeId, `${root}/Folder`, `${root}/Archive/Project`);
  assert.deepEqual(moved, {
    path: `${root}/Archive/Project`,
    name: 'Project',
    directory: true,
    layer: 'contents',
    note: false,
    writable: true,
  });
  assert.equal((await stat(path.join(target, 'Archive', 'Project'))).ino, inode);
  assert.equal(
    await readFile(path.join(target, 'Archive', 'Project', 'Inner', 'deep.md'), 'utf8'),
    '# Deep\n',
  );
  assert.deepEqual(await readdir(target), ['Archive']);
});

test('Moves refuse occupied, foreign and impossible destinations and leave everything in place', async (t) => {
  const { base, cloud, space, target } = await connectedFixture(t, { writable: true });
  await writeFile(path.join(target, 'a.md'), 'A');
  await writeFile(path.join(target, 'b.md'), 'B');
  await writeFile(path.join(target, 'Équipe.md'), 'E');
  await mkdir(path.join(target, 'Folder', 'Inner'), { recursive: true });
  const rejects = (to: string, pattern: RegExp, from = `${root}/a.md`) =>
    assert.rejects(cloud.moveEntry(space.scopeId, from, to), pattern);
  await rejects(`${root}/b.md`, /同じ名前/);
  await rejects(`${root}/B.MD`, /同じ名前/);
  await rejects(`${root}/équipe.md`, /同じ名前/);
  await rejects(`${root}/Folder`, /同じ名前/);
  await rejects('contents/a.md', /同じ接続フォルダ/);
  await rejects('Knowledge_Base/a.md', /同じ接続フォルダ/);
  await rejects(`${root}/Missing/a.md`, /移動先のフォルダ/);
  await rejects(`${root}/b.md/a.md`, /フォルダを指定/);
  await rejects(`${root}/bad:name.md`, /使用できない文字/);
  await rejects(`${root}/nul.md`, /Windows/);
  await rejects(`${root}/trailing.md.`, /末尾/);
  await rejects(`${root}/../a.md`, /Invalid cloud path/);
  await rejects(`${root}/Folder/Inner/Folder`, /自分自身/, `${root}/Folder`);
  await rejects(`${root}/Folder/Folder`, /自分自身/, `${root}/Folder`);
  // The connection folder itself belongs to the connection dialog.
  await rejects('contents/Renamed', /接続フォルダ自体/, root);
  await assert.rejects(cloud.deleteEntry(space.scopeId, root), /接続フォルダ自体/);
  // Another connection of the same hibachi is a different folder.
  const otherTarget = await syncedFolder(base, 'Other');
  const other = await cloud.addLocal({
    scopeId: space.scopeId,
    path: otherTarget,
    contentsRoot: 'contents',
    name: 'Other fixture',
  });
  await cloud.connect(space.scopeId, other.mountId);
  await rejects(`contents/${other.name}/a.md`, /同じ接続フォルダ/);
  assert.deepEqual((await readdir(target)).sort(), ['Folder', 'a.md', 'b.md', 'Équipe.md']);
  assert.deepEqual(await readdir(otherTarget), []);
  assert.equal(await readFile(path.join(target, 'a.md'), 'utf8'), 'A');
  assert.equal(await exists(path.join(target, 'Folder', 'Inner')), true);
});

test('A read-only connection refuses moves and deletions', async (t) => {
  const { cloud, space, target, trashed } = await connectedFixture(t);
  await writeFile(path.join(target, 'note.md'), '# Remote\n');
  await assert.rejects(
    cloud.moveEntry(space.scopeId, `${root}/note.md`, `${root}/renamed.md`),
    /読み取り専用/,
  );
  await assert.rejects(cloud.deleteEntry(space.scopeId, `${root}/note.md`), /読み取り専用/);
  assert.deepEqual(await readdir(target), ['note.md']);
  assert.deepEqual(trashed, []);
});

test('Files and folders go to the system trash, and so does the draft of a removed file', async (t) => {
  const { cloud, files, space, target, trashed } = await connectedFixture(t, { writable: true });
  await writeFile(path.join(target, 'note.md'), '# Remote\n');
  await mkdir(path.join(target, 'Folder', 'Inner'), { recursive: true });
  await writeFile(path.join(target, 'Folder', 'Inner', 'deep.md'), '# Deep\n');
  await writeFile(path.join(target, 'Folder', 'kept.txt'), 'x');
  const doc = await files.read(space.scopeId, `${root}/note.md`);
  await files.draft({ ...doc, text: 'Unsaved' });
  assert.equal((await files.read(space.scopeId, `${root}/note.md`)).draft?.text, 'Unsaved');
  await cloud.deleteEntry(space.scopeId, `${root}/note.md`);
  assert.equal(await exists(path.join(target, 'note.md')), false);
  assert.equal(await exists(draftFile(files.dataDir, space.scopeId, `${root}/note.md`)), false);
  await cloud.deleteEntry(space.scopeId, `${root}/Folder`);
  assert.deepEqual(await readdir(target), []);
  // The trash is handed the folder's own paths, never the link in contents.
  assert.deepEqual(trashed, [path.join(target, 'note.md'), path.join(target, 'Folder')]);
  await assert.rejects(cloud.deleteEntry(space.scopeId, `${root}/note.md`), { code: 'ENOENT' });
});

test('A kept draft follows its file when the file is renamed or moved', async (t) => {
  const { cloud, files, space, target } = await connectedFixture(t, { writable: true });
  await writeFile(path.join(target, 'note.md'), '# Remote\n');
  await mkdir(path.join(target, 'Folder'));
  const doc = await files.read(space.scopeId, `${root}/note.md`);
  await files.draft({ ...doc, text: 'Unsaved' });
  // A draft left under the destination path belonged to a file that is gone.
  await files.draft({ ...doc, path: `${root}/Folder/renamed.md`, text: 'Stale' });
  await cloud.moveEntry(space.scopeId, `${root}/note.md`, `${root}/Folder/renamed.md`);
  assert.equal(await exists(draftFile(files.dataDir, space.scopeId, `${root}/note.md`)), false);
  const moved = await files.read(space.scopeId, `${root}/Folder/renamed.md`);
  assert.equal(moved.draft?.text, 'Unsaved');
  assert.equal(moved.hash, doc.hash);
  // A change of case alone carries the draft along too.
  await cloud.moveEntry(space.scopeId, `${root}/Folder/renamed.md`, `${root}/Folder/Renamed.md`);
  assert.equal(
    (await files.read(space.scopeId, `${root}/Folder/Renamed.md`)).draft?.text,
    'Unsaved',
  );
});

test('Files and folders of an editable connection are marked writable, and the connection folder is told apart', async (t) => {
  const { files, space, target } = await connectedFixture(t, { writable: true });
  await mkdir(path.join(target, 'Folder'));
  await writeFile(path.join(target, 'note.md'), '# Remote\n');
  const [connection] = await files.entries(space.scopeId, 'contents');
  assert.equal(connection.name, 'Connected fixture');
  assert.equal(connection.writable, true);
  assert.equal(connection.connection, true);
  assert.equal(connection.local, true);
  assert.deepEqual(
    (await files.entries(space.scopeId, root)).map((entry) => [
      entry.name,
      entry.writable,
      entry.connection,
    ]),
    [
      ['Folder', true, undefined],
      ['note.md', true, undefined],
    ],
  );
});

test('Files of a read-only connection are not marked writable', async (t) => {
  const { files, space, target } = await connectedFixture(t);
  await writeFile(path.join(target, 'note.md'), '# Remote\n');
  const [connection] = await files.entries(space.scopeId, 'contents');
  assert.equal(connection.blocked, undefined);
  assert.equal(connection.writable, undefined);
  assert.deepEqual(
    (await files.entries(space.scopeId, root)).map((entry) => [entry.name, entry.writable]),
    [['note.md', undefined]],
  );
});
