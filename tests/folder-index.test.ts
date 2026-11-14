import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileService } from '../src/host/files';
import { SearchService } from '../src/host/search';
import { BundleService } from '../src/host/bundle';
import { folderDescriptions, linkDestination, renderFolderIndex } from '../src/domain/folder-index';
import { linksTo, resolveNoteLink, samePath } from '../src/domain/note-links';

const declaration = {
  schemaVersion: 1,
  properties: {},
  types: {
    journal: { heading: '# Entries' },
    concept: { heading: '# Concepts' },
    person: { heading: '# People' },
    policy: {},
  },
};
const page = (fields: Record<string, string>, body = 'Body.\n') =>
  `---\n${Object.entries(fields)
    .map(([key, value]) => `${key}: ${value}\n`)
    .join('')}---\n\n${body}`;
const rootHead = '---\nokf_version: "0.2" # kept as written\n---\n';
const decomposed = 'Knowledge_Base/wiki/データ ノート.md'.normalize('NFD');

// A bundle with every case the rule names: nested folders, a decomposed Japanese
// name, an undeclared and a missing type, a missing description, folder lines a
// person described, prose that is not kept, a folder with only an index, and the
// folders the walk must leave out (hidden, a submodule and a nested vault).
const bundle: [string, string][] = [
  ['.property/property.json', JSON.stringify(declaration)],
  [
    'Knowledge_Base/index.md',
    `${rootHead}\n# Folders\n\n* [wiki](wiki/) - What we know\n* [journal](journal/) - Days and meetings\n\nProse an index does not keep.\n`,
  ],
  [
    'Knowledge_Base/about.md',
    page({ type: 'concept', title: 'About', description: 'Why it exists' }),
  ],
  ['Knowledge_Base/journal/index.md', '# Entries\n\nNothing yet.\n'],
  ['Knowledge_Base/archive/index.md', '# Archive\n\nKept by hand.\n'],
  [
    'Knowledge_Base/wiki/index.md',
    '# Old heading\n\n* [Topics](topics/index.md) — Grouped notes\n* [gone](gone/) - A folder that left\n',
  ],
  [
    'Knowledge_Base/wiki/a.md',
    page({
      type: 'concept',
      title: 'Retry [budget] \\ cost',
      description: '"Two   spaces\\n and  a line"',
    }),
  ],
  ['Knowledge_Base/wiki/b.md', page({ type: 'concept', title: 'B' })],
  ['Knowledge_Base/wiki/(paren) #1.md', page({ type: 'concept', title: 'Paren' })],
  ['Knowledge_Base/wiki/c.md', page({ type: 'synthesis', title: 'C', description: 'Undeclared' })],
  ['Knowledge_Base/wiki/d.md', '# No frontmatter\n'],
  [decomposed, page({ type: 'person', title: '山田', description: '記録' })],
  ['Knowledge_Base/wiki/topics/deep/x.md', page({ type: 'concept' })],
  ['Knowledge_Base/wiki/ext/.git', 'gitdir: ../../../.git/modules/ext\n'],
  ['Knowledge_Base/wiki/ext/inside.md', page({ type: 'concept', title: 'Inside' })],
  ['Knowledge_Base/.hidden/h.md', page({ type: 'concept', title: 'Hidden' })],
];

const expected: Record<string, string> = {
  'Knowledge_Base/index.md':
    `${rootHead}\n# Folders\n\n` +
    '* [archive](archive/)\n* [journal](journal/) - Days and meetings\n* [wiki](wiki/) - What we know\n\n' +
    '# Concepts\n\n* [About](about.md) - Why it exists\n',
  'Knowledge_Base/wiki/index.md':
    '# Folders\n\n* [topics](topics/) - Grouped notes\n\n' +
    '# Concepts\n\n' +
    '* [Paren](%28paren%29%20%231.md)\n' +
    '* [Retry \\[budget\\] \\\\ cost](a.md) - Two spaces and a line\n' +
    '* [B](b.md)\n\n' +
    '# People\n\n* [山田](データ%20ノート.md) - 記録\n\n' +
    '# Other pages\n\n* [C](c.md) - Undeclared\n* [d](d.md)\n',
  'Knowledge_Base/wiki/topics/index.md': '# Folders\n\n* [deep](deep/)\n',
  'Knowledge_Base/wiki/topics/deep/index.md': '# Concepts\n\n* [x](x.md)\n',
};

