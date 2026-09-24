// Saving a Drive file is checked against Drive itself, not only the mount: rclone learns
// of a change made elsewhere by polling, so the mount can be behind Drive at a save.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { mountedFixture } from './fixtures/cloud';

const md5 = (text: string) => createHash('md5').update(text).digest('hex');
const rel = 'contents/Mounted fixture/Folder/note.md';

/** An editable mounted note; Drive's answer and rclone's upload queue come from `drive`. */
async function editable(t: any) {
  const value = await mountedFixture(t, { writable: true });
  const { files, space, target, rpc } = value;
  await mkdir(path.join(target, 'Folder'));
  await writeFile(path.join(target, 'Folder', 'note.md'), '# Remote\n');
  const drive = {
    item: {
      Path: 'Folder/note.md',
      Name: 'note.md',
      Size: 9,
      IsDir: false,
      Hashes: { md5: md5('# Remote\n') },
    } as any,
    queue: [] as { name: string; uploading: boolean }[],
    statFails: false,
  };
  const original = rpc.call.bind(rpc);
  rpc.call = async (method, params) => {
    if (['operations/stat', 'vfs/queue', 'vfs/refresh'].includes(method)) {
      rpc.calls.push({ method, params });
      if (method === 'vfs/queue') return { queue: drive.queue };
      if (method === 'vfs/refresh') return { result: { [String(params?.dir)]: 'OK' } };
      if (drive.statFails) throw Error('The cloud operation failed');
      return { item: drive.item };
    }
    return original(method, params);
  };
  const opened = await files.read(space.scopeId, rel);
  return { ...value, drive, opened };
}
const requested = (rpc: { calls: { method: string; params: any }[] }, method: string) =>
  rpc.calls.filter((call) => call.method === method).map((call) => call.params);

test('A file whose version in Drive is the one the editor started from is saved', async (t) => {
  const { files, target, rpc, remote, opened } = await editable(t);
  const saved = await files.save({ ...opened, text: '# Remote\n\nEdited in irori\n' });
  assert.equal(saved.text, '# Remote\n\nEdited in irori\n');
  assert.equal(
    await readFile(path.join(target, 'Folder', 'note.md'), 'utf8'),
    '# Remote\n\nEdited in irori\n',
  );
  // Drive is asked through the mount's own fs spec, for the file's MD5 checksum only.
  assert.deepEqual(requested(rpc, 'operations/stat'), [
    { fs: remote, remote: 'Folder/note.md', opt: { filesOnly: true, hashTypes: ['md5'] } },
  ]);
  assert.deepEqual(requested(rpc, 'vfs/queue'), [{ fs: 'fixture:' }]);
  assert.deepEqual(requested(rpc, 'vfs/refresh'), []);
});

test('A file changed in Drive since it was opened is not overwritten: the draft is kept and the mount refreshed', async (t) => {
  const { files, space, target, rpc, drive, opened } = await editable(t);
  drive.item.Hashes.md5 = md5('# Remote\n\nChanged on another device\n');
  // Another file waiting to upload does not stand in for this one.
  drive.queue = [{ name: 'Folder/other.md', uploading: false }];
  await assert.rejects(
    files.save({ ...opened, text: '# Remote\n\nEdited in irori\n' }),
    /CONFLICT/,
  );
  assert.equal(await readFile(path.join(target, 'Folder', 'note.md'), 'utf8'), '# Remote\n');
  assert.equal((await files.read(space.scopeId, rel)).draft?.text, '# Remote\n\nEdited in irori\n');
  assert.deepEqual(requested(rpc, 'vfs/refresh'), [{ fs: 'fixture:', dir: 'Folder' }]);
  // A file at the mount's root refreshes the root directory.
  await writeFile(path.join(target, 'top.md'), '# Top\n');
  const top = await files.read(space.scopeId, 'contents/Mounted fixture/top.md');
  await assert.rejects(files.save({ ...top, text: '# Top\n\nEdited\n' }), /CONFLICT/);
  assert.deepEqual(requested(rpc, 'vfs/refresh').at(-1), { fs: 'fixture:', dir: '' });
  assert.equal(await readFile(path.join(target, 'top.md'), 'utf8'), '# Top\n');
});

test('A file still in rclone’s upload queue is saved without being compared with Drive', async (t) => {
  const { files, target, rpc, drive, opened } = await editable(t);
  // Drive holds the version before our earlier save, which is still being uploaded.
  drive.item.Hashes.md5 = md5('# Older version in Drive\n');
  drive.queue = [{ name: 'Folder/note.md', uploading: true }];
  const saved = await files.save({ ...opened, text: '# Remote\n\nEdited again\n' });
  assert.equal(saved.text, '# Remote\n\nEdited again\n');
  assert.equal(
    await readFile(path.join(target, 'Folder', 'note.md'), 'utf8'),
    '# Remote\n\nEdited again\n',
  );
  assert.deepEqual(requested(rpc, 'operations/stat'), []);
  assert.deepEqual(requested(rpc, 'vfs/refresh'), []);
});

test('When Drive cannot be asked or has no checksum for the file, the save goes ahead', async (t) => {
  const { files, target, rpc, drive, opened } = await editable(t);
  drive.statFails = true;
  let saved = await files.save({ ...opened, text: '# Remote\n\nOffline edit\n' });
  assert.equal(saved.text, '# Remote\n\nOffline edit\n');
  // A Google Docs file has no checksum.
  drive.statFails = false;
  drive.item = { Path: 'Folder/note.md', Name: 'note.md', Size: 0, IsDir: false };
  saved = await files.save({ ...saved, text: '# Remote\n\nSecond edit\n' });
  assert.equal(saved.text, '# Remote\n\nSecond edit\n');
  // A file Drive no longer lists is written; rclone's upload puts it back.
  drive.item = null;
  saved = await files.save({ ...saved, text: '# Remote\n\nThird edit\n' });
  assert.equal(
    await readFile(path.join(target, 'Folder', 'note.md'), 'utf8'),
    '# Remote\n\nThird edit\n',
  );
  assert.equal(requested(rpc, 'operations/stat').length, 3);
  assert.deepEqual(requested(rpc, 'vfs/refresh'), []);
});
