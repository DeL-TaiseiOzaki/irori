import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildGraphIndex,
  compareCodePoints,
  entityColumns,
  frontmatterBlock,
  graphIndexFiles,
  graphIndexReadme,
  pageFacts,
  renderGraphIndex,
  tableDelta,
  type PageFacts,
} from '../src/domain/graph-index';
import { FileService } from '../src/host/files';
import { SearchService } from '../src/host/search';
import { GraphIndexService } from '../src/host/graph-index';
import { readOntology } from '../src/host/ontology';
import { ontologyFixture } from './fixtures/ontology';

const page = (
  type: string,
  title: string | undefined,
  relations: string[] = [],
  body = 'Body.\n',
) =>
  `---\ntype: ${type}\n${title === undefined ? '' : `title: ${title}\n`}${
    relations.length ? `relations:\n${relations.map((entry) => `  - ${entry}`).join('\n')}\n` : ''
  }---\n\n${body}`;

// A bundle whose pages exercise every rule: a comma in a title, a duplicate, a
// URL, a missing page, a folder index, a page outside the bundle, a non-page
// file, a relation without `rel`, an absent and an empty title, a decomposed
// file name linked in its composed form, a page without frontmatter, one whose
// frontmatter cannot be read, and three files the walk must never meet.
const bundle: [string, string][] = [
  ['Knowledge_Base/index.md', '---\nokf_version: "0.2"\n---\n\n# Index\n'],
  ['Knowledge_Base/wiki/index.md', '# wiki\n'],
  ['Knowledge_Base/entities/index.md', '# entities\n'],
  [
    'Knowledge_Base/wiki/retry-budget.md',
    page('concept', '"Retry budget, revisited"', [
      '{ rel: uses, target: ../entities/service.md }',
      '{ rel: uses, target: ../entities/service.md }',
      '{ rel: same_as, target: https://example.com/retry }',
      '{ rel: refines, target: ./missing.md }',
      '{ rel: lists, target: index.md }',
      '{ rel: cites, target: ../../README.md }',
      '{ rel: reads, target: ../ontology/entities.csv }',
      '{ target: ../entities/service.md }',
    ]),
  ],
  [
    'Knowledge_Base/entities/service.md',
    page('product', undefined, ['{ rel: works_on, target: ../wiki/グラフ.md }']),
  ],
  [
    `Knowledge_Base/wiki/${'グラフ.md'.normalize('NFD')}`,
    page('concept', '""', ['{ rel: refines, target: retry-budget.md#notes }']),
  ],
  ['Knowledge_Base/wiki/alone.md', page('concept', 'Alone', ['{ rel: sees, target: broken.md }'])],
  ['Knowledge_Base/wiki/broken.md', '---\ntitle: [oops\n---\n\nUnreadable frontmatter.\n'],
  ['Knowledge_Base/wiki/plain.md', '# No frontmatter\n'],
  [
    'Knowledge_Base/.hidden/secret.md',
    page('concept', 'Hidden', ['{ rel: uses, target: ../wiki/alone.md }']),
  ],
  [
    'README.md',
    page('concept', 'Outside', ['{ rel: uses, target: Knowledge_Base/wiki/alone.md }']),
  ],
  [
    'Knowledge_Base/ontology/stray.md',
    page('concept', 'Stray', ['{ rel: uses, target: ../wiki/alone.md }']),
  ],
];
const expectedEntities =
  'id,label,note,parentId,group\n' +
  'entities/service,service,Knowledge_Base/entities/service.md,,product\n' +
  'wiki/alone,Alone,Knowledge_Base/wiki/alone.md,,concept\n' +
  'wiki/broken,broken,Knowledge_Base/wiki/broken.md,,\n' +
  'wiki/retry-budget,"Retry budget, revisited",Knowledge_Base/wiki/retry-budget.md,,concept\n' +
  'wiki/グラフ,グラフ,Knowledge_Base/wiki/グラフ.md,,concept\n';
const expectedRelations =
  'sourceId,relation,targetId\n' +
  'entities/service,works_on,wiki/グラフ\n' +
  'wiki/alone,sees,wiki/broken\n' +
  'wiki/retry-budget,uses,entities/service\n' +
  'wiki/グラフ,refines,wiki/retry-budget\n';

