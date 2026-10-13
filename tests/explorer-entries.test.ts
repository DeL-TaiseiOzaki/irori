import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { draftFile, FileService } from '../src/host/files';
import { carryMove } from '../src/host/layer-folders';
import { addNoteComment, readNoteComments } from '../src/host/comments';
import { appendUpload, discardUpload, freeName } from '../src/host/entries';
import { hostArguments } from '../src/domain/host-requests';
import { broughtChunkBytes } from '../src/domain/connections';
import { connectedFixture, connectionRoot } from './fixtures/cloud';

async function fixture(t: TestContext) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori explorer '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const root = path.join(base, 'KB');
  await mkdir(root);
  const space = await files.register(root, 'Explorer', 'personal');
  const write = async (relative: string, text: string) => {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
  };
  const read = (relative: string) => readFile(path.join(root, relative), 'utf8');
  const exists = (relative: string) =>
    lstat(path.join(root, relative)).then(
      () => true,
      () => false,
    );
  return { base, root, files, id: space.scopeId, write, read, exists };
}

const git = { userEmail: async () => 'person@example.com' };

test('Knowledge takes new folders and files of any kind, never over an existing name', async (t) => {
  const { files, id, read, exists } = await fixture(t);
  const folder = await files.createEntry(id, 'Knowledge_Base', { kind: 'folder', name: '資料' });
  assert.deepEqual(folder, {
    path: 'Knowledge_Base/資料',
    name: '資料',
    directory: true,
    layer: 'Knowledge_Base',
    note: false,
  });
  const file = await files.createEntry(id, 'Knowledge_Base/資料', {
    kind: 'file',
    name: 'data.csv',
  });
  assert.equal(file.path, 'Knowledge_Base/資料/data.csv');
  assert.equal(await read('Knowledge_Base/資料/data.csv'), '');
  // A name that differs only in case is the same name on a Mac or Windows.
  await assert.rejects(
    files.createEntry(id, 'Knowledge_Base/資料', { kind: 'folder', name: 'DATA.csv' }),
    /同じ名前/,
  );
  await assert.rejects(
    files.createEntry(id, 'Knowledge_Base', { kind: 'file', name: '.hidden' }),
    /「\.」/,
  );
  await assert.rejects(
    files.createEntry(id, 'Knowledge_Base', { kind: 'file', name: 'a/b.txt' }),
    /パス区切り/,
  );
  // A folder that is not there is not made on the way.
  await assert.rejects(
    files.createEntry(id, 'Knowledge_Base/none', { kind: 'file', name: 'x.txt' }),
  );
  assert.equal(await exists('Knowledge_Base/none'), false);
  // Contents and Schema are not knowledge.
  await assert.rejects(
    files.createEntry(id, 'contents', { kind: 'file', name: 'x.txt' }),
    /ナレッジ/,
  );
  await assert.rejects(files.createEntry(id, '.agents', { kind: 'file', name: 'x.txt' }));
});

test('A file brought in keeps its bytes and takes a free name beside one it would replace', async (t) => {
  const { files, id, root } = await fixture(t);
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]);
  await mkdir(path.join(root, 'Knowledge_Base'));
  const first = await files.createEntry(id, 'Knowledge_Base', {
    kind: 'file',
    name: 'report.pdf',
    bytes,
  });
  const second = await files.createEntry(id, 'Knowledge_Base', {
    kind: 'file',
    name: 'Report.pdf',
    bytes,
  });
  assert.equal(first.name, 'report.pdf');
  assert.equal(second.name, 'Report 2.pdf');
  assert.deepEqual(
    new Uint8Array(await readFile(path.join(root, 'Knowledge_Base', 'Report 2.pdf'))),
    bytes,
  );
  assert.equal(await freeName(path.join(root, 'Knowledge_Base'), 'README'), 'README');
  // A folder brought in keeps both too; a new one refuses the taken name.
  await files.createEntry(id, 'Knowledge_Base', { kind: 'folder', name: '資料' });
  const folder = await files.createEntry(id, 'Knowledge_Base', {
    kind: 'folder',
    name: '資料',
    brought: true,
  });
  assert.equal(folder.path, 'Knowledge_Base/資料 2');
  await assert.rejects(
    files.createEntry(id, 'Knowledge_Base', { kind: 'folder', name: '資料' }),
    /同じ名前/,
  );
});

