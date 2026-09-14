import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { promises as fs } from 'node:fs';
import { FileService } from '../src/host/files';
import { ImageService } from '../src/host/images';
import { imagesForNoteMove } from '../src/domain/note-operations';

async function fixture(t: TestContext) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori-note-operations-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'KB');
  await mkdir(root);
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const space = await files.register(root, 'Notes', 'personal');
  return { base, root, files, id: space.scopeId, space };
}

test('Create notes in a selected folder or root, keeping the default and existing bytes', async (t) => {
  const { files, id } = await fixture(t);
  const original = await files.createNote(id, 'First');
  assert.equal(original.path, 'Knowledge_Base/Notes/First.md');
  const custom = await files.createNote(id, '日本語.md', 'Knowledge_Base/Projects/顧客');
  assert.equal(custom.path, 'Knowledge_Base/Projects/顧客/日本語.md');
  assert.equal((await files.createNote(id, 'Root', '')).path, 'Root.md');
  await assert.rejects(files.createNote(id, 'First'), { code: 'EEXIST' });
  assert.equal((await files.read(id, original.path)).text, original.text);
  for (const dir of [
    'schema',
    'contents',
    '.git',
    '../outside',
    'Knowledge_Base/../schema',
    '/tmp',
    'Knowledge_Base/alias\\child',
  ])
    await assert.rejects(files.createNote(id, 'Blocked', dir));
  for (const name of ['../escape', 'CON', 'trailing.', 'space ', 'bad\0name', '.hidden'])
    await assert.rejects(files.createNote(id, name));
});

test('Move preserves Markdown bytes and managed images; rename retains uppercase extensions', async (t) => {
  const { files, id, root } = await fixture(t);
  const note = await files.createNote(id, 'Images');
  const imageBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6VEQAAAAASUVORK5CYII=',
    'base64',
  );
  const url = await new ImageService(files).save(id, note.path, imageBytes);
  const text = `\ufeff# 画像\r\n\r\n![caption](${url})\r\n[web](https://example.invalid)\r\n`;
  const saved = await files.save({ ...note, text });
  await mkdir(path.join(root, 'Knowledge_Base/Archive'));
  const moved = await files.moveNote(saved, 'Knowledge_Base/Archive/画像.MD');
  assert.equal(moved.hash, saved.hash);
  assert.equal(moved.text, text);
  await assert.rejects(readFile(path.join(root, note.path)), { code: 'ENOENT' });
  assert.deepEqual(await readFile(path.join(root, 'Knowledge_Base/Archive', url)), imageBytes);
  assert.deepEqual(await readFile(path.join(root, 'Knowledge_Base/Notes', url)), imageBytes);
  const renamed = await files.moveNote(moved, 'Knowledge_Base/Archive/Renamed.md');
  assert.equal(renamed.hash, saved.hash);
});

test('Moving refuses occupied destinations and preserves the source and destination', async (t) => {
  const { files, id, root } = await fixture(t);
  const note = await files.createNote(id, 'Source');
  const occupied = await files.createNote(id, 'Occupied');
  await assert.rejects(files.moveNote(note, occupied.path), /既に/);
  assert.equal((await files.read(id, note.path)).hash, note.hash);
  assert.equal((await files.read(id, occupied.path)).hash, occupied.hash);
  await mkdir(path.join(root, 'Knowledge_Base/Notes/Directory.md'));
  await assert.rejects(files.moveNote(note, 'Knowledge_Base/Notes/Directory.md'), /既に/);
  await assert.rejects(files.moveNote(note, 'Knowledge_Base/Missing/Destination.md'), {
    code: 'ENOENT',
  });
  await assert.rejects(files.moveNote(note, 'schema/Blocked.md'));
  await assert.rejects(files.moveNote(note, 'contents/Blocked.md'));
});

