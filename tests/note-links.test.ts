import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { FileService } from '../src/host/files';
import { foldsCase, resolveLink } from '../src/host/links';
import { SearchService, searchLimits } from '../src/host/search';
import { linksTo, resolveNoteLink, samePath } from '../src/domain/note-links';
import type { KnowledgeSearch } from '../src/domain/search';
import { dispatchHost, type HostHandlers } from '../src/domain/host-requests';

async function fixture(t: TestContext) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori links '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const root = path.join(base, 'Knowledge');
  await mkdir(root);
  const space = await files.register(root, 'リンクのKB', 'personal');
  const write = async (relative: string, text = '# note\n') => {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
  };
  return { base, root, files, space, write };
}

test('A link written in a note resolves against that note, not the knowledge base root', () => {
  const from = 'Knowledge_Base/wiki/topic.md';
  assert.deepEqual(resolveNoteLink(from, 'other.md'), {
    kind: 'internal',
    path: 'Knowledge_Base/wiki/other.md',
  });
  assert.deepEqual(resolveNoteLink(from, './other.md'), {
    kind: 'internal',
    path: 'Knowledge_Base/wiki/other.md',
  });
  assert.deepEqual(resolveNoteLink(from, '../decisions/2026-09-21.md'), {
    kind: 'internal',
    path: 'Knowledge_Base/decisions/2026-09-21.md',
  });
  // A heading in the target is navigation inside that page, not part of its identity.
  assert.deepEqual(resolveNoteLink(from, 'other.md#決定'), {
    kind: 'internal',
    path: 'Knowledge_Base/wiki/other.md',
  });
  // Editors percent-encode what a Markdown target cannot carry literally.
  assert.deepEqual(resolveNoteLink(from, '%E6%97%A5%E6%9C%AC%E8%AA%9E%20note.md'), {
    kind: 'internal',
    path: 'Knowledge_Base/wiki/日本語 note.md',
  });
  assert.deepEqual(resolveNoteLink('top.md', 'sub/deep/../page.md'), {
    kind: 'internal',
    path: 'sub/page.md',
  });
});

test('Only a relative path inside the knowledge base, or a web address, is followed', () => {
  const from = 'Knowledge_Base/wiki/topic.md';
  assert.deepEqual(resolveNoteLink(from, 'https://example.com/a?b=1'), {
    kind: 'external',
    url: 'https://example.com/a?b=1',
  });
  assert.deepEqual(resolveNoteLink(from, '#見出し'), { kind: 'anchor' });
  for (const href of [
    'mailto:someone@example.com',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,<script>',
    '//example.com/a',
    '/etc/passwd',
    'C:\\Windows\\system.ini',
    'sub\\page.md',
    '%E0%A4%A.md',
    '   ',
    '../../../../etc/passwd',
    'wiki/',
  ])
    assert.equal(
      resolveNoteLink(from, href).kind,
      'rejected',
      `${href} must not resolve to a path`,
    );
  // Leaving the knowledge base by one step too many is refused here; a folder inside
  // it resolves, and the host refuses it as something that is not a document.
  assert.equal(resolveNoteLink('top.md', '..').kind, 'rejected');
  assert.deepEqual(resolveNoteLink(from, '..'), {
    kind: 'internal',
    path: 'Knowledge_Base',
  });
});