test('A file of any size comes in piece by piece, and one not written whole is removed', async (t) => {
  const { files, id, root } = await fixture(t);
  await mkdir(path.join(root, 'Knowledge_Base'));
  const whole = new Uint8Array(10).map((_, index) => index);
  const made = await files.createEntry(id, 'Knowledge_Base', {
    kind: 'file',
    name: 'deck.pptx',
    bytes: whole.slice(0, 4),
    size: whole.length,
  });
  assert.equal(made.name, 'deck.pptx');
  assert.ok(made.upload);
  // The name is held while the rest comes, so a second copy keeps both.
  const second = await files.createEntry(id, 'Knowledge_Base', {
    kind: 'file',
    name: 'deck.pptx',
    bytes: whole.slice(0, 4),
    size: whole.length,
  });
  assert.equal(second.name, 'deck 2.pptx');
  await appendUpload(made.upload, whole.slice(4, 8));
  await appendUpload(made.upload, whole.slice(8));
  assert.deepEqual(
    new Uint8Array(await readFile(path.join(root, 'Knowledge_Base', 'deck.pptx'))),
    whole,
  );
  // A completed file takes no more pieces.
  await assert.rejects(appendUpload(made.upload, whole.slice(0, 1)), /gone|見つかりません/);
  // A piece past the announced size, or a discarded copy, leaves nothing behind.
  await assert.rejects(appendUpload(second.upload!, whole), /size|大きさ/);
  const third = await files.createEntry(id, 'Knowledge_Base', {
    kind: 'file',
    name: 'deck.pptx',
    bytes: whole.slice(0, 4),
    size: whole.length,
  });
  await discardUpload(third.upload!);
  assert.deepEqual((await readdir(path.join(root, 'Knowledge_Base'))).sort(), ['deck.pptx']);
  // A file that fits its first piece is written at once.
  const small = await files.createEntry(id, 'Knowledge_Base', {
    kind: 'file',
    name: 'memo.txt',
    bytes: whole,
    size: whole.length,
  });
  assert.equal(small.upload, undefined);
});

test('Moving a knowledge folder carries the links, comments, drafts and note places that name it', async (t) => {
  const { files, id, write, read, exists } = await fixture(t);
  await write('Knowledge_Base/wiki/a.md', '# A\n\n[B](b.md) [top](../../index.md)\n');
  await write('Knowledge_Base/wiki/b.md', '# B\n');
  await write('Knowledge_Base/wiki/chart.png', 'png');
  await write(
    'index.md',
    '# Index\n\n- [A](Knowledge_Base/wiki/a.md)\n- ![chart](Knowledge_Base/wiki/chart.png)\n',
  );
  await write(
    '.irori/notes.json',
    JSON.stringify({ schemaVersion: 1, newNoteDirectory: 'Knowledge_Base/wiki' }),
  );
  await addNoteComment(files, git, id, 'Knowledge_Base/wiki/a.md', { body: 'Check this' });
  const draft = await files.read(id, 'Knowledge_Base/wiki/b.md');
  await files.draft({ ...draft, text: '# B\n\nunsaved\n' });
  await mkdir(path.join(files.get(id).root, 'Knowledge_Base/archive'));

  const from = 'Knowledge_Base/wiki';
  const to = 'Knowledge_Base/archive/wiki';
  const moved = await files.moveEntry(id, from, to);
  assert.deepEqual(moved.entry, {
    path: to,
    name: 'wiki',
    directory: true,
    layer: 'Knowledge_Base',
    note: false,
  });
  assert.deepEqual(moved.files.sort(), [
    'Knowledge_Base/wiki/a.md',
    'Knowledge_Base/wiki/b.md',
    'Knowledge_Base/wiki/chart.png',
  ]);
  const carried = await carryMove({ files }, id, { from, to }, moved.files);
  assert.deepEqual(carried.notices, []);
  assert.equal(await exists(from), false);
  assert.equal(
    await read('index.md'),
    '# Index\n\n- [A](Knowledge_Base/archive/wiki/a.md)\n- ![chart](Knowledge_Base/archive/wiki/chart.png)\n',
  );
  // A link inside the folder stays; one out of it now climbs one more level.
  assert.equal(await read(`${to}/a.md`), '# A\n\n[B](b.md) [top](../../../index.md)\n');
  assert.deepEqual(
    (await readNoteComments(files, id, `${to}/a.md`)).map((comment) => comment.body),
    ['Check this'],
  );
  assert.equal((await files.read(id, `${to}/b.md`)).draft?.text, '# B\n\nunsaved\n');
  assert.equal(JSON.parse(await read('.irori/notes.json')).newNoteDirectory, to);
});

