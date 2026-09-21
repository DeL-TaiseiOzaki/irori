import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  rename,
  stat,
  utimes,
} from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { FileService } from '../src/host/files';
import { SearchService } from '../src/host/search';
import { trigramQuery } from '../src/host/search-index';

async function fixture(t: TestContext) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori search index '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const root = path.join(base, 'Knowledge');
  await mkdir(root);
  const space = await files.register(root, '索引のKB', 'personal');
  const write = async (relative: string, text: string) => {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
  };
  // Every file the scan takes into the index passes through its `read`.
  let reads = 0;
  const scan = SearchService.prototype as unknown as {
    read: (...args: unknown[]) => Promise<string>;
  };
  const read = scan.read;
  scan.read = function (...args) {
    reads++;
    return read.apply(this, args);
  };
  t.after(() => {
    scan.read = read;
  });
  const listing = async () => (await readdir(root, { recursive: true })).sort();
  const indexFile = path.join(files.dataDir, 'search-index', `${space.scopeId}.sqlite`);
  return { files, space, write, reads: () => reads, listing, indexFile };
}

test('A repeat request reads no file; the index is on the device, never in the KB', async (t) => {
  const { files, space, write, reads, listing, indexFile } = await fixture(t);
  await write('a.md', 'needle one\n');
  await write('sub/b.txt', 'needle two\n');
  const before = await listing();
  const service = new SearchService(files);
  await service.search(space.scopeId, 'needle');
  assert.equal(reads(), 2);
  const result = await service.search(space.scopeId, 'needle');
  assert.equal(reads(), 2);
  assert.deepEqual(
    result.hits.map((hit) => [hit.path, hit.line, hit.preview]),
    [
      ['a.md', 1, 'needle one'],
      ['sub/b.txt', 1, 'needle two'],
    ],
  );
  assert.equal(result.scannedFiles, 2);
  assert.equal(result.incomplete, false);
  assert.deepEqual(await listing(), before);
  assert.ok((await stat(indexFile)).size > 0);
});

test('Files modified, added, removed or renamed since they were indexed are read afresh', async (t) => {
  const { files, space, write, reads, indexFile } = await fixture(t);
  await write('keep.md', 'needle stays\n');
  await write('edit.md', 'needle before\n');
  await write('gone.md', 'needle gone\n');
  await write('old-name.md', 'needle renamed\n');
  const service = new SearchService(files);
  assert.equal((await service.search(space.scopeId, 'needle')).hits.length, 4);
  await write('edit.md', 'changed after\n');
  await write('added.md', 'needle added\n');
  await rm(path.join(space.root, 'gone.md'));
  await rename(path.join(space.root, 'old-name.md'), path.join(space.root, 'new-name.md'));
  const result = await service.search(space.scopeId, 'needle');
  assert.deepEqual(result.hits.map((hit) => [hit.path, hit.preview]).sort(), [
    ['added.md', 'needle added'],
    ['keep.md', 'needle stays'],
    ['new-name.md', 'needle renamed'],
  ]);
  assert.equal(result.scannedFiles, 4);
  assert.equal(reads(), 7);
  // A complete walk drops the rows of files it did not meet.
  const rows = new DatabaseSync(indexFile);
  assert.equal((rows.prepare('SELECT count(*) AS n FROM notes').get() as { n: number }).n, 4);
  rows.close();
  // The same size with a later modification time is a change too.
  await write('edit.md', 'needle after!\n');
  const later = new Date(Date.now() + 5000);
  await utimes(path.join(space.root, 'edit.md'), later, later);
  const edited = await service.search(space.scopeId, 'needle');
  assert.ok(edited.hits.some((hit) => hit.path === 'edit.md' && hit.preview === 'needle after!'));
  assert.equal(reads(), 8);
});

