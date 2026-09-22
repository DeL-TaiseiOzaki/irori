import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { FileService, textFileByteLimit } from '../src/host/files';
import { SearchService, searchLimits } from '../src/host/search';
import { referringLinks, relink } from '../src/host/relink';
import { linkCount, rewriteLinks } from '../src/domain/note-links';
import { imagesForNoteMove } from '../src/domain/note-operations';
import { dispatchHost, type HostHandlers } from '../src/domain/host-requests';
import type { Document } from '../src/domain/types';
import { GraphIndexService } from '../src/host/graph-index';
import { AuthorshipStore } from '../src/knowledge/authorship';
import { rewriteNoteReferences } from '../src/host/note-references';

const moved = (map: Record<string, string>) => (p: string) => map[p];

test('A reference rewrite that would exceed the reader limit skips the note without changing it', async (t) => {
  const { files, search, id, write, read } = await fixture(t);
  const prefix = '---\nrelations: [{ rel: uses, target: b.md }]\n---\n';
  const original = prefix + 'x'.repeat(textFileByteLimit - prefix.length - 10);
  await write('a.md', original);
  await write('b.md', 'B\n');
  const destination = 'b'.repeat(80) + '.md';
  const next = await files.moveNote(await files.read(id, 'b.md'), destination, true);
  const result = await relink(files, search, next, 'b.md');
  assert.deepEqual(result.links, {
    self: 0,
    notes: 0,
    links: 0,
    skipped: ['a.md'],
    incomplete: false,
  });
  assert((await read('a.md')) === original, 'A skipped rewrite keeps the original bytes');
  assert((await files.read(id, 'a.md')).text === original, 'The original note remains readable');
  assert.equal((await files.read(id, 'a.md')).draft, undefined);
});

test('Renaming keeps OKF relations and source references without rewriting other frontmatter', async (t) => {
  const { files, search, id, write, read } = await fixture(t);
  const original =
    '\ufeff---\r\ntype: concept\r\ntitle: A\r\nrelations:\r\n  - { rel: uses, target: "b.md" } # keep\r\nsources:\r\n  - resource: \'b.md\'\r\n  - resource: Knowledge_Base/wiki/b.md\r\ndescription: "[example](b.md)"\r\n---\r\n\r\n[b](b.md)\r\n';
  await write('Knowledge_Base/wiki/a.md', original);
  await write('Knowledge_Base/wiki/b.md', '---\ntype: concept\ntitle: B\n---\n');
  const graph = new GraphIndexService(files, search);
  await graph.update(id);
  assert.deepEqual(await referringLinks(files, search, id, 'Knowledge_Base/wiki/b.md'), {
    notes: 1,
    links: 4,
    incomplete: false,
  });
  const next = await files.moveNote(
    await files.read(id, 'Knowledge_Base/wiki/b.md'),
    'Knowledge_Base/wiki/c.md',
    true,
  );
  const result = await relink(files, search, next, 'Knowledge_Base/wiki/b.md');
  assert.equal(result.links.links, 4);
  assert.equal(
    await read('Knowledge_Base/wiki/a.md'),
    original
      .replace('target: "b.md"', 'target: "c.md"')
      .replace("resource: 'b.md'", "resource: 'c.md'")
      .replace('resource: Knowledge_Base/wiki/b.md', 'resource: Knowledge_Base/wiki/c.md')
      .replace('[b](b.md)', '[b](c.md)'),
  );
  const status = await graph.update(id);
  assert.equal(status.entities.rows, 2);
  assert.equal(status.relations.rows, 1);
  assert.equal(status.excluded, 0);
});

test('Moving a page rebases its own OKF references and refuses an unrepaired folder move', async (t) => {
  const { root, files, search, id, write, read } = await fixture(t);
  const original =
    '---\nrelations: [{ rel: uses, target: sibling.md }]\nsources: [{ resource: ../source.md }, { resource: contents/drive/source.pdf }]\n---\nBody\n';
  await write('Knowledge_Base/wiki/a.md', original);
  await mkdir(path.join(root, 'Knowledge_Base/archive'));
  const before = await files.read(id, 'Knowledge_Base/wiki/a.md');
  await assert.rejects(
    files.moveNote(before, 'Knowledge_Base/archive/a.md', false),
    /リンクも更新する/,
  );
  const next = await files.moveNote(before, 'Knowledge_Base/archive/a.md', true);
  const result = await relink(files, search, next, before.path);
  assert.equal(result.links.self, 1);
  assert.equal(
    await read(next.path),
    original.replace('target: sibling.md', 'target: ../wiki/sibling.md'),
  );
});