test('Renaming a file of knowledge rewrites the links to it, and a change of case alone works', async (t) => {
  const { files, id, write, read, exists } = await fixture(t);
  await write('Knowledge_Base/data.csv', 'a,b\n');
  await write('Knowledge_Base/page.md', '[data](data.csv)\n');
  const moved = await files.moveEntry(id, 'Knowledge_Base/data.csv', 'Knowledge_Base/2026.csv');
  const carried = await carryMove(
    { files },
    id,
    { from: 'Knowledge_Base/data.csv', to: moved.entry.path },
    moved.files,
  );
  assert.equal(carried.links.links, 1);
  assert.equal(await read('Knowledge_Base/page.md'), '[data](2026.csv)\n');
  const recased = await files.moveEntry(id, 'Knowledge_Base/2026.csv', 'Knowledge_Base/2026.CSV');
  assert.equal(recased.entry.name, '2026.CSV');
  assert.deepEqual((await readdir(path.join(files.get(id).root, 'Knowledge_Base'))).sort(), [
    '2026.CSV',
    'page.md',
  ]);
  assert.equal(await exists('Knowledge_Base/2026.CSV'), true);
});

test('A move refuses a taken name, a folder into itself, the knowledge folder and a folder holding a vault', async (t) => {
  const { base, files, id, write } = await fixture(t);
  await write('Knowledge_Base/a/x.txt', 'x');
  await write('Knowledge_Base/b.txt', 'b');
  await assert.rejects(files.moveEntry(id, 'Knowledge_Base/b.txt', 'Knowledge_Base/A'), /同じ名前/);
  await assert.rejects(
    files.moveEntry(id, 'Knowledge_Base/a', 'Knowledge_Base/a/inner/a'),
    /自分自身/,
  );
  await assert.rejects(files.moveEntry(id, 'Knowledge_Base', 'Knowledge'), /vault の設定/);
  await assert.rejects(files.moveEntry(id, 'Knowledge_Base/b.txt', 'contents/b.txt'), /ナレッジ/);
  // A vault kept inside this one's knowledge goes nowhere with the folder around it.
  await write('Knowledge_Base/shelf/inner/readme.md', '# Inner\n');
  await files.register(path.join(base, 'KB/Knowledge_Base/shelf/inner'), 'Inner', 'personal');
  await assert.rejects(
    files.moveEntry(id, 'Knowledge_Base/shelf', 'Knowledge_Base/moved'),
    /別の vault/,
  );
});

test('Deleting from knowledge hands files and folders to the trash, never the knowledge folder', async (t) => {
  const { files, id, write, root, exists } = await fixture(t);
  await write('Knowledge_Base/old/x.txt', 'x');
  await write('Knowledge_Base/y.pdf', 'y');
  const y = await files.read(id, 'Knowledge_Base/y.pdf').catch(() => undefined);
  assert.equal(y?.viewer, 'pdf');
  const trashed: string[] = [];
  const trash = async (filename: string) => {
    trashed.push(filename);
    await rm(filename, { recursive: true });
  };
  await files.trashEntry(id, 'Knowledge_Base/old', trash);
  await files.trashEntry(id, 'Knowledge_Base/y.pdf', trash);
  assert.deepEqual(trashed, [
    path.join(await realpath(root), 'Knowledge_Base/old'),
    path.join(await realpath(root), 'Knowledge_Base/y.pdf'),
  ]);
  assert.equal(await exists('Knowledge_Base/old'), false);
  await assert.rejects(files.trashEntry(id, 'Knowledge_Base', trash), /vault の設定/);
  await assert.rejects(files.trashEntry(id, '.irori', trash));
});