test('The host answers what is actually at the link, through the space guards', async (t) => {
  const { root, files, space, write } = await fixture(t);
  await write('Knowledge_Base/wiki/topic.md', '# topic\n\n[次](other.md)\n');
  await write('Knowledge_Base/wiki/other.md');
  await write('Knowledge_Base/wiki/table.csv', 'id,label\n1,a\n');
  await mkdir(path.join(root, 'Knowledge_Base/wiki/folder'));
  const from = 'Knowledge_Base/wiki/topic.md';
  const link = (href: string) => resolveLink(files, space.scopeId, from, href);

  assert.deepEqual(await link('other.md'), {
    kind: 'file',
    path: 'Knowledge_Base/wiki/other.md',
    note: true,
  });
  assert.deepEqual(await link('table.csv'), {
    kind: 'file',
    path: 'Knowledge_Base/wiki/table.csv',
    note: false,
  });
  // A page that has not been written yet is missing, which is a fact about the
  // knowledge base rather than a failure to answer.
  assert.deepEqual(await link('planned.md'), {
    kind: 'missing',
    path: 'Knowledge_Base/wiki/planned.md',
  });
  assert.equal((await link('folder')).kind, 'rejected');
  assert.deepEqual(await link('https://example.com/'), {
    kind: 'external',
    url: 'https://example.com/',
  });
});

test('A link out of the space, or into another registered KB, is refused', async (t) => {
  const { base, root, files, space, write } = await fixture(t);
  await write('Knowledge_Base/wiki/topic.md');
  const outside = path.join(base, 'outside.md');
  await writeFile(outside, '# outside\n');
  await symlink(outside, path.join(root, 'Knowledge_Base/wiki/escape.md'));
  const nested = path.join(root, 'Knowledge_Base/nested');
  await mkdir(nested, { recursive: true });
  await writeFile(path.join(nested, 'inner.md'), '# inner\n');
  await files.register(nested, '入れ子のKB', 'personal');
  const from = 'Knowledge_Base/wiki/topic.md';

  // The symlink is a real entry here, so only the host's realpath check catches it.
  assert.equal((await resolveLink(files, space.scopeId, from, 'escape.md')).kind, 'rejected');
  assert.equal(
    (await resolveLink(files, space.scopeId, from, '../nested/inner.md')).kind,
    'rejected',
  );
});

test('Contents links are refused while the cloud connection is unverified', async (t) => {
  const { root, files, space, write } = await fixture(t);
  await write('Knowledge_Base/wiki/topic.md');
  await mkdir(path.join(root, 'contents/drive'), { recursive: true });
  await writeFile(path.join(root, 'contents/drive/report.md'), '# report\n');
  const resolved = await resolveLink(
    files,
    space.scopeId,
    'Knowledge_Base/wiki/topic.md',
    '../../contents/drive/report.md',
  );
  assert.equal(resolved.kind, 'rejected');
  assert.match(resolved.reason, /contents/);
});

test('The renderer reaches link resolution only through the validated request', async (t) => {
  const { files, space, write } = await fixture(t);
  await write('Knowledge_Base/wiki/topic.md');
  await write('Knowledge_Base/wiki/other.md');
  const handlers = {
    resolveLink: (scopeId: string, from: string, href: string) =>
      resolveLink(files, scopeId, from, href),
  } as unknown as HostHandlers;
  assert.deepEqual(
    await dispatchHost(handlers, 'resolveLink', [
      space.scopeId,
      'Knowledge_Base/wiki/topic.md',
      'other.md',
    ]),
    { kind: 'file', path: 'Knowledge_Base/wiki/other.md', note: true },
  );
  await assert.rejects(async () =>
    dispatchHost(handlers, 'resolveLink', ['not-a-uuid', 'topic.md', 'other.md']),
  );
  await assert.rejects(async () =>
    dispatchHost(handlers, 'resolveLink', [space.scopeId, 'topic.md', '']),
  );
});

function linkingLines(from: string, target: string, text: string, foldCase = false) {
  const match = linksTo(from, target, foldCase);
  return text.split('\n').flatMap((line, index) => (match(line) ? [index + 1] : []));
}