test('Rewriting metadata retains the person marks on changed reference lines', async (t) => {
  const { files, search, id, write, read } = await fixture(t);
  const authorship = new AuthorshipStore(files.dataDir);
  const original = '---\nrelations: [{ rel: uses, target: b.md }]\n---\nAgent prose\n';
  await write('a.md', original);
  await write('b.md', 'B\n');
  const ref = { scopeId: id, path: 'a.md' };
  await authorship.observe(ref, original, '---\n---\nAgent prose\n');
  const next = await files.moveNote(await files.read(id, 'b.md'), 'c.md', true);
  await relink(files, search, next, 'b.md', (before, after) =>
    authorship.carry(before, after, before.text, after.text),
  );
  const updated = await read('a.md');
  assert.ok(updated.includes('target: c.md'));
  assert.deepEqual((await authorship.view(ref, updated)).lines, [false, true, false, false, false]);
});

test('Metadata rewrites quote new punctuation and keep URLs, fragments and unknown fields', () => {
  const original =
    '---\nrelations: [{ rel: uses, target: "b.md#heading" }, { rel: uses, target: "https://example.com/b.md" }]\nsources: [{ resource: b.md }]\ncustom: b.md\n---\nBody\n';
  const result = rewriteNoteReferences(
    original,
    'a.md',
    'a.md',
    moved({ 'b.md': 'notes/new,#1%.md' }),
  );
  assert.equal(result.links, 2);
  assert.equal(
    result.text,
    original
      .replace('"b.md#heading"', '"notes/new,%231%25.md#heading"')
      .replace('resource: b.md', 'resource: "notes/new,%231%25.md"'),
  );
  assert.deepEqual(rewriteNoteReferences(original, 'a.md', 'a.md', moved({})), {
    text: original,
    links: 0,
  });
});

test('Invalid and aliased metadata stays unchanged and makes the move scan incomplete', async (t) => {
  const { files, search, id, write, read } = await fixture(t);
  const invalid = '---\nrelations: [\n---\n[b](b.md)\n';
  const alias = '---\ntarget: &ref b.md\nrelations: [{rel: uses, target: *ref}]\n---\n';
  await write('invalid.md', invalid);
  await write('alias.md', alias);
  await write('good.md', '---\nrelations: [{rel: uses, target: b.md}]\n---\n');
  await write('b.md', 'B\n');
  assert.deepEqual(await referringLinks(files, search, id, 'b.md'), {
    notes: 1,
    links: 1,
    incomplete: true,
  });
  const next = await files.moveNote(await files.read(id, 'b.md'), 'c.md', true);
  const result = await relink(files, search, next, 'b.md');
  assert.equal(result.links.incomplete, true);
  assert.equal(result.links.links, 1);
  assert.equal(await read('invalid.md'), invalid);
  assert.equal(await read('alias.md'), alias);
});

test('A link to the moved note is rewritten in the form its author used', () => {
  // wiki/target.md moves to archive/deep/target.md; the link is in wiki/index.md.
  const relocated = moved({ 'wiki/target.md': 'archive/deep/target.md' });
  for (const [written, expected] of [
    ['target.md', '../archive/deep/target.md'],
    ['./target.md', '../archive/deep/target.md'],
    ['../wiki/target.md#見出し', '../archive/deep/target.md#見出し'],
    ['<target.md>', '<../archive/deep/target.md>'],
    ['target.md "title"', '../archive/deep/target.md "title"'],
    ['<target.md> "title"', '<../archive/deep/target.md> "title"'],
    ['target%2Emd', '../archive/deep/target.md'],
  ]) {
    const text = `- [対象](${written}) と [別](other.md)\n`;
    const result = rewriteLinks(text, 'wiki/index.md', 'wiki/index.md', relocated);
    assert.equal(result.text, `- [対象](${expected}) と [別](other.md)\n`, written);
    assert.equal(result.links, 1, written);
  }
});

