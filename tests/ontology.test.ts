import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  parseCsv,
  ontologyDeclaration,
  ontologyGraph,
  selectSubgraph,
} from '../src/domain/ontology';
import { FileService, hash } from '../src/host/files';
import { readOntology } from '../src/host/ontology';
import { ontologyFixture as fixture } from './fixtures/ontology';

test('CSV projection retains quoted unknown fields, BOM/CRLF values and string identities', () => {
  const table = parseCsv(fixture.entities);
  assert.equal(table.columns.at(-1), 'unknown');
  assert.equal(table.rows[0].at(-1), 'keep, this');
  assert.equal(table.rows[1].at(-1), 'two\r\nlines');
  assert.deepEqual(parseCsv('id,value\n001,=formula\n').rows, [['001', '=formula']]);
  for (const text of ['id,id\nx,y', 'id,label\nx,y,z', 'id,label\nx,"unclosed'])
    assert.throws(() => parseCsv(text));
  assert.throws(() => parseCsv('id\n' + 'x\n'.repeat(20001)), /20,000/);
});

test('Ontology hierarchy and induced subgraphs preserve declared entity IDs and relation direction', () => {
  const mapped = ontologyGraph(
    ontologyDeclaration.parse({
      schemaVersion: 1,
      entities: { path: 'existing.csv', id: 'key', label: '名称' },
    }),
    'key,名称,extra\n001,既存ラベル,preserved\n',
  );
  assert.equal(mapped.entities[0].id, '001');
  assert.equal(mapped.entities[0].label, '既存ラベル');
  assert.deepEqual(mapped.edges, []);
  const declaration = ontologyDeclaration.parse(fixture.declaration);
  const graph = ontologyGraph(declaration, fixture.entities, fixture.relations);
  assert.equal(graph.entities.length, 4);
  assert.equal(graph.edges.length, 5);
  const subset = selectSubgraph(graph, '調査', 'research', false);
  assert.deepEqual(
    subset.entities.map((entity) => entity.id),
    ['research', 'source'],
  );
  assert.deepEqual(
    subset.edges.map((edge) => [edge.source, edge.target]),
    [
      ['research', 'source'],
      ['research', 'source'],
    ],
  );
  assert.equal(selectSubgraph(graph, '', 'root', true).edges.length, 3);
  assert.equal(selectSubgraph(graph, '活用', 'research', false).entities.length, 0);
  assert.equal(
    ontologyGraph(
      declaration,
      fixture.entities.replace('調査,notes/', '調査 改訂,notes/'),
      fixture.relations,
    ).entities[1].id,
    'research',
  );
  assert.throws(
    () =>
      ontologyGraph(
        declaration,
        fixture.entities.replace('source,資料', 'research,資料'),
        fixture.relations,
      ),
    /重複/,
  );
  assert.throws(
    () =>
      ontologyGraph(
        declaration,
        fixture.entities.replace('notes/概念.md,,', 'notes/概念.md,source,'),
        fixture.relations,
      ),
    /循環/,
  );
  assert.throws(
    () =>
      ontologyGraph(
        declaration,
        fixture.entities,
        fixture.relations.replace('source,支える,output', 'source,支える,missing'),
      ),
    /不明/,
  );
  assert.throws(() =>
    ontologyGraph(
      declaration,
      fixture.entities.replace('notes/概念.md', '../foreign.md'),
      fixture.relations,
    ),
  );
});

test('Declared ontology reads are scoped, unchanged on disk, versioned and fail visibly on invalid or foreign data', async (t) => {
  const base = await mkdtemp(path.join(tmpdir(), 'irori ontology 日本語 '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const root = path.join(base, 'KB');
  await mkdir(root);
  const space = await files.register(root, 'Knowledge', 'personal');
  await mkdir(path.join(root, 'ontology'));
  await mkdir(path.join(root, 'notes'));
  const entities = path.join(root, fixture.declaration.entities.path);
  await writeFile(entities, fixture.entities);
  await writeFile(path.join(root, fixture.declaration.relations.path), fixture.relations);
  assert.equal(await readOntology(files, space.scopeId), null, 'an arbitrary CSV is not ontology');
  await writeFile(path.join(root, '.irori/ontology.json'), JSON.stringify(fixture.declaration));
  const first = (await readOntology(files, space.scopeId))!;
  assert.equal(first.revisions[0].hash, hash(Buffer.from(fixture.entities)));
  assert.equal(first.entities[0].note, 'notes/概念.md', 'missing notes remain explicit links');
  assert.equal(await readFile(entities, 'utf8'), fixture.entities);
  const doc = await files.read(space.scopeId, fixture.declaration.entities.path);
  await files.save({ ...doc, text: fixture.entities.replace('ナレッジ', '知識') });
  const next = (await readOntology(files, space.scopeId))!;
  assert.equal(next.entities[0].id, first.entities[0].id);
  assert.notEqual(next.revisions[0].hash, first.revisions[0].hash);
  assert((await readFile(entities, 'utf8')).includes('"two\r\nlines"'));
  await assert.rejects(() => files.save({ ...doc, text: 'stale' }), /CONFLICT/);
  await writeFile(entities, fixture.entities.replace('notes/概念.md', 'contents/raw.md'));
  await assert.rejects(() => readOntology(files, space.scopeId), /knowledge layer/);
  const nested = path.join(root, 'nested');
  await mkdir(nested);
  await files.register(nested, 'Other owner', 'team');
  await writeFile(entities, fixture.entities.replace('notes/概念.md', 'nested/note.md'));
  await assert.rejects(() => readOntology(files, space.scopeId), /another space/);
  await writeFile(entities, fixture.entities);
  if (process.platform !== 'win32') {
    await symlink(path.join(root, '.irori/scope.json'), path.join(root, 'notes/概念.md'));
    await assert.rejects(() => readOntology(files, space.scopeId), /aliases/);
  }
  await writeFile(path.join(root, '.irori/ontology.json'), '{invalid');
  await assert.rejects(() => readOntology(files, space.scopeId));
});
