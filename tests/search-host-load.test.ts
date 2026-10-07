import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { FileService } from '../src/host/files';
import { SearchService } from '../src/host/search';
import { SearchIndex } from '../src/host/search-index';

function gate() {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release };
}

async function fixture(t: TestContext) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori-host-search-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const root = path.join(base, 'KB');
  await mkdir(root);
  const space = await files.register(root, 'Fixture', 'personal');
  const write = async (file: string, text: string) => {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), text);
  };
  return { files, space, write };
}

test('Backlink candidates cover every accepted destination form and unchanged results avoid text reads', async (t) => {
  const { files, space, write } = await fixture(t);
  const target = 'É Note(1).md';
  await write(target, '# Target');
  const cases = [
    ['a.md', '[inline](<./É Note(1).md#anchor>)'],
    ['sub/b.md', '![image](../%C3%89%20Note%281%29.md)'],
    ['c.md', '[id]: <É Note(1).md>'],
    ['d.md', '[escaped](%C3%89%20Note\\(1\\).md)'],
    ['e.md', '[case](<é note(1).MD>)'],
    ['f.md', '[unicode](<E\u0301 Note(1).md>)'],
    ['g.md', '[balanced](É%20Note(1).md)'],
  ];
  for (const [file, text] of cases) await write(file, text);
  await write('fenced.md', '```md\n[code](<É Note(1).md>)\n```\n`[code](<É Note(1).md>)`');
  await write('wiki.md', '[[É Note(1).md]]');
  for (let i = 0; i < 50; i++) await write(`prose-${i}.md`, 'Only prose, no link destination.');
  // Observe a case-insensitive volume without relying on the test machine's filesystem.
  const resolve = files.resolve.bind(files);
  files.resolve = (id, relative, allowRoot) =>
    resolve(id, relative === target.toUpperCase() ? target : relative, allowRoot);
  let textReads = 0;
  const text = SearchIndex.prototype.text;
  SearchIndex.prototype.text = function (id) {
    textReads++;
    return text.call(this, id);
  };
  t.after(() => {
    SearchIndex.prototype.text = text;
  });
  const service = new SearchService(files);
  const first = await service.backlinks(space.scopeId, target);
  assert.equal(first.incomplete, false);
  assert.deepEqual(first.hits.map((hit) => hit.path).sort(), cases.map(([file]) => file).sort());
  assert.equal(first.scannedFiles, 60);
  assert.equal(textReads, 8);
  assert.deepEqual(await service.backlinks(space.scopeId, target), first);
  assert.equal(textReads, 8);
  await write('a.md', 'The link was removed.');
  assert.deepEqual(
    (await service.backlinks(space.scopeId, target)).hits.map((hit) => hit.path).sort(),
    cases
      .slice(1)
      .map(([file]) => file)
      .sort(),
  );
  assert.equal(textReads, 15);
});

test('Identical in-flight backlinks share one layer walk', async (t) => {
  const { files, space, write } = await fixture(t);
  await write('target.md', '# Target');
  await write('note.md', '[link](target.md)');
  const entries = files.entries.bind(files);
  const started = gate(),
    resume = gate();
  t.after(resume.release);
  let walks = 0;
  files.entries = async (id, directory) => {
    if (!directory) {
      walks++;
      started.release();
      await resume.wait;
    }
    return entries(id, directory);
  };
  const service = new SearchService(files);
  const first = service.backlinks(space.scopeId, 'target.md');
  await started.wait;
  const rest = Array.from({ length: 20 }, () => service.backlinks(space.scopeId, 'target.md'));
  resume.release();
  const results = await Promise.all([first, ...rest]);
  assert.equal(walks, 1);
  assert.ok(results.every((result) => result.hits.length === 1));
});

test('Backlinks and references do not cancel a user search or collide in a cold index', async (t) => {
  const { files, space, write } = await fixture(t);
  await write('target.md', '# Target');
  await write('note.md', 'needle [link](target.md)');
  const entries = files.entries.bind(files);
  const started = gate(),
    resume = gate();
  t.after(resume.release);
  let paused = false;
  files.entries = async (id, directory) => {
    if (!paused) {
      paused = true;
      started.release();
      await resume.wait;
    }
    return entries(id, directory);
  };
  const service = new SearchService(files);
  const search = service.search(space.scopeId, 'needle');
  await started.wait;
  const [backlinks, references] = await Promise.all([
    service.backlinks(space.scopeId, 'target.md'),
    service.references(space.scopeId, 'target.md'),
  ]);
  assert.equal(backlinks.hits.length, 1);
  assert.equal(references.hits.length, 1);
  resume.release();
  assert.equal((await search).hits.length, 1);
  const db = new DatabaseSync(path.join(files.dataDir, 'search-index', `${space.scopeId}.sqlite`));
  assert.equal((db.prepare('SELECT count(*) AS n FROM notes').get() as { n: number }).n, 2);
  db.close();
});