async function fixture(t: TestContext, pages = bundle) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori graph index 日本語 '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const root = path.join(base, 'KB');
  await mkdir(root);
  const space = await files.register(root, '知識の束', 'personal');
  const write = async (relative: string, text: string) => {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
  };
  for (const [relative, text] of pages) await write(relative, text);
  const read = (relative: string) => readFile(path.join(root, relative), 'utf8');
  const service = new GraphIndexService(files, new SearchService(files));
  return { root, files, space, write, read, service };
}

test('The graph index is built from the pages alone, in one order, with every exclusion counted', () => {
  const facts: PageFacts[] = [
    pageFacts('Knowledge_Base/wiki/b.md', {
      type: 'concept',
      title: '𝔅 astral',
      relations: [
        { rel: 'uses', target: 'a.md' },
        { rel: 'uses', target: './a.md' },
        { rel: 'same_as', target: 'https://example.com/b' },
        { rel: 'sees', target: '../index.md' },
        { rel: 'sees', target: '../../outside.md' },
        { rel: 'sees', target: '/absolute.md' },
        { rel: 'sees', target: 'a.md/' },
        { rel: '', target: 'a.md' },
        'not a relation',
      ],
    }),
    pageFacts(`Knowledge_Base/wiki/${'ガ.md'.normalize('NFD')}`, {
      title: ['not', 'a', 'string'],
      relations: [{ rel: 'refines', target: 'b.md' }],
    }),
    pageFacts('Knowledge_Base/wiki/a.md', { type: 'concept', title: ' ', relations: 'none' }),
    pageFacts('Knowledge_Base/wiki/\uE000 private.md', {
      relations: [{ rel: 'sees', target: '%E3%82%AC.md#top' }],
    }),
    pageFacts('Knowledge_Base/index.md', { relations: [{ rel: 'lists', target: 'wiki/a.md' }] }),
    pageFacts('Knowledge_Base/ontology/stray.md', {
      relations: [{ rel: 'lists', target: '../wiki/a.md' }],
    }),
    pageFacts('notes/outside.md', {
      relations: [{ rel: 'lists', target: '../Knowledge_Base/wiki/a.md' }],
    }),
  ];
  const tables = buildGraphIndex(facts);
  assert.deepEqual(tables.entities, [
    ['wiki/a', 'a', 'Knowledge_Base/wiki/a.md', '', 'concept'],
    ['wiki/b', '𝔅 astral', 'Knowledge_Base/wiki/b.md', '', 'concept'],
    ['wiki/ガ', 'ガ', 'Knowledge_Base/wiki/ガ.md', '', ''],
    ['wiki/\uE000 private', '\uE000 private', 'Knowledge_Base/wiki/\uE000 private.md', '', ''],
  ]);
  assert.deepEqual(tables.relations, [
    ['wiki/b', 'uses', 'wiki/a'],
    ['wiki/ガ', 'refines', 'wiki/b'],
    ['wiki/\uE000 private', 'sees', 'wiki/ガ'],
  ]);
  assert.equal(tables.excluded, 7, 'URL, index, outside, absolute, folder, no rel, not a map');
  const rendered = renderGraphIndex(tables);
  assert.deepEqual(renderGraphIndex(buildGraphIndex([...facts].reverse())), rendered);
  assert.equal(
    rendered.entities,
    'id,label,note,parentId,group\nwiki/a,a,Knowledge_Base/wiki/a.md,,concept\nwiki/b,𝔅 astral,Knowledge_Base/wiki/b.md,,concept\nwiki/ガ,ガ,Knowledge_Base/wiki/ガ.md,,\nwiki/\uE000 private,\uE000 private,Knowledge_Base/wiki/\uE000 private.md,,\n',
  );
  assert.equal(compareCodePoints('\uE000', '\u{1F600}'), -1, 'code points, not UTF-16 units');
  assert.equal(compareCodePoints('ab', 'abc'), -1);
  assert.equal(compareCodePoints('b', 'ab'), 1);
  assert.deepEqual(renderGraphIndex(buildGraphIndex([])), {
    entities: 'id,label,note,parentId,group\n',
    relations: 'sourceId,relation,targetId\n',
    index: graphIndexReadme,
  });
  assert.equal(frontmatterBlock('\uFEFF---\r\ntitle: x\r\n--- \r\nBody'), 'title: x\r\n');
  assert.equal(frontmatterBlock('---\ntitle: x\n---'), 'title: x\n');
  assert.equal(frontmatterBlock('---\ntitle: x\n'), undefined, 'no closing line');
  assert.equal(frontmatterBlock('# Title\n---\nx\n---\n'), undefined, 'not leading');
  assert.equal(frontmatterBlock('---\n---\n'), '');
  const delta = tableDelta(
    entityColumns,
    tables.entities,
    'group,id,label,note,parentId,extra\nconcept,wiki/a,a,Knowledge_Base/wiki/a.md,,kept\n,gone,Gone,,,\n,gone,Gone,,,\n',
  );
  assert.deepEqual(delta, { rows: 4, added: 3, removed: 2 });
  assert.deepEqual(tableDelta(entityColumns, tables.entities, 'not,the\nmodule'), {
    rows: 4,
    added: 4,
    removed: 0,
  });
});