test('Relative outgoing links block folder moves while same-folder rename remains available', async (t) => {
  const { files, id, root } = await fixture(t);
  const note = await files.createNote(id, 'Linked');
  const saved = await files.save({ ...note, text: '# Linked\n\n[other](../Other.md)\n' });
  await mkdir(path.join(root, 'Knowledge_Base/Archive'));
  await assert.rejects(files.moveNote(saved, 'Knowledge_Base/Archive/Linked.md'), /相対リンク/);
  assert.equal((await files.moveNote(saved, 'Knowledge_Base/Notes/Renamed.md')).hash, saved.hash);
  for (const content of [
    '![custom](custom.png)',
    '[[Other]]',
    '[link][target]',
    '[target]: target.md',
    '<img src="relative.png">',
    '[nested [label]](../Other.md)',
  ])
    assert.throws(() => imagesForNoteMove(content), /相対リンク/);
  assert.deepEqual(
    imagesForNoteMove(
      '[web](https://example.invalid) [mail](mailto:a@example.invalid) [here](#heading)',
    ),
    [],
  );
});

test('Changes or unresolved drafts block move and trash without deleting the note', async (t) => {
  const { files, id, root } = await fixture(t);
  const note = await files.createNote(id, 'Changed');
  await writeFile(path.join(root, note.path), 'External changes');
  await assert.rejects(files.moveNote(note, 'Knowledge_Base/Notes/New.md'), /CONFLICT/);
  await assert.rejects(files.trashNote(note), /CONFLICT/);
  const current = await files.read(id, note.path);
  await files.draft({ ...current, text: 'Retained unsaved draft' });
  await assert.rejects(files.moveNote(current, 'Knowledge_Base/Notes/New.md'), /下書き/);
  await assert.rejects(files.trashNote(current), /下書き/);
  assert.equal((await files.read(id, note.path)).text, 'External changes');
  assert.deepEqual(await files.trashedNotes(id), []);
});

test(
  'Create, move, trash and restore reject aliases, including links within the same KB',
  { skip: process.platform === 'win32' },
  async (t) => {
    const { files, id, root } = await fixture(t);
    const note = await files.createNote(id, 'Safe');
    await symlink(path.join(root, 'Knowledge_Base/Notes'), path.join(root, 'Alias'), 'dir');
    await assert.rejects(files.createNote(id, 'Aliased', 'Alias'), /alias/);
    await assert.rejects(files.moveNote(note, 'Alias/New.md'), /alias/);
    await symlink(path.join(root, note.path), path.join(root, 'Linked.md'));
    await assert.rejects(files.trashNote({ ...note, path: 'Linked.md' }), /通常/);
    await assert.rejects(files.moveNote(note, 'Linked.md'), /既に/);
    const deleted = await files.trashNote(note);
    await rename(path.join(root, 'Knowledge_Base/Notes'), path.join(root, 'Actual'));
    await symlink(path.join(root, 'Actual'), path.join(root, 'Knowledge_Base/Notes'), 'dir');
    await assert.rejects(files.restoreNote(id, deleted.id), /alias/);
    assert.deepEqual(await readdir(path.join(root, 'Actual')), []);
  },
);

test('Nested registered scopes and custom contents remain ownership boundaries', async (t) => {
  const { files, id, root, space } = await fixture(t);
  const note = await files.createNote(id, 'Parent');
  await mkdir(path.join(root, 'Knowledge_Base/Team'));
  const nested = await files.register(path.join(root, 'Knowledge_Base/Team'), 'Team', 'team');
  const nestedNote = await files.createNote(nested.scopeId, 'Nested');
  await assert.rejects(files.createNote(id, 'Wrong owner', 'Knowledge_Base/Team'));
  await assert.rejects(files.moveNote(note, 'Knowledge_Base/Team/Wrong.md'));
  await assert.rejects(
    files.trashNote({ ...nestedNote, scopeId: id, path: `Knowledge_Base/Team/${nestedNote.path}` }),
  );
  space.contents.push('Knowledge_Base/Cloud');
  await assert.rejects(files.createNote(id, 'Cloud', 'Knowledge_Base/Cloud'));
  await assert.rejects(files.moveNote(note, 'Knowledge_Base/Cloud/Cloud.md'));
});