test('Superseding a scan preserves the validated file it just read and its buffered rows', async (t) => {
  const { files, space, write } = await fixture(t);
  await write('a.md', 'old phrase');
  await write('b.md', 'new phrase');
  const service = new SearchService(files);
  const reader = service as unknown as { read: (...args: any[]) => Promise<string> };
  const read = reader.read.bind(service);
  const started = gate(),
    resume = gate();
  t.after(resume.release);
  let reads = 0;
  reader.read = async (...args) => {
    const text = await read(...args);
    if (++reads === 1) {
      started.release();
      await resume.wait;
    }
    return text;
  };
  const old = service.search(space.scopeId, 'old');
  const rejected = assert.rejects(old, /新しい検索|newer search/);
  await started.wait;
  const entries = files.entries.bind(files);
  const nextStarted = gate(),
    nextResume = gate();
  t.after(nextResume.release);
  files.entries = async (id, directory) => {
    nextStarted.release();
    await nextResume.wait;
    return entries(id, directory);
  };
  const newer = service.search(space.scopeId, 'new');
  await nextStarted.wait;
  resume.release();
  await rejected;
  const db = new DatabaseSync(path.join(files.dataDir, 'search-index', `${space.scopeId}.sqlite`));
  assert.deepEqual(
    db
      .prepare('SELECT path FROM notes')
      .all()
      .map((row) => row.path),
    ['a.md'],
  );
  db.close();
  nextResume.release();
  assert.equal((await newer).hits.length, 1);
  // The successor listed before the old read finished, so it may reread a.md.
  // A later request must still reuse both rows, including that cancelled read.
  const before = reads;
  assert.equal((await service.search(space.scopeId, 'old')).hits.length, 1);
  assert.equal(reads, before);
});

test("Recreating a missing candidate table preserves the current cache's checked texts", async (t) => {
  const { files, space, write } = await fixture(t);
  await write('note.md', '[link](target.md)');
  const service = new SearchService(files);
  await service.search(space.scopeId, 'link');
  const filename = path.join(files.dataDir, 'search-index', `${space.scopeId}.sqlite`);
  const db = new DatabaseSync(filename);
  db.exec('DROP TABLE link_candidates');
  db.close();
  let reads = 0;
  const reader = service as unknown as { read: (...args: any[]) => Promise<string> };
  const read = reader.read.bind(service);
  reader.read = async (...args) => {
    reads++;
    return read(...args);
  };
  assert.equal((await service.backlinks(space.scopeId, 'target.md')).hits.length, 1);
  assert.equal(reads, 0);
});