test('Generating the module writes deterministic tables that the reader loads without a declaration', async (t) => {
  const { files, space, read, service, write } = await fixture(t);
  const before = await service.status(space.scopeId);
  assert.equal(before.present, false);
  assert.equal(before.current, false);
  assert.deepEqual(
    [
      before.pages,
      before.unreadable,
      before.excluded,
      before.entities.added,
      before.relations.added,
    ],
    [6, 1, 6, 5, 4],
  );
  const update = await service.update(space.scopeId);
  assert.deepEqual(update.written, [
    graphIndexFiles.entities,
    graphIndexFiles.relations,
    graphIndexFiles.index,
  ]);
  assert.equal(update.current, true);
  assert.equal(await read(graphIndexFiles.entities), expectedEntities);
  assert.equal(await read(graphIndexFiles.relations), expectedRelations);
  assert.equal(await read(graphIndexFiles.index), graphIndexReadme);
  assert.equal((await read('Knowledge_Base/ontology/stray.md')).includes('Stray'), true);
  const view = (await readOntology(files, space.scopeId))!;
  assert.equal(view.source, 'module');
  assert.equal(view.entitiesPath, graphIndexFiles.entities);
  assert.equal(view.relationsPath, graphIndexFiles.relations);
  assert.deepEqual(
    view.entities.map((entity) => [entity.id, entity.label, entity.note, entity.group]),
    [
      ['entities/service', 'service', 'Knowledge_Base/entities/service.md', 'product'],
      ['wiki/alone', 'Alone', 'Knowledge_Base/wiki/alone.md', 'concept'],
      ['wiki/broken', 'broken', 'Knowledge_Base/wiki/broken.md', undefined],
      [
        'wiki/retry-budget',
        'Retry budget, revisited',
        'Knowledge_Base/wiki/retry-budget.md',
        'concept',
      ],
      ['wiki/グラフ', 'グラフ', 'Knowledge_Base/wiki/グラフ.md', 'concept'],
    ],
  );
  assert.deepEqual(
    view.edges.map((edge) => [edge.source, edge.label, edge.target]),
    [
      ['entities/service', 'works_on', 'wiki/グラフ'],
      ['wiki/alone', 'sees', 'wiki/broken'],
      ['wiki/retry-budget', 'uses', 'entities/service'],
      ['wiki/グラフ', 'refines', 'wiki/retry-budget'],
    ],
  );
  // The same pages in another order and another KB give the same bytes.
  const other = await fixture(t, [...bundle].reverse());
  await other.service.update(other.space.scopeId);
  assert.equal(await other.read(graphIndexFiles.entities), expectedEntities);
  assert.equal(await other.read(graphIndexFiles.relations), expectedRelations);
  // A second update writes nothing; the relation table is optional to the reader.
  assert.deepEqual((await service.update(space.scopeId)).written, []);
  await rm(path.join(space.root, graphIndexFiles.relations));
  assert.equal((await readOntology(files, space.scopeId))!.edges.length, 0);
  assert.equal((await service.status(space.scopeId)).current, false);
  assert.deepEqual((await service.update(space.scopeId)).written, [graphIndexFiles.relations]);
  assert.equal(await read(graphIndexFiles.relations), expectedRelations);
  // Generated files go only through the guarded writer.
  for (const relative of ['.irori/ontology.json', 'contents/x.csv', 'schema/x.csv'])
    await assert.rejects(() => files.writeGenerated(space.scopeId, relative, 'x', null));
  await assert.rejects(
    () => files.writeGenerated(space.scopeId, graphIndexFiles.entities, 'x', null),
    /CONFLICT/,
  );
  await assert.rejects(
    () => files.writeGenerated(space.scopeId, graphIndexFiles.entities, 'x', 'a'.repeat(64)),
    /CONFLICT/,
  );
  assert.equal(await read(graphIndexFiles.entities), expectedEntities);
  await write('Knowledge_Base/wiki/index.md', '# wiki\n\n- retry-budget\n');
  assert.equal((await service.status(space.scopeId)).current, true, 'indexes are not pages');
});