async function fixture(t: TestContext, files = bundle) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori folder index 日本語 '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const service = new FileService(path.join(base, 'device'));
  await service.init();
  const root = path.join(base, 'KB');
  await mkdir(root);
  const space = await service.register(root, '索引の束', 'personal');
  const write = async (relative: string, text: string) => {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
  };
  for (const [relative, text] of files) await write(relative, text);
  // A nested vault is another KB: its pages list nowhere here.
  await mkdir(path.join(root, 'Knowledge_Base/team'), { recursive: true });
  await service.register(path.join(root, 'Knowledge_Base/team'), '入れ子', 'team');
  await write('Knowledge_Base/team/Knowledge_Base/inner.md', page({ type: 'concept' }));
  const read = (relative: string) => readFile(path.join(root, relative), 'utf8');
  const bundles = new BundleService(service, new SearchService(service));
  const indexes = async () => (await bundles.ontology(space.scopeId)).indexes;
  return { root, files: service, space, write, read, bundles, indexes };
}

async function filesUnder(directory: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      out.push(...(await filesUnder(path.join(directory, entry.name), relative)));
    else out.push(relative);
  }
  return out;
}

test('Folder indexes are generated from the pages, deterministically, and kept only where they list something', async (t) => {
  const { root, space, read, bundles, indexes } = await fixture(t);
  assert.deepEqual(await indexes(), { folders: 4, added: 2, changed: 2 });
  const updated = await bundles.update(space.scopeId);
  assert.equal(updated.bundle, true);
  // Every page the walk met, the submodule's included; only the indexes leave that one out.
  assert.equal(updated.pages, 9);
  assert.deepEqual(updated.written.sort(), Object.keys(expected).sort());
  // The indexes are all an update writes: irori generates no graph of the pages (ADR 060).
  assert.ok(!(await filesUnder(root)).some((file) => file.includes('ontology/')));
  for (const [file, text] of Object.entries(expected)) assert.equal(await read(file), text, file);
  // A folder with no page keeps its own index, and is listed above.
  assert.equal(await read('Knowledge_Base/journal/index.md'), '# Entries\n\nNothing yet.\n');
  assert.equal(await read('Knowledge_Base/archive/index.md'), '# Archive\n\nKept by hand.\n');
  // Nothing the walk leaves out got an index.
  const written = await filesUnder(path.join(root, 'Knowledge_Base'));
  for (const left of ['wiki/ext/index.md', '.hidden/index.md', 'team/index.md'])
    assert.ok(!written.includes(left), left);
  // The same pages give the same bytes: a second run writes nothing.
  const again = await bundles.update(space.scopeId);
  assert.deepEqual(again.written, []);
  assert.deepEqual(await indexes(), { folders: 4, added: 0, changed: 0 });

  // Every generated link resolves, through irori's own link reader, to a file on disk.
  const onDisk = (await filesUnder(root)).filter((file) => !file.startsWith('.git/'));
  for (const file of Object.keys(expected)) {
    const text = await read(file);
    for (const line of text.split('\n').filter((entry) => entry.startsWith('* ['))) {
      const href = /\]\((.*?)\)(?: - |$)/.exec(line)![1];
      const link = resolveNoteLink(file, href);
      assert.equal(link.kind, 'internal', line);
      const target = (link as { path: string }).path;
      const actual = onDisk.find((candidate) => samePath(candidate, target));
      assert.ok(actual, `${file}: ${line} resolves to ${target}`);
      assert.ok(linksTo(file, actual)(line), `${file}: the reader finds ${line}`);
    }
  }
});

test('A page change, a removed page and a new folder show as counts and are written by one update', async (t) => {
  const { space, write, read, bundles, indexes, root } = await fixture(t);
  await bundles.update(space.scopeId);
  await write(
    'Knowledge_Base/wiki/b.md',
    page({ type: 'concept', title: 'B', description: 'Now said' }),
  );
  await write(
    'Knowledge_Base/journal/2026/2026-10-07.md',
    page({ type: 'journal', title: '10月7日' }),
  );
  await rm(path.join(root, 'Knowledge_Base/wiki/topics'), { recursive: true });
  // wiki changes; journal and journal/2026 are new pages' folders, journal's index is rewritten.
  assert.deepEqual(await indexes(), { folders: 4, added: 1, changed: 2 });
  await bundles.update(space.scopeId);
  assert.match(await read('Knowledge_Base/wiki/index.md'), /\* \[B\]\(b\.md\) - Now said\n/);
  assert.doesNotMatch(await read('Knowledge_Base/wiki/index.md'), /topics/);
  assert.equal(await read('Knowledge_Base/journal/index.md'), '# Folders\n\n* [2026](2026/)\n');
  assert.equal(
    await read('Knowledge_Base/journal/2026/index.md'),
    '# Entries\n\n* [10月7日](2026-10-07.md)\n',
  );
  // The topics folder index went with its folder; the root still lists journal with its description.
  assert.match(
    await read('Knowledge_Base/index.md'),
    /\* \[journal\]\(journal\/\) - Days and meetings\n/,
  );
});