test('A destination that cannot be written bare is encoded or bracketed, and still resolves', () => {
  const from = 'wiki/index.md';
  const meeting = 'wiki/会議 メモ (1).md';
  const cases: [string, string, string, string][] = [
    ['<会議 メモ (1).md>', meeting, 'wiki/2026/会議 メモ (1).md', '<2026/会議 メモ (1).md>'],
    [
      '%E4%BC%9A%E8%AD%B0%20%E3%83%A1%E3%83%A2%20(1).md',
      meeting,
      'wiki/2026/会議 メモ (1).md',
      '2026/%E4%BC%9A%E8%AD%B0%20%E3%83%A1%E3%83%A2%20(1).md',
    ],
    [
      '会議%20メモ%20\\(1\\).md',
      meeting,
      'wiki/2026/会議 メモ (1).md',
      '2026/%E4%BC%9A%E8%AD%B0%20%E3%83%A1%E3%83%A2%20(1).md',
    ],
    ['target.md', 'wiki/target.md', 'my notes/target.md', '<../my notes/target.md>'],
    ['target.md', 'wiki/target.md', 'wiki/notes(2026)/target.md', 'notes\\(2026\\)/target.md'],
    ['target.md#top', 'wiki/target.md', 'wiki/#1 100%.md', '<%231 100%25.md#top>'],
    ['target.md', 'wiki/target.md', 'wiki/note:1.md', './note:1.md'],
  ];
  for (const [written, previous, next, expected] of cases) {
    const result = rewriteLinks(`[x](${written})\n`, from, from, moved({ [previous]: next }));
    assert.equal(result.text, `[x](${expected})\n`, written);
    assert.equal(linkCount(result.text, from, next), 1, expected);
  }
});

test('Code is not a link, and every other byte survives the rewrite', () => {
  const lines = (destinations: string[]) =>
    [
      '﻿---',
      'title: 目次',
      '---',
      `[a](${destinations[0]}) \`[b](target.md)\` [c](${destinations[1]})`,
      '```md',
      '[d](target.md)',
      '```',
      `[ref]: ${destinations[2]} "ref title"`,
      `[angled]: <${destinations[3]}>`,
      `  [indented]: ${destinations[4]}`,
    ].join('\r\n') + '\r\n';
  const before = lines(['target.md', './target.md', 'target.md', 'target.md', './target.md']);
  const result = rewriteLinks(
    before,
    'index.md',
    'index.md',
    moved({ 'target.md': 'archive/target.md' }),
  );
  assert.equal(result.links, 5);
  assert.equal(result.text, lines(Array(5).fill('archive/target.md')));
  // Nothing to relocate leaves the text as it is, `./` and all.
  assert.deepEqual(rewriteLinks(before, 'index.md', 'index.md', moved({})), {
    text: before,
    links: 0,
  });
});

test("The moved note's own links keep their targets, including links to itself", () => {
  const image = `_assets/image-${'a'.repeat(64)}.png`;
  const text = `[自分](note.md) [自分#](../wiki/note.md#top) [兄弟](sibling.md) [親](../index.md) ![画像](${image}) [外](https://example.com/) [予定](planned.md)\n`;
  const across = rewriteLinks(text, 'wiki/note.md', 'archive/deep/note.md', (p) =>
    p === 'wiki/note.md'
      ? 'archive/deep/note.md'
      : p === `wiki/${image}`
        ? `archive/deep/${image}`
        : p,
  );
  assert.equal(
    across.text,
    `[自分](note.md) [自分#](note.md#top) [兄弟](../../wiki/sibling.md) [親](../../index.md) ![画像](${image}) [外](https://example.com/) [予定](../../wiki/planned.md)\n`,
  );
  assert.equal(across.links, 4);
  const renamed = rewriteLinks(text, 'wiki/note.md', 'wiki/renamed.md', (p) =>
    p === 'wiki/note.md' ? 'wiki/renamed.md' : p,
  );
  assert.equal(
    renamed.text,
    `[自分](renamed.md) [自分#](renamed.md#top) [兄弟](sibling.md) [親](../index.md) ![画像](${image}) [外](https://example.com/) [予定](planned.md)\n`,
  );
  assert.equal(renamed.links, 2);
});

test('Paths compare in NFC, as a Mac may store a name decomposed', () => {
  const decomposed = 'ガイド.md'.normalize('NFD');
  const result = rewriteLinks(
    `[手引き](${decomposed})\n`,
    'index.md',
    'index.md',
    moved({ 'ガイド.md': 'docs/ガイド.md' }),
  );
  assert.equal(result.text, '[手引き](docs/ガイド.md)\n');
  assert.equal(linkCount(`[手引き](${decomposed})\n`, 'index.md', 'ガイド.md'), 1);
});