test('Trash survives restart and restores exact bytes into an unoccupied original location', async (t) => {
  const { files, id, root } = await fixture(t);
  const note = await files.createNote(id, 'Recoverable');
  const saved = await files.save({ ...note, text: '\ufeff# Keep\r\n\r\n日本語\r\n' });
  const deleted = await files.trashNote(saved);
  await assert.rejects(readFile(path.join(root, note.path)), { code: 'ENOENT' });
  const restarted = new FileService(files.dataDir);
  await restarted.init();
  assert.deepEqual(await restarted.trashedNotes(id), [deleted]);
  await writeFile(path.join(root, note.path), 'A different note now owns this path');
  await assert.rejects(restarted.restoreNote(id, deleted.id), { code: 'EEXIST' });
  assert.equal(
    await readFile(path.join(root, note.path), 'utf8'),
    'A different note now owns this path',
  );
  await rename(path.join(root, note.path), path.join(root, 'Occupied.md'));
  const restored = await restarted.restoreNote(id, deleted.id);
  assert.equal(restored.hash, saved.hash);
  assert.equal(restored.text, saved.text);
  assert.deepEqual(await restarted.trashedNotes(id), []);
  await assert.rejects(restarted.restoreNote(id, deleted.id), /確認/);
});

test('Restore rejects another scope and corrupted retained bytes', async (t) => {
  const { files, id, root, base } = await fixture(t);
  const note = await files.createNote(id, 'Retained');
  const deleted = await files.trashNote(note);
  await mkdir(path.join(base, 'Other'));
  const other = await files.register(path.join(base, 'Other'), 'Other', 'team');
  await assert.rejects(files.restoreNote(other.scopeId, deleted.id), /確認/);
  assert.deepEqual(await files.trashedNotes(other.scopeId), []);
  const filename = path.join(files.dataDir, 'note-trash', `${deleted.id}.json`);
  const record = JSON.parse(await readFile(filename, 'utf8'));
  await writeFile(filename, JSON.stringify({ ...record, text: 'Tampered bytes' }));
  await assert.rejects(files.restoreNote(id, deleted.id), /一致/);
  await assert.rejects(readFile(path.join(root, note.path)), { code: 'ENOENT' });
  await assert.rejects(files.restoreNote(id, '../escape'));
});

test('Changed or conflicting managed image assets stop a move before source deletion', async (t) => {
  const { files, id, root } = await fixture(t);
  const note = await files.createNote(id, 'Image');
  const bytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6VEQAAAAASUVORK5CYII=',
    'base64',
  );
  const url = await new ImageService(files).save(id, note.path, bytes);
  const saved = await files.save({ ...note, text: `![image](${url})\n` });
  await mkdir(path.join(root, 'Knowledge_Base/Archive/_assets'), { recursive: true });
  await writeFile(path.join(root, 'Knowledge_Base/Archive', url), 'Occupied image');
  await assert.rejects(files.moveNote(saved, 'Knowledge_Base/Archive/Image.md'), /一致/);
  assert.equal((await files.read(id, note.path)).hash, saved.hash);
  await writeFile(path.join(root, 'Knowledge_Base/Notes', url), 'Changed source image');
  await assert.rejects(files.moveNote(saved, 'Knowledge_Base/Archive/Image.md'), /画像が変更/);
  assert.equal((await files.read(id, note.path)).hash, saved.hash);
});

test('Trash record write failure leaves the original note intact', async (t) => {
  const { files, id } = await fixture(t);
  const note = await files.createNote(id, 'Retained');
  await writeFile(
    path.join(files.dataDir, 'note-trash'),
    'A fixture blocks the recovery directory',
  );
  await assert.rejects(files.trashNote(note));
  assert.equal((await files.read(id, note.path)).hash, note.hash);
});

test('Restore reports successful recovery when its subsequent ledger update fails', async (t) => {
  const { files, id } = await fixture(t);
  const note = await files.createNote(id, 'Restore');
  const deleted = await files.trashNote(note);
  const recordPath = path.join(files.dataDir, 'note-trash', `${deleted.id}.json`);
  const lstat = fs.lstat.bind(fs);
  t.mock.method(fs, 'lstat', async (...args: Parameters<typeof fs.lstat>) => {
    if (args[0] === recordPath)
      throw Object.assign(Error('Fixture ledger write failure'), { code: 'EIO' });
    return lstat(...args);
  });
  const restored = await files.restoreNote(id, deleted.id);
  assert.equal(restored.hash, note.hash);
  assert.match(restored.notice ?? '', /復元しましたが/);
  assert.equal((await files.read(id, note.path)).text, note.text);
  assert.equal(JSON.parse(await readFile(recordPath, 'utf8')).restored, false);
});

