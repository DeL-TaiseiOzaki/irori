import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, truncate, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { FileService, readDocument, readViewerBytes } from '../src/host/files';
import { opensInIrori, viewerByteLimit, viewerKind } from '../src/domain/viewers';

test('Viewer formats are named by extension and never overlap the editor', () => {
  assert.equal(viewerKind('a/Report.PDF'), 'pdf');
  assert.equal(viewerKind('memo.docx'), 'word');
  assert.equal(viewerKind('deck.pptx'), 'slides');
  for (const name of ['book.xlsx', 'macro.xlsm', 'old.xls', 'calc.ods'])
    assert.equal(viewerKind(name), 'sheet');
  for (const name of ['a.png', 'b.JPG', 'c.jpeg', 'd.gif', 'e.webp', 'f.svg'])
    assert.equal(viewerKind(name), 'image');
  // Formats without a viewer still go to the external application.
  for (const name of ['old.doc', 'old.ppt', 'movie.mp4', 'archive.zip', 'note.md'])
    assert.equal(viewerKind(name), undefined);
  assert.ok(opensInIrori('note.md') && opensInIrori('deck.pptx'));
  assert.ok(!opensInIrori('archive.zip'));
});

test('A viewer file opens as a view-only document whose version follows the file', async (t) => {
  const base = await mkdtemp(path.join(tmpdir(), 'irori-viewers-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const root = path.join(base, 'KB');
  await mkdir(path.join(root, 'materials'), { recursive: true });
  const space = await files.register(root, 'Viewers', 'personal');
  const pdf = path.resolve('tests/fixtures/viewers/sample.pdf');
  const target = path.join(root, 'materials', 'sample.pdf');
  await writeFile(target, await readFile(pdf));

  const doc = await files.read(space.scopeId, 'materials/sample.pdf');
  assert.equal(doc.viewer, 'pdf');
  assert.equal(doc.text, '');
  assert.match(doc.hash, /^[a-f0-9]{64}$/);
  assert.equal(doc.draft, undefined);
  assert.deepEqual(
    Buffer.from(await readViewerBytes(await files.resolve(space.scopeId, doc.path), doc.path)),
    await readFile(pdf),
  );

  // A changed file is a new version, so the open viewer reads it again.
  await writeFile(target, Buffer.concat([await readFile(pdf), Buffer.from('\n% appended\n')]));
  const later = new Date(Date.now() + 5000);
  await utimes(target, later, later);
  assert.notEqual((await files.read(space.scopeId, doc.path)).hash, doc.hash);

  // The limit holds for both the document and the bytes.
  await truncate(target, viewerByteLimit + 1);
  await assert.rejects(files.read(space.scopeId, doc.path), /100 MiB/);
  await assert.rejects(readViewerBytes(target, doc.path), /100 MiB/);

  // Only viewer formats hand out bytes; the editor's formats and others do not.
  await writeFile(path.join(root, 'secret.env'), 'TOKEN=1');
  await assert.rejects(
    readViewerBytes(path.join(root, 'secret.env'), 'secret.env'),
    /external application/,
  );
  await writeFile(path.join(root, 'note.md'), '# note\n');
  const note = await readDocument(path.join(root, 'note.md'), space.scopeId, 'note.md');
  assert.equal(note.text, '# note\n');
  assert.equal('viewer' in note, false);
  await assert.rejects(readViewerBytes(path.join(root, 'note.md'), 'note.md'), /external/);
});

test('Viewer bytes stay inside the KB', async (t) => {
  const base = await mkdtemp(path.join(tmpdir(), 'irori-viewers-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const root = path.join(base, 'KB');
  await mkdir(root);
  const space = await files.register(root, 'Viewers', 'personal');
  await writeFile(path.join(base, 'outside.pdf'), '%PDF-1.4');
  await assert.rejects(files.resolve(space.scopeId, '../outside.pdf'));
  await assert.rejects(files.read(space.scopeId, '../outside.pdf'));
});
