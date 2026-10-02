// Saving a file of a connected folder is checked against the file on disk: a sync app
// may have brought a change made on another device since the editor opened it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { hash } from '../src/host/files';
import { connectedFixture, connectionRoot } from './fixtures/cloud';

const rel = `${connectionRoot}/Folder/note.md`;

/** An editable connected note, opened in the editor. */
async function editable(t: any) {
  const value = await connectedFixture(t, { writable: true });
  const { files, space, target } = value;
  await mkdir(path.join(target, 'Folder'));
  await writeFile(path.join(target, 'Folder', 'note.md'), '# Remote\n');
  const opened = await files.read(space.scopeId, rel);
  return { ...value, opened, filename: path.join(target, 'Folder', 'note.md') };
}

test('A file unchanged on disk since it was opened is saved, keeping the previous version on this device', async (t) => {
  const { files, space, opened, filename } = await editable(t);
  const saved = await files.save({ ...opened, text: '# Remote\n\nEdited in irori\n' });
  assert.equal(saved.text, '# Remote\n\nEdited in irori\n');
  assert.equal(saved.draft, undefined);
  assert.equal(await readFile(filename, 'utf8'), '# Remote\n\nEdited in irori\n');
  // The version it replaced is kept among irori's data, never beside the file.
  assert.equal(
    await readFile(path.join(files.dataDir, `backup-${hash('# Remote\n')}.txt`), 'utf8'),
    '# Remote\n',
  );
  assert.deepEqual(await readdir(path.dirname(filename)), ['note.md']);
  // Saving the text the file already holds writes nothing and succeeds.
  const again = await files.save(saved);
  assert.equal(again.hash, saved.hash);
  assert.equal((await files.read(space.scopeId, rel)).draft, undefined);
});

test('A file changed on disk since it was opened is not overwritten, and the draft is kept', async (t) => {
  const { files, space, opened, filename } = await editable(t);
  // A sync app brings another device's change while the editor is open.
  await writeFile(filename, '# Remote\n\nChanged on another device\n');
  await assert.rejects(
    files.save({ ...opened, text: '# Remote\n\nEdited in irori\n' }),
    /CONFLICT/,
  );
  assert.equal(await readFile(filename, 'utf8'), '# Remote\n\nChanged on another device\n');
  const reopened = await files.read(space.scopeId, rel);
  assert.equal(reopened.text, '# Remote\n\nChanged on another device\n');
  assert.deepEqual(reopened.draft, {
    text: '# Remote\n\nEdited in irori\n',
    baseHash: opened.hash,
  });
  // Saved again from what is on disk now, the edit goes through and the draft is gone.
  const saved = await files.save({ ...reopened, text: `${reopened.text}\nMerged\n` });
  assert.equal(
    await readFile(filename, 'utf8'),
    '# Remote\n\nChanged on another device\n\nMerged\n',
  );
  assert.equal(saved.draft, undefined);
});

test('A disconnected folder is not written, and the draft waits for it to connect again', async (t) => {
  const { files, space, opened, filename, cloud, connection } = await editable(t);
  await cloud.disconnect(space.scopeId, connection.mountId);
  await assert.rejects(files.save({ ...opened, text: 'Edited offline' }), /未接続/);
  assert.equal(await readFile(filename, 'utf8'), '# Remote\n');
  // The draft stays for when the folder is connected again.
  await cloud.connect(space.scopeId, connection.mountId);
  assert.equal((await files.read(space.scopeId, rel)).draft?.text, 'Edited offline');
});