test('Returning from an older index writer rebuilds rows without backlink candidates', async (t) => {
  const { files, space, write } = await fixture(t);
  await write('target.md', '# Target');
  await write('existing.md', '[link](target.md)');
  const service = new SearchService(files);
  assert.equal((await service.backlinks(space.scopeId, 'target.md')).hits.length, 1);
  await write('older-writer.md', '[another link](target.md)');
  const metadata = await stat(path.join(space.root, 'older-writer.md'));
  const filename = path.join(files.dataDir, 'search-index', `${space.scopeId}.sqlite`);
  const db = new DatabaseSync(filename);
  // An older writer can keep the table yet insert a fully validated notes row
  // without updating it. Merely checking that the table exists misses this row.
  db.exec('PRAGMA user_version = 1');
  const { rowid } = db
    .prepare('INSERT INTO notes(path, size, mtime, text) VALUES (?, ?, ?, ?) RETURNING rowid')
    .get('older-writer.md', metadata.size, metadata.mtimeMs, '[another link](target.md)') as {
    rowid: number;
  };
  assert.equal(db.prepare('SELECT id FROM link_candidates WHERE id = ?').get(rowid), undefined);
  db.close();
  assert.deepEqual(
    (await service.backlinks(space.scopeId, 'target.md')).hits.map((hit) => hit.path).sort(),
    ['existing.md', 'older-writer.md'],
  );
  const rebuilt = new DatabaseSync(filename);
  assert.equal(
    (rebuilt.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
    2,
  );
  rebuilt.close();
});

test('A parallel refresh retains the rows an earlier user search already checked', async (t) => {
  const { files, space, write } = await fixture(t);
  await write('a.md', 'needle old [link](target.md)');
  await write('target.md', '# Target');
  await mkdir(path.join(space.root, 'later'));
  const service = new SearchService(files);
  await service.search(space.scopeId, 'needle');
  const entries = files.entries.bind(files);
  const started = gate(),
    resume = gate();
  t.after(resume.release);
  let paused = false;
  files.entries = async (id, directory) => {
    if (directory === 'later' && !paused) {
      paused = true;
      started.release();
      await resume.wait;
    }
    return entries(id, directory);
  };
  const searching = service.search(space.scopeId, 'needle');
  await started.wait;
  await write('a.md', 'needle fresh without a link');
  assert.deepEqual((await service.backlinks(space.scopeId, 'target.md')).hits, []);
  resume.release();
  assert.deepEqual(
    (await searching).hits.map((hit) => hit.preview),
    ['needle old [link](target.md)'],
  );
  assert.deepEqual(
    (await service.search(space.scopeId, 'fresh')).hits.map((hit) => hit.path),
    ['a.md'],
  );
  const db = new DatabaseSync(path.join(files.dataDir, 'search-index', `${space.scopeId}.sqlite`));
  assert.equal((db.prepare('SELECT count(*) AS n FROM notes').get() as { n: number }).n, 2);
  db.close();
});

test('A delayed checked read cannot replace a newer parallel observation in the cache', async (t) => {
  const { files, space, write } = await fixture(t);
  await write('a.md', 'needle old');
  await write('target.md', '# Target');
  const service = new SearchService(files);
  const reader = service as unknown as { read: (...args: any[]) => Promise<string> };
  const read = reader.read.bind(service);
  const started = gate(),
    resume = gate();
  t.after(resume.release);
  let paused = false;
  reader.read = async (...args) => {
    const text = await read(...args);
    if (args[2] === 'a.md' && !paused) {
      paused = true;
      started.release();
      await resume.wait;
    }
    return text;
  };
  const searching = service.search(space.scopeId, 'needle');
  await started.wait;
  await write('a.md', 'needle fresh [link](target.md)');
  assert.equal((await service.backlinks(space.scopeId, 'target.md')).hits.length, 1);
  resume.release();
  assert.deepEqual(
    (await searching).hits.map((hit) => hit.preview),
    ['needle old'],
  );
  const db = new DatabaseSync(path.join(files.dataDir, 'search-index', `${space.scopeId}.sqlite`));
  assert.deepEqual(
    db
      .prepare("SELECT text FROM notes WHERE path = 'a.md'")
      .all()
      .map((row) => row.text),
    ['needle fresh [link](target.md)'],
  );
  db.close();
  assert.equal((await service.backlinks(space.scopeId, 'target.md')).hits.length, 1);
});

test('A damaged shared cache waits for overlapping readers to finish before rebuilding', async (t) => {
  const { files, space, write } = await fixture(t);
  await write('note.md', 'needle [link](target.md)');
  const service = new SearchService(files);
  await service.search(space.scopeId, 'needle');
  const entries = files.entries.bind(files);
  const started = gate(),
    resume = gate();
  t.after(resume.release);
  let paused = false;
  files.entries = async (id, directory) => {
    if (!paused) {
      paused = true;
      started.release();
      await resume.wait;
    }
    return entries(id, directory);
  };
  const searching = service.search(space.scopeId, 'needle');
  const rejected = assert.rejects(searching, /cache must be rebuilt/);
  await started.wait;
  const filename = path.join(files.dataDir, 'search-index', `${space.scopeId}.sqlite`);
  const db = new DatabaseSync(filename);
  db.exec('DROP TABLE link_candidates');
  db.close();
  await assert.rejects(service.backlinks(space.scopeId, 'target.md'), /no such table/);
  resume.release();
  await rejected;
  assert.equal((await service.search(space.scopeId, 'needle')).hits.length, 1);
});

test('Retired rows are reclaimed when their readers finish while other scans remain active', async (t) => {
  const { files, space } = await fixture(t);
  const first = await SearchIndex.open(files.dataDir, space.scopeId);
  const second = await SearchIndex.open(files.dataDir, space.scopeId);
  const third = await SearchIndex.open(files.dataDir, space.scopeId);
  t.after(() => {
    first.close();
    second.close();
    third.close();
  });
  const old = first.put('note.md', 3, 1, 'old');
  first.retain(old);
  second.retain(old);
  const newer = second.put('note.md', 3, 2, 'new', old);
  second.retain(newer);
  third.retain(newer);
  first.flush();
  first.release(new Set([old]));
  first.flush();
  first.close();
  assert.equal(third.text(old), 'old');
  second.release(new Set([old, newer]));
  second.flush();
  second.close();
  assert.equal(third.text(old), null);
  assert.equal(third.text(newer), 'new');
  assert.equal(third.files().size, 1);
  third.release(new Set([newer]));
  third.close();
});