test('A crafted note is rewritten in linear time, since the work blocks the main process', () => {
  const runs = Array.from({ length: 2000 }, (_, i) => '`'.repeat(2000 - i)).join(' x ');
  const text = `${'`'.repeat(100_000)}a\`\n${runs} [b](b.md)\n${'[x]('.repeat(20_000)}\n`;
  const start = performance.now();
  const result = rewriteLinks(text, 'a.md', 'a.md', moved({ 'b.md': 'c.md' }));
  assert.equal(result.links, 1);
  assert.equal(linkCount(text, 'a.md', 'b.md'), 1);
  assert.ok(performance.now() - start < 1000);
});

async function fixture(t: TestContext) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori move links '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const root = path.join(base, 'Knowledge');
  await mkdir(root);
  const space = await files.register(root, 'リンクのKB', 'personal');
  const write = async (relative: string, text: string) => {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
  };
  const read = (relative: string) => readFile(path.join(root, relative), 'utf8');
  return { base, root, files, search: new SearchService(files), id: space.scopeId, write, read };
}

test('Moving a note rewrites the links that led to it and its own, and nothing outside the layer', async (t) => {
  const { base, root, files, search, id, write, read } = await fixture(t);
  const target = '# 対象\n\n[自分](target.md) [兄弟](sibling.md) [親](../index.md)\n';
  const index = '# 目次\n\n- [対象](wiki/target.md)\n- [見出し](<wiki/target.md#見出し>)\n';
  const journal = '今日は [対象](../../wiki/target.md) を読んだ。\r\n';
  await write('wiki/target.md', target);
  await write('wiki/sibling.md', '# 兄弟\n');
  await write('index.md', index);
  await write('journal/2026/09-21.md', journal);
  await write('wiki/unrelated.md', '[別](other.md)\n');
  const outside = [
    'notes.txt',
    'AGENTS.md',
    'schema/rules.md',
    '.hidden/note.md',
    'node_modules/pkg/readme.md',
    'contents/report.md',
    'wiki/nested/inner.md',
  ];
  for (const relative of outside)
    await write(
      relative,
      `[対象](${path.posix.relative(path.posix.dirname(relative), 'wiki/target.md')})\n`,
    );
  await files.register(path.join(root, 'wiki/nested'), '入れ子のKB', 'personal');
  const escaped = path.join(base, 'outside.md');
  await writeFile(escaped, '[対象](target.md)\n');
  await symlink(escaped, path.join(root, 'wiki/escape.md'));
  await mkdir(path.join(root, 'archive/deep'), { recursive: true });
  const untouched = ['wiki/unrelated.md', 'wiki/sibling.md', ...outside];
  const before = Object.fromEntries(
    await Promise.all(untouched.map(async (relative) => [relative, await read(relative)])),
  );

  assert.deepEqual(await referringLinks(files, search, id, 'wiki/target.md'), {
    notes: 2,
    links: 3,
    incomplete: false,
  });
  const ref = await files.read(id, 'wiki/target.md');
  const moved = await files.moveNote(ref, 'archive/deep/target.md', true);
  assert.equal(moved.text, target);
  const result = await relink(files, search, moved, 'wiki/target.md');
  assert.deepEqual(result.links, { self: 2, notes: 2, links: 3, skipped: [], incomplete: false });
  assert.equal(result.doc.path, 'archive/deep/target.md');
  assert.equal(
    result.doc.text,
    '# 対象\n\n[自分](target.md) [兄弟](../../wiki/sibling.md) [親](../../index.md)\n',
  );
  assert.equal((await files.read(id, 'archive/deep/target.md')).hash, result.doc.hash);
  assert.equal(
    await read('index.md'),
    '# 目次\n\n- [対象](archive/deep/target.md)\n- [見出し](<archive/deep/target.md#見出し>)\n',
  );
  assert.equal(
    await read('journal/2026/09-21.md'),
    '今日は [対象](../../archive/deep/target.md) を読んだ。\r\n',
  );
  for (const [relative, text] of Object.entries(before))
    assert.equal(await read(relative), text, relative);
  assert.equal(await readFile(escaped, 'utf8'), '[対象](target.md)\n');
  assert.deepEqual(
    [
      ...new Set(
        (await search.backlinks(id, 'archive/deep/target.md')).hits.map((hit) => hit.path),
      ),
    ].sort(),
    ['index.md', 'journal/2026/09-21.md'],
  );

  // Moving back restores every link by the same mechanism.
  const back = await files.moveNote(result.doc, 'wiki/target.md', true);
  const restored = await relink(files, search, back, 'archive/deep/target.md');
  assert.deepEqual(restored.links, { self: 2, notes: 2, links: 3, skipped: [], incomplete: false });
  assert.equal(restored.doc.text, target);
  assert.equal(await read('index.md'), index);
  assert.equal(await read('journal/2026/09-21.md'), journal);
});