test('Freshness follows what the graph is made of, and an update refuses a result the reader could not load', async (t) => {
  const { space, read, service, write, root } = await fixture(t);
  await service.update(space.scopeId);
  await appendFile(path.join(root, 'Knowledge_Base/wiki/alone.md'), '\nMore body text.\n');
  const body = await service.status(space.scopeId);
  assert.equal(body.current, true, 'a body edit changes no row');
  assert.deepEqual([body.entities.added, body.entities.removed], [0, 0]);
  await write(
    'Knowledge_Base/wiki/alone.md',
    page('concept', 'Alone', ['{ rel: sees, target: plain.md }']),
  );
  const stale = await service.status(space.scopeId);
  assert.equal(stale.current, false);
  assert.deepEqual(stale.entities, { rows: 5, added: 1, removed: 1 });
  assert.deepEqual(stale.relations, { rows: 4, added: 1, removed: 1 });
  assert.equal(await read(graphIndexFiles.entities), expectedEntities, 'a check writes nothing');
  const updated = await service.update(space.scopeId);
  assert.deepEqual(updated.written, [graphIndexFiles.entities, graphIndexFiles.relations]);
  assert.equal(updated.current, true);
  assert.equal(
    await read(graphIndexFiles.entities),
    expectedEntities.replace(
      'wiki/broken,broken,Knowledge_Base/wiki/broken.md,,\n',
      'wiki/plain,plain,Knowledge_Base/wiki/plain.md,,\n',
    ),
  );
  assert.equal(
    await read(graphIndexFiles.relations),
    expectedRelations.replace('wiki/alone,sees,wiki/broken', 'wiki/alone,sees,wiki/plain'),
  );
  // Ten thousand and one relations: refused before anything is written.
  await write(
    'Knowledge_Base/wiki/too-many.md',
    page(
      'concept',
      'Too many',
      Array.from({ length: 10001 }, (_, i) => `{ rel: r${i}, target: plain.md }`),
    ),
  );
  const entities = await read(graphIndexFiles.entities);
  await assert.rejects(() => service.update(space.scopeId), /10,000 関係まで/);
  await assert.rejects(() => service.status(space.scopeId), /10,005 関係/);
  assert.equal(await read(graphIndexFiles.entities), entities);
});

test('A declared pair still wins: the module is neither read nor generated over it', async (t) => {
  const { files, space, read, service, write } = await fixture(t);
  await service.update(space.scopeId);
  const entities = await read(graphIndexFiles.entities);
  await write('.irori/ontology.json', JSON.stringify(ontologyFixture.declaration));
  await write(ontologyFixture.declaration.entities.path, ontologyFixture.entities);
  await write(ontologyFixture.declaration.relations.path, ontologyFixture.relations);
  const view = (await readOntology(files, space.scopeId))!;
  assert.equal(view.source, 'declared');
  assert.equal(view.entitiesPath, 'ontology/entities.csv');
  assert.deepEqual(
    view.entities.map((entity) => entity.id),
    ['root', 'research', 'source', 'output'],
  );
  assert.equal((await service.status(space.scopeId)).declared, true);
  await write(
    'Knowledge_Base/wiki/alone.md',
    page('concept', 'Alone', ['{ rel: sees, target: plain.md }']),
  );
  await assert.rejects(() => service.update(space.scopeId), /ontology\.json/);
  assert.equal(await read(graphIndexFiles.entities), entities);
});