test('Recovery bytes cannot cross into a copied checkout with the same portable scope ID', async (t) => {
  const { files, id, root, base } = await fixture(t);
  const note = await files.createNote(id, 'Private checkout note');
  const deleted = await files.trashNote(note);
  const copy = path.join(base, 'Copy');
  await mkdir(path.join(copy, '.irori'), { recursive: true });
  await writeFile(
    path.join(copy, '.irori/scope.json'),
    await readFile(path.join(root, '.irori/scope.json')),
  );
  await writeFile(
    path.join(files.dataDir, 'spaces.json'),
    JSON.stringify([{ root: copy, scopeId: id }]),
  );
  const rebound = new FileService(files.dataDir);
  await rebound.init();
  assert.deepEqual(await rebound.trashedNotes(id), []);
  await assert.rejects(rebound.restoreNote(id, deleted.id), /確認/);
  assert.deepEqual(await readdir(copy), ['.irori']);
});

test('A destination occupied after preflight is never overwritten by move', async (t) => {
  const { files, id, root } = await fixture(t);
  const note = await files.createNote(id, 'Original');
  const destination = 'Knowledge_Base/Notes/Destination.md';
  const filename = path.join(root, destination);
  const open = fs.open.bind(fs);
  t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
    if (args[0] === filename && args[1] === 'wx')
      await writeFile(filename, 'A racing external file', { flag: 'wx' });
    return open(...args);
  });
  await assert.rejects(files.moveNote(note, destination), { code: 'EEXIST' });
  assert.equal((await files.read(id, note.path)).hash, note.hash);
  assert.equal(await readFile(filename, 'utf8'), 'A racing external file');
});

test('A source changed during move is retained alongside the exclusive destination copy', async (t) => {
  const { files, id, root } = await fixture(t);
  const note = await files.createNote(id, 'Original');
  const destination = 'Knowledge_Base/Notes/Destination.md';
  const filename = path.join(root, destination);
  const open = fs.open.bind(fs);
  t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
    if (args[0] === filename && args[1] === 'wx')
      await writeFile(path.join(root, note.path), 'External edit during move');
    return open(...args);
  });
  await assert.rejects(files.moveNote(note, destination), /CONFLICT/);
  assert.equal(await readFile(path.join(root, note.path), 'utf8'), 'External edit during move');
  assert.equal(await readFile(filename, 'utf8'), note.text);
});

test('A failed destination flush cannot delete the move source', async (t) => {
  const { files, id, root } = await fixture(t);
  const note = await files.createNote(id, 'Original');
  const destination = 'Knowledge_Base/Notes/Destination.md';
  const filename = path.join(root, destination);
  const open = fs.open.bind(fs);
  t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
    const handle = await open(...args);
    if (args[0] === filename && args[1] === 'wx')
      t.mock.method(handle, 'sync', async () => {
        throw Error('Fixture flush failure');
      });
    return handle;
  });
  await assert.rejects(files.moveNote(note, destination), /flush failure/);
  assert.equal((await files.read(id, note.path)).hash, note.hash);
});

test('Case-insensitive filesystems reject an occupied destination with different casing', async (t) => {
  const { files, id, root } = await fixture(t);
  const note = await files.createNote(id, 'Original');
  const occupied = await files.createNote(id, 'Occupied');
  const variant = 'Knowledge_Base/Notes/OCCUPIED.md';
  const aliases = await readFile(path.join(root, variant))
    .then(() => true)
    .catch(() => false);
  if (!aliases) {
    t.skip('Fixture filesystem is case-sensitive');
    return;
  }
  await assert.rejects(files.moveNote(note, variant));
  assert.equal((await files.read(id, occupied.path)).hash, occupied.hash);
  assert.equal((await files.read(id, note.path)).hash, note.hash);
});