test('A linking note changed meanwhile, or holding unsaved text, is skipped and reported', async (t) => {
  const { root, files, search, id, write, read } = await fixture(t);
  await write('target.md', '# 対象\n');
  await write('racing.md', '[対象](target.md)\n');
  await write('drafted.md', '[対象](target.md)\n');
  await write('plain.md', '[対象](target.md)\n');
  await files.draft({
    ...(await files.read(id, 'drafted.md')),
    text: '[対象](target.md) 未保存\n',
  });
  const original = files.read.bind(files);
  t.mock.method(files, 'read', async (scopeId: string, rel: string) => {
    const doc = await original(scopeId, rel);
    // An external editor writes between the read and the hash-checked save.
    if (rel === 'racing.md')
      await writeFile(path.join(root, rel), '[対象](target.md) 外部で編集\n');
    return doc;
  });
  await mkdir(path.join(root, 'archive'));
  const moved = await files.moveNote(await files.read(id, 'target.md'), 'archive/target.md', true);
  const { links } = await relink(files, search, moved, 'target.md');
  assert.deepEqual(
    { ...links, skipped: [...links.skipped].sort() },
    { self: 0, notes: 1, links: 1, skipped: ['drafted.md', 'racing.md'], incomplete: false },
  );
  assert.equal(await read('plain.md'), '[対象](archive/target.md)\n');
  assert.equal(await read('racing.md'), '[対象](target.md) 外部で編集\n');
  assert.equal(await read('drafted.md'), '[対象](target.md)\n');
});

test('Declining the update moves the bytes as they are, and a folder change with relative links is refused', async (t) => {
  const { root, files, search, id, write, read } = await fixture(t);
  await write('wiki/target.md', '# 対象\n\n[兄弟](sibling.md)\n');
  await write('index.md', '[対象](wiki/target.md)\n');
  await mkdir(path.join(root, 'archive'));
  const ref = await files.read(id, 'wiki/target.md');
  await assert.rejects(files.moveNote(ref, 'archive/target.md'), /リンクも更新する/);
  const renamed = await files.moveNote(ref, 'wiki/renamed.md');
  assert.equal(renamed.text, ref.text);
  assert.equal(await read('index.md'), '[対象](wiki/target.md)\n');
  // With the update, the same folder change goes through and the note's links follow.
  const moved = await files.moveNote(renamed, 'archive/target.md', true);
  const { links } = await relink(files, search, moved, 'wiki/renamed.md');
  assert.deepEqual(links, { self: 1, notes: 0, links: 0, skipped: [], incomplete: false });
  assert.equal(await read('archive/target.md'), '# 対象\n\n[兄弟](../wiki/sibling.md)\n');
  const stopped = new SearchService(files, { ...searchLimits, milliseconds: 0 });
  assert.equal((await referringLinks(files, stopped, id, 'archive/target.md')).incomplete, true);
});

test('With links rewritten, only wiki and HTML references still refuse a folder change', () => {
  const image = `_assets/image-${'b'.repeat(64)}.png`;
  const text = `![画像](${image}) [他](../other.md) [ref][r] ![custom](custom.png)\n\n[r]: target.md\n`;
  assert.throws(() => imagesForNoteMove(text), /相対リンク/);
  assert.deepEqual(imagesForNoteMove(text, true), [image]);
  for (const content of ['[[Other]]', '<img src="relative.png">'])
    assert.throws(() => imagesForNoteMove(content, true), /Wiki/);
});

test('The renderer reaches the move and the count only through the validated requests', async (t) => {
  const { files, search, id, write } = await fixture(t);
  await write('a.md', '[b](b.md)\n');
  await write('b.md', '# b\n');
  const handlers = {
    referringLinks: (scopeId: string, target: string) =>
      referringLinks(files, search, scopeId, target),
    moveNote: (ref: Document, destination: string, links: boolean) =>
      files.moveNote(ref, destination, links),
  } as unknown as HostHandlers;
  assert.deepEqual(await dispatchHost(handlers, 'referringLinks', [id, 'b.md']), {
    notes: 1,
    links: 1,
    incomplete: false,
  });
  const b = await files.read(id, 'b.md');
  for (const args of [[b, 'c.md'], [b, 'c.md', 'yes'], [b]])
    await assert.rejects(async () => dispatchHost(handlers, 'moveNote', args));
  await assert.rejects(async () =>
    dispatchHost(handlers, 'referringLinks', ['not-a-uuid', 'b.md']),
  );
  assert.equal(
    ((await dispatchHost(handlers, 'moveNote', [b, 'c.md', true])) as Document).path,
    'c.md',
  );
});