test('A backlink is a Markdown link that resolves to the note, as a reader sees it', () => {
  const text = [
    '[plain](target.md)',
    '[heading and title](./target.md#見出し "title")',
    '[elsewhere](other.md) then [second](<target.md>)',
    '[from the root](../wiki/target.md)',
    '[ref]: target.md',
    '`[code span](target.md)`',
    '````md',
    '[fenced](target.md)',
    '```',
    '[still fenced](target.md)',
    '````',
    '~~~',
    '[tilde fenced](target.md)',
    '~~~',
    '```inline``` [after inline code](target.md)',
    '[web](https://example.com/wiki/target.md)',
    '[above the KB](../../target.md)',
    '[anchor](#target.md)',
    '[prefix](target.md.bak)',
  ].join('\n');
  assert.deepEqual(linkingLines('wiki/topic.md', 'wiki/target.md', text), [1, 2, 3, 4, 5, 15]);
});

test('A backlink is found however the editor or an agent wrote the destination', () => {
  const target = 'wiki/会議 メモ (1).md';
  for (const href of [
    '<会議 メモ (1).md>',
    '%E4%BC%9A%E8%AD%B0%20%E3%83%A1%E3%83%A2%20(1).md',
    '会議%20メモ%20\\(1\\).md',
  ])
    assert.deepEqual(linkingLines('wiki/index.md', target, `- [会議](${href})`), [1], href);
  // A Mac can store a Japanese name decomposed while the link is written composed.
  assert.deepEqual(
    linkingLines('index.md', 'ガイド.md'.normalize('NFD'), '[手引き](ガイド.md)'),
    [1],
  );
});

test('A hit names the label a reader sees, or nothing where no visible text is the link', () => {
  const match = linksTo('wiki/topic.md', 'wiki/target.md');
  const label = (line: string) => {
    const found = match(line);
    assert.ok(found, line);
    assert.equal(found.input, line);
    return found.groups && [found.groups.label, found.index, found[0]];
  };
  assert.deepEqual(label('- see [the page](target.md) now'), [
    'the page',
    7,
    'the page](target.md',
  ]);
  assert.deepEqual(label('[a [b] c](target.md)'), ['a [b] c', 1, 'a [b] c](target.md']);
  assert.deepEqual(label('[x](other.md) and [y](./target.md#h)'), ['y', 19, 'y](./target.md#h']);
  assert.deepEqual(label('\\![not an image](target.md)'), [
    'not an image',
    3,
    'not an image](target.md',
  ]);
  assert.deepEqual(label('[](target.md)'), ['', 1, '](target.md']);
  // Formatting and code stay as written; the editor decides whether that text is on screen.
  assert.deepEqual(label('[see `x`](target.md)'), ['see `x`', 1, 'see `x`](target.md']);
  for (const line of [
    '![alt](target.md)',
    '[ref]: target.md',
    'stray ](target.md)',
    '\\\\![after a literal backslash](target.md)',
  ])
    assert.equal(label(line), undefined, line);
});

test('A link in another case counts only where the disk folds case, as following it does', async (t) => {
  assert.equal(samePath('wiki/Note.md', 'wiki/note.md'), false);
  assert.equal(samePath('wiki/Note.md', 'wiki/note.md', true), true);
  assert.deepEqual(linkingLines('index.md', 'wiki/note.md', '[a](wiki/NOTE.md)'), []);
  assert.deepEqual(linkingLines('index.md', 'wiki/note.md', '[a](wiki/NOTE.md)', true), [1]);

  const { root, files, space, write } = await fixture(t);
  await write('wiki/note.md', '[myself](Note.md)\n');
  await write('index.md', '[a](wiki/Note.md)\n[b](wiki/note.md)\n');
  // Whether this disk folds case is observed the same way here and in the host.
  const aliases = await readFile(path.join(root, 'wiki/NOTE.MD'))
    .then(() => true)
    .catch(() => false);
  assert.equal(await foldsCase(files, space.scopeId, 'wiki/note.md'), aliases);
  assert.equal(await foldsCase(files, space.scopeId, 'wiki/missing.md'), false);
  const search = new SearchService(files);
  const lines = async (target: string) =>
    (await search.backlinks(space.scopeId, target)).hits.map((hit) => `${hit.path}:${hit.line}`);
  assert.deepEqual(
    await lines('wiki/note.md'),
    aliases ? ['index.md:1', 'index.md:2'] : ['index.md:2'],
  );
  // A note reached through a link in the other case is still itself, not a linking note.
  if (aliases) assert.deepEqual(await lines('wiki/Note.md'), ['index.md:1', 'index.md:2']);
});