test('An editable connected folder takes new folders and files; a read-only one refuses', async (t) => {
  const { cloud, space, target } = await connectedFixture(t, { writable: true });
  const folder = await cloud.createEntry(space.scopeId, connectionRoot, {
    kind: 'folder',
    name: '2026',
  });
  assert.equal(folder.path, `${connectionRoot}/2026`);
  assert.equal(folder.writable, true);
  await cloud.createEntry(space.scopeId, `${connectionRoot}/2026`, {
    kind: 'file',
    name: 'notes.txt',
  });
  const brought = await cloud.createEntry(space.scopeId, `${connectionRoot}/2026`, {
    kind: 'file',
    name: 'notes.txt',
    bytes: new TextEncoder().encode('kept'),
  });
  assert.equal(brought.name, 'notes 2.txt');
  assert.equal(await readFile(path.join(target, '2026', 'notes 2.txt'), 'utf8'), 'kept');
  await assert.rejects(
    cloud.createEntry(space.scopeId, `${connectionRoot}/2026`, { kind: 'file', name: 'notes.txt' }),
    /同じ名前/,
  );
  const readOnly = await connectedFixture(t);
  await assert.rejects(
    readOnly.cloud.createEntry(readOnly.space.scopeId, connectionRoot, {
      kind: 'folder',
      name: 'x',
    }),
    /読み取り専用/,
  );
});

test('The renderer reaches the explorer only through validated requests', () => {
  const id = '00000000-0000-4000-8000-000000000000';
  assert.equal(
    hostArguments.createEntry.safeParse([id, 'Knowledge_Base', { kind: 'folder', name: 'a' }])
      .success,
    true,
  );
  assert.equal(
    hostArguments.createEntry.safeParse([
      id,
      'Knowledge_Base',
      { kind: 'folder', name: 'a', bytes: new Uint8Array(1) },
    ]).success,
    false,
  );
  assert.equal(
    hostArguments.createEntry.safeParse([id, 'Knowledge_Base', { kind: 'link', name: 'a' }])
      .success,
    false,
  );
  // A file of any size crosses in pieces; no single piece is larger than the limit.
  assert.equal(
    hostArguments.createEntry.safeParse([
      id,
      '',
      { kind: 'file', name: 'big.bin', bytes: new Uint8Array(broughtChunkBytes + 1) },
    ]).success,
    false,
  );
  assert.equal(
    hostArguments.createEntry.safeParse([
      id,
      '',
      { kind: 'file', name: 'big.bin', bytes: new Uint8Array(1), size: 2 ** 40 },
    ]).success,
    true,
  );
  for (const size of [0, 1.5, -1])
    assert.equal(
      hostArguments.createEntry.safeParse([
        id,
        '',
        { kind: 'file', name: 'big.bin', bytes: new Uint8Array(1), size },
      ]).success,
      false,
    );
  assert.equal(
    hostArguments.createEntry.safeParse([id, '', { kind: 'file', name: 'big.bin', size: 2 }])
      .success,
    false,
  );
  assert.equal(
    hostArguments.appendEntry.safeParse([id, new Uint8Array(broughtChunkBytes)]).success,
    true,
  );
  assert.equal(
    hostArguments.appendEntry.safeParse([id, new Uint8Array(broughtChunkBytes + 1)]).success,
    false,
  );
  assert.equal(hostArguments.discardEntry.safeParse(['not an id']).success, false);
  assert.equal(hostArguments.moveEntry.safeParse([id, '', 'a']).success, false);
  assert.equal(hostArguments.trashEntry.safeParse([id, '']).success, false);
});