test('A folder that held the graph index of an earlier irori is a folder like any other', async (t) => {
  const { space, write, read, bundles } = await fixture(t);
  const former = 'id,label,note,parentId,group\n';
  await write('Knowledge_Base/ontology/entities.csv', former);
  await write('Knowledge_Base/ontology/index.md', '# ontology\n\nGenerated by an earlier irori.\n');
  assert.equal(
    (await bundles.ontology(space.scopeId)).formerGraphIndex,
    'Knowledge_Base/ontology/',
  );
  await bundles.update(space.scopeId);
  // It holds no page, so its own index is left alone; the root lists it, as it lists `archive`.
  assert.equal(await read('Knowledge_Base/ontology/entities.csv'), former);
  assert.equal(
    await read('Knowledge_Base/ontology/index.md'),
    '# ontology\n\nGenerated by an earlier irori.\n',
  );
  assert.match(await read('Knowledge_Base/index.md'), /\* \[ontology\]\(ontology\/\)\n/);
});

test('Only an OKF bundle with a readable property declaration is offered folder indexes', async (t) => {
  const { space, write, read, bundles, indexes } = await fixture(t);
  const nothing = { bundle: false, pages: 0, written: [] };
  await write('.property/property.json', '{ "schemaVersion": 2 }');
  assert.equal(await indexes(), undefined);
  assert.deepEqual(await bundles.update(space.scopeId), nothing);
  await write('.property/property.json', JSON.stringify(declaration));
  await write('Knowledge_Base/index.md', '# Index without okf_version\n');
  assert.equal(await indexes(), undefined);
  await write('Knowledge_Base/index.md', '---\ntitle: not a bundle root\n---\n');
  assert.equal(await indexes(), undefined);
  // An update there writes nothing: without a bundle there is no index to write.
  assert.deepEqual(await bundles.update(space.scopeId), nothing);
  assert.equal(await read('Knowledge_Base/index.md'), '---\ntitle: not a bundle root\n---\n');
});

test('An empty folder with only an index keeps its line and description in the root index', async (t) => {
  const { space, read, bundles } = await fixture(t, [
    ['.property/property.json', JSON.stringify(declaration)],
    [
      'Knowledge_Base/index.md',
      '---\nokf_version: "0.2"\n---\n\n# Folders\n\n* [journal](journal/) - Days, meetings and weeks\n* [wiki](wiki/) - What we know\n',
    ],
    ['Knowledge_Base/journal/index.md', '# Entries\n'],
    ['Knowledge_Base/wiki/index.md', '# Concepts\n'],
    ['Knowledge_Base/wiki/first.md', page({ type: 'concept', title: 'First' })],
  ]);
  await bundles.update(space.scopeId);
  assert.equal(
    await read('Knowledge_Base/index.md'),
    '---\nokf_version: "0.2"\n---\n\n# Folders\n\n' +
      '* [journal](journal/) - Days, meetings and weeks\n* [wiki](wiki/) - What we know\n',
  );
  assert.equal(await read('Knowledge_Base/journal/index.md'), '# Entries\n');
});

test('Index lines are escaped, encoded and parsed back in time linear in their length', () => {
  assert.equal(
    linkDestination('a b(c)<d>#e:f%g\\h`i.md'),
    'a%20b%28c%29%3Cd%3E%23e%3Af%25g%5Ch%60i.md',
  );
  assert.equal(linkDestination('データ.md'.normalize('NFD')), 'データ.md');
  assert.equal(
    renderFolderIndex({
      folders: [{ name: 'b' }, { name: 'a', description: '  x \n y ' }],
      pages: [],
      declaration: { types: {} },
    }),
    '# Folders\n\n* [a](a/) - x y\n* [b](b/)\n',
  );
  const descriptions = folderDescriptions(
    [
      '* [Wiki](./wiki/) - kept',
      '- [日本語](%E6%97%A5%E6%9C%AC%E8%AA%9E/index.md): コロン',
      '* [a b](<a b/>) — angle',
      '* [not a folder](page.md) - no',
      'plain text [x](x/) - not a list item',
    ].join('\n'),
  );
  assert.deepEqual(Object.fromEntries(descriptions), {
    wiki: 'kept',
    日本語: 'コロン',
    'a b': 'angle',
  });
  const crafted = '* [' + '\\['.repeat(200_000) + '](' + 'a'.repeat(200_000);
  const started = performance.now();
  folderDescriptions(`${crafted}\n${'* ['.repeat(100_000)}\n`);
  assert.ok(performance.now() - started < 1000, 'a crafted line is read in linear time');
});