test('A crafted line is read in linear time, since the scan blocks the main process', () => {
  const match = linksTo('a.md', 'b.md');
  const runs = Array.from({ length: 2000 }, (_, i) => '`'.repeat(2000 - i)).join(' x ');
  const start = performance.now();
  // Each took many seconds with a backtracking pattern.
  assert.equal(match('`'.repeat(100_000) + 'a`'), null);
  assert.ok(match(`${runs} [b](b.md)`));
  // Pairing the label's brackets is one pass, not one per bracket or per link.
  assert.ok(match('['.repeat(100_000) + '](b.md)'));
  assert.ok(match('[x](x.md) '.repeat(20_000) + '[b](b.md)'));
  assert.ok(match('](b.md)'.repeat(20_000)));
  assert.ok(performance.now() - start < 1000);
});

test('Backlinks come from the other notes of the knowledge layer', async (t) => {
  const { files, space, write } = await fixture(t);
  await write('wiki/target.md', '# 対象\n\n[自分](target.md)\n');
  await write('index.md', '# 目次\n\n- [対象のページ](wiki/target.md)\n');
  await write('journal/2026/09-21.md', '今日は [対象](../../wiki/target.md) を読んだ。\n');
  await write('wiki/unrelated.md', '[別のページ](other.md)\n');
  for (const relative of [
    'notes.txt',
    'AGENTS.md',
    'schema/rules.md',
    '.hidden/note.md',
    'contents/report.md',
  ])
    await write(
      relative,
      `[対象](${path.posix.relative(path.posix.dirname(relative), 'wiki/target.md')})\n`,
    );
  const result = await new SearchService(files).backlinks(space.scopeId, 'wiki/target.md');
  assert.equal(result.query, 'wiki/target.md');
  assert.equal(result.incomplete, false);
  assert.deepEqual(
    result.hits.sort((a, b) => a.path.localeCompare(b.path)),
    [
      {
        path: 'index.md',
        line: 3,
        preview: '- [対象のページ](wiki/target.md)',
        label: '対象のページ',
        column: 3,
      },
      {
        path: 'journal/2026/09-21.md',
        line: 1,
        preview: '今日は [対象](../../wiki/target.md) を読んだ。',
        label: '対象',
        column: 5,
      },
    ],
  );
  // A text search hit is as it was: nothing names its visible text or its column.
  const searched = await new SearchService(files).search(space.scopeId, '対象のページ');
  assert.deepEqual(Object.keys(searched.hits[0]), ['path', 'line', 'preview']);
  const stopped = await new SearchService(files, { ...searchLimits, milliseconds: 0 }).backlinks(
    space.scopeId,
    'wiki/target.md',
  );
  assert.equal(stopped.incomplete, true);
});

test('The renderer reaches backlinks only through the validated request', async (t) => {
  const { files, space, write } = await fixture(t);
  await write('a.md', '[b](b.md)\n');
  const search = new SearchService(files);
  const handlers = {
    backlinks: (scopeId: string, target: string) => search.backlinks(scopeId, target),
  } as unknown as HostHandlers;
  const result = (await dispatchHost(handlers, 'backlinks', [
    space.scopeId,
    'b.md',
  ])) as KnowledgeSearch;
  assert.deepEqual(
    result.hits.map((hit) => hit.path),
    ['a.md'],
  );
  for (const args of [['not-a-uuid', 'b.md'], [space.scopeId, 7], [space.scopeId]])
    await assert.rejects(async () => dispatchHost(handlers, 'backlinks', args));
});