test('Queries under three characters read the indexed text; longer ones are narrowed first', async (t) => {
  const { files, space, write } = await fixture(t);
  await write('a.md', '日本語の文章です。\nEnglish line\n');
  await write('b.md', 'ただの本\nsay "hi"\n');
  const service = new SearchService(files);
  const paths = async (query: string) =>
    (await service.search(space.scopeId, query)).hits.map((hit) => `${hit.path}:${hit.line}`);
  assert.deepEqual(await paths('本'), ['a.md:1', 'b.md:1']);
  assert.deepEqual(await paths('日本'), ['a.md:1']);
  assert.deepEqual(await paths('日本語'), ['a.md:1']);
  assert.deepEqual(await paths('の本'), ['b.md:1']);
  assert.deepEqual(await paths('の文'), ['a.md:1']);
  assert.deepEqual(await paths('"hi"'), ['b.md:2']);
  assert.deepEqual(await paths('lish li'), ['a.md:2']);
  assert.equal(trigramQuery('日本'), '');
  assert.equal(trigramQuery('日本語で'), '("日本語") AND ("本語で")');
  assert.equal(trigramQuery('a"b'), '("a""b")');
});

test('Matching ignores case as the line matcher does, beyond ASCII and Unicode 6.1', async (t) => {
  const { files, space, write } = await fixture(t);
  await write('upper.md', 'ÉCLAIR ΑΒΓΔ ПРИВЕТ ＯＲＢＩＴＡＬ\nᲐ Ბ Გ\n');
  await write('lower.md', 'éclair αβγδ привет ｏｒｂｉｔａｌ\nა ბ გ\n');
  const service = new SearchService(files);
  for (const query of ['éclair', 'ΑΒΓΔ', 'Привет', 'ｏｒｂｉｔａｌ', 'ა ბ გ', 'Ა Ბ Გ', 'É', 'ｂｉ'])
    assert.deepEqual(
      (await service.search(space.scopeId, query)).hits.map((hit) => hit.path).sort(),
      ['lower.md', 'upper.md'],
      query,
    );
  assert.deepEqual(
    (await service.search(space.scopeId, 'ORBITAL')).hits.map((hit) => hit.path),
    [],
  );
});

test('A file that is not a database, or from another schema version, is rebuilt', async (t) => {
  const { files, space, write, indexFile } = await fixture(t);
  await write('a.md', 'needle\n');
  const service = new SearchService(files);
  await service.search(space.scopeId, 'needle');
  await writeFile(indexFile, 'not a database at all');
  assert.equal((await service.search(space.scopeId, 'needle')).hits.length, 1);
  assert.equal((await readFile(indexFile)).subarray(0, 15).toString(), 'SQLite format 3');
  const other = new DatabaseSync(indexFile);
  other.exec('PRAGMA user_version = 99');
  other.close();
  assert.equal((await service.search(space.scopeId, 'needle')).hits.length, 1);
  const rebuilt = new DatabaseSync(indexFile);
  assert.equal(
    (rebuilt.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
    1,
  );
  rebuilt.close();
  // Damage in a page only a query reads — the trigram index's own b-tree —
  // fails the request that meets it; the next one starts from a fresh database.
  const layout = new DatabaseSync(indexFile);
  const { rootpage } = layout
    .prepare("SELECT rootpage FROM sqlite_master WHERE name = 'notes_idx'")
    .get() as { rootpage: number };
  layout.close();
  const bytes = await readFile(indexFile);
  await writeFile(indexFile, bytes.fill(0xff, (rootpage - 1) * 4096, rootpage * 4096));
  await assert.rejects(service.search(space.scopeId, 'needle'), /malformed/);
  assert.equal((await service.search(space.scopeId, 'needle')).hits.length, 1);
});

test('Backlinks are answered from the indexed text and follow edits to it', async (t) => {
  const { files, space, write, reads } = await fixture(t);
  await write('target.md', '# 対象\n');
  await write('a.md', '[対象](target.md)\n');
  await write('b.md', 'no link yet\n');
  await write('notes.txt', '[対象](target.md)\n');
  const service = new SearchService(files);
  const linking = async () =>
    (await service.backlinks(space.scopeId, 'target.md')).hits.map((hit) => hit.path);
  assert.deepEqual(await linking(), ['a.md']);
  assert.equal(reads(), 3);
  assert.deepEqual(await linking(), ['a.md']);
  assert.equal(reads(), 3);
  await write('a.md', 'link removed\n');
  await write('b.md', 'now [対象](./target.md#見出し)\n');
  assert.deepEqual(await linking(), ['b.md']);
  assert.equal(reads(), 5);
  // Text search shares the rows: only the note it has not met is read.
  assert.deepEqual(
    (await service.search(space.scopeId, 'target')).hits.map((hit) => hit.path),
    ['b.md', 'notes.txt'],
  );
  assert.equal(reads(), 6);
});
