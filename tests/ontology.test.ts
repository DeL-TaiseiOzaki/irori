import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pageFacts, type PageFacts } from '../src/domain/bundle';
import { checkOntology, findingLimit, relationTarget, relationsFrom } from '../src/domain/ontology';
import { propertyDeclaration } from '../src/domain/properties';
import { linkTo, resolveNoteLink } from '../src/domain/note-links';
import { FileService } from '../src/host/files';
import { SearchService } from '../src/host/search';
import { BundleService } from '../src/host/bundle';
import { createTypedNote } from '../src/host/properties';
import { page, vocabulary } from './fixtures/ontology';

const declaration = propertyDeclaration.parse(vocabulary);
const sources = [{ id: 's', resource: 'https://example.com/source' }];

test("A relation's target is any page, a URL or the types it names, and older declarations still read", () => {
  assert.deepEqual(relationTarget(declaration.relations.about.to), ['person', 'org', 'project']);
  assert.equal(relationTarget(declaration.relations.uses.to), 'page');
  assert.equal(relationTarget(declaration.relations.same_as.to), 'url');
  assert.equal(relationTarget(undefined), 'page');
  // A declaration written before a target could name types.
  const older = propertyDeclaration.parse({
    schemaVersion: 1,
    relations: { about: { from: 'any', to: 'page' } },
  });
  assert.equal(relationTarget(older.relations.about.to), 'page');
  assert.throws(() =>
    propertyDeclaration.parse({ schemaVersion: 1, relations: { about: { to: 5 } } }),
  );
  // What a page of each type may state, without the names to avoid.
  assert.deepEqual(relationsFrom(declaration, 'concept'), ['about', 'uses']);
  assert.deepEqual(relationsFrom(declaration, 'person'), ['about', 'part_of', 'uses', 'same_as']);
  assert.deepEqual(relationsFrom(declaration, undefined), ['about', 'uses']);
  const avoiding = propertyDeclaration.parse({
    ...vocabulary,
    avoid: [{ name: 'uses', use: 'a link' }],
  });
  assert.deepEqual(relationsFrom(avoiding, 'concept'), ['about']);
});

test('The declaration applied to the pages names every way a page parts from it', () => {
  const at = (name: string) => `Knowledge_Base/wiki/${name}.md`;
  const pages: PageFacts[] = [
    pageFacts(at('alpha'), { type: 'project', title: 'Alpha' }),
    pageFacts(at('acme'), { type: 'org', title: 'Acme' }),
    pageFacts(at('taro'), {
      type: 'person',
      title: 'Taro',
      relations: [
        { rel: 'part_of', target: 'alpha.md' },
        { rel: 'same_as', target: 'https://example.com/taro' },
      ],
    }),
    pageFacts(at('claim'), {
      type: 'concept',
      title: 'Claim',
      sources,
      relations: [
        { rel: 'about', target: './alpha.md#goal' },
        { rel: 'uses', target: 'other.md' },
      ],
    }),
    pageFacts(at('other'), { type: 'concept', title: 'Other', sources }),
    pageFacts(at('no-type'), { title: 'No type' }),
    pageFacts(at('old-name'), { type: 'synthesis', title: 'Old name' }),
    pageFacts(at('new-name'), { type: 'experiment', title: 'New name' }),
    pageFacts(at('no-sources'), { type: 'concept', title: 'No sources', sources: [] }),
    pageFacts(at('names'), {
      type: 'concept',
      title: 'Names',
      sources,
      relations: [
        { rel: 'use', target: 'claim.md' },
        { rel: 'depends_on', target: 'claim.md' },
      ],
    }),
    pageFacts(at('from'), {
      type: 'concept',
      title: 'From',
      sources,
      relations: [{ rel: 'part_of', target: 'alpha.md' }],
    }),
    pageFacts(at('range'), {
      type: 'concept',
      title: 'Range',
      sources,
      relations: [
        { rel: 'about', target: 'claim.md' },
        { rel: 'about', target: 'no-type.md' },
      ],
    }),
    pageFacts(at('not-url'), {
      type: 'person',
      title: 'Not a URL',
      relations: [{ rel: 'same_as', target: 'alpha.md' }],
    }),
    pageFacts(at('not-page'), {
      type: 'concept',
      title: 'Not a page',
      sources,
      relations: [
        { rel: 'uses', target: 'https://example.com/elsewhere' },
        { rel: 'uses', target: 'gone.md' },
        { rel: 'uses', target: '../index.md' },
      ],
    }),
    pageFacts(at('twice'), {
      type: 'concept',
      title: 'Twice',
      sources,
      relations: [
        { rel: 'uses', target: 'claim.md' },
        { rel: 'uses', target: 'claim.md' },
        { rel: 'uses' },
        'not a relation',
      ],
    }),
    { ...pageFacts(at('broken'), undefined), unreadable: true },
  ];
  const report = checkOntology(declaration, pages);
  assert.deepEqual(
    report.findings.map((finding) => [
      path.posix.basename(finding.path, '.md'),
      finding.kind,
      ...('name' in finding ? [finding.name] : []),
      ...('use' in finding && finding.use ? [finding.use] : []),
      ...('target' in finding ? [finding.target] : []),
      ...('type' in finding ? [finding.type ?? '(none)'] : []),
    ]),
    [
      ['broken', 'unreadable'],
      ['from', 'relation-from', 'part_of', 'concept'],
      ['names', 'relation-undeclared', 'use'],
      ['names', 'relation-undeclared', 'depends_on', 'uses'],
      ['new-name', 'type-undeclared', 'experiment'],
      ['no-sources', 'key-missing', 'sources'],
      ['no-type', 'type-missing'],
      ['not-page', 'relation-not-page', 'uses', 'https://example.com/elsewhere'],
      ['not-page', 'relation-not-page', 'uses', 'gone.md'],
      ['not-page', 'relation-not-page', 'uses', '../index.md'],
      ['not-url', 'relation-not-url', 'same_as', 'alpha.md'],
      ['old-name', 'type-undeclared', 'synthesis', 'concept'],
      ['range', 'relation-target-type', 'about', 'claim.md', 'concept'],
      ['range', 'relation-target-type', 'about', 'no-type.md', '(none)'],
      ['twice', 'relation-repeated', 'uses', 'claim.md'],
      ['twice', 'relation-incomplete'],
      ['twice', 'relation-incomplete'],
    ],
  );
  assert.equal(report.findingCount, report.findings.length);
  assert.equal(report.pages, pages.length);
  assert.deepEqual(
    report.types.map(({ name, pages, required }) => [name, pages, required]),
    [
      ['concept', 8, ['type', 'title', 'sources']],
      ['person', 2, ['type', 'title']],
      ['org', 1, ['type', 'title']],
      ['project', 1, ['type', 'title']],
    ],
  );
  assert.deepEqual(
    report.relations.map(({ name, from, to, uses, findings }) => [name, from, to, uses, findings]),
    [
      ['about', 'any', ['person', 'org', 'project'], 3, 2],
      ['part_of', ['person', 'org', 'project'], ['org', 'project'], 2, 1],
      ['uses', 'any', 'page', 6, 4],
      ['same_as', ['person', 'org', 'project'], 'url', 2, 1],
    ],
  );
  assert.deepEqual(report.undeclaredTypes, [
    { name: 'experiment', count: 1, use: undefined },
    { name: 'synthesis', count: 1, use: 'concept' },
  ]);
  assert.deepEqual(report.undeclaredRelations, [
    { name: 'depends_on', count: 1, use: 'uses' },
    { name: 'use', count: 1, use: undefined },
  ]);
  // The order the pages were met in leaves no trace.
  assert.deepEqual(checkOntology(declaration, [...pages].reverse()), report);
});

test('A long list of findings is counted in full and shown in part', () => {
  const pages = Array.from({ length: findingLimit + 100 }, (_, index) =>
    pageFacts(`Knowledge_Base/wiki/p${String(index).padStart(4, '0')}.md`, { title: 'Untyped' }),
  );
  const report = checkOntology(declaration, pages);
  assert.equal(report.findingCount, findingLimit + 100);
  assert.equal(report.findings.length, findingLimit);
  assert.equal(report.findings[0].path, 'Knowledge_Base/wiki/p0000.md');
});

async function fixture(t: TestContext) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori ontology 日本語 '));
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
  const service = new BundleService(files, new SearchService(files));
  return { root, files, space, write, service };
}

test('The host applies the declaration a knowledge base carries, and writes nothing', async (t) => {
  const { root, space, write, service } = await fixture(t);
  await write('Knowledge_Base/wiki/alpha.md', page({ type: 'project', title: 'Alpha' }));
  await write(
    'Knowledge_Base/wiki/claim.md',
    page({ type: 'concept', title: 'Claim', sources: true }, ['{ rel: about, target: alpha.md }']),
  );
  await write(
    'Knowledge_Base/wiki/typo.md',
    page({ type: 'concept', title: 'Typo', sources: true }, ['{ rel: abuot, target: alpha.md }']),
  );
  await write('Knowledge_Base/wiki/plain.md', '# No frontmatter\n');
  await write('Knowledge_Base/wiki/broken.md', '---\ntitle: [oops\n---\n\nUnreadable.\n');
  // Not pages: a folder index, a hidden folder, Schema and contents.
  await write('Knowledge_Base/wiki/index.md', '# wiki\n');
  await write('Knowledge_Base/.hidden/secret.md', page({ type: 'nothing', title: 'Hidden' }));
  await write('README.md', page({ type: 'nothing', title: 'Outside' }));

  // Without a declaration there is nothing to apply.
  assert.deepEqual(await service.ontology(space.scopeId), { declared: false });
  await write('.property/property.json', '{ "schemaVersion": 1, "types": ');
  const broken = await service.ontology(space.scopeId);
  assert.equal(broken.declared, false);
  assert.match(broken.problem ?? '', /property\.json/);

  await write('.property/property.json', JSON.stringify(vocabulary));
  const listing = async () => (await readdir(root, { recursive: true })).sort();
  const before = await listing();
  const ontology = await service.ontology(space.scopeId);
  assert.equal(ontology.declared, true);
  assert.equal(ontology.indexes, undefined, 'no okf_version, so no folder indexes are offered');
  const report = ontology.report!;
  assert.equal(report.pages, 5);
  assert.deepEqual(
    report.findings.map(({ path: file, kind }) => [path.posix.basename(file), kind]),
    [
      ['broken.md', 'unreadable'],
      ['plain.md', 'type-missing'],
      ['plain.md', 'key-missing'],
      ['typo.md', 'relation-undeclared'],
    ],
  );
  assert.deepEqual(
    report.types.map(({ name, pages }) => [name, pages]),
    [
      ['concept', 2],
      ['person', 0],
      ['org', 0],
      ['project', 1],
    ],
  );
  assert.equal(report.relations.find(({ name }) => name === 'about')!.uses, 1);
  assert.deepEqual(await listing(), before, 'a check writes nothing');

  // The graph index an earlier irori generated is neither read nor written; irori says it is there.
  const former =
    'id,label,note,parentId,group\nwiki/claim,Claim,Knowledge_Base/wiki/claim.md,,concept\n';
  await write('Knowledge_Base/ontology/entities.csv', former);
  await write('Knowledge_Base/ontology/index.md', '# ontology\n');
  const after = await service.ontology(space.scopeId);
  assert.equal(after.formerGraphIndex, 'Knowledge_Base/ontology/');
  assert.equal(after.report!.pages, 5);
  assert.deepEqual(await service.update(space.scopeId), { bundle: false, pages: 0, written: [] });
  assert.equal(
    await readFile(path.join(root, 'Knowledge_Base/ontology/entities.csv'), 'utf8'),
    former,
  );
});

test('A check retries a page it could not read without requiring a file change', async (t) => {
  const { files, space, write, service } = await fixture(t);
  const target = 'Knowledge_Base/wiki/a.md';
  await write('.property/property.json', JSON.stringify(vocabulary));
  await write(target, page({ type: 'project', title: 'A' }));
  const resolve = files.resolve.bind(files);
  let unavailable = true;
  files.resolve = async (id, relative, allowRoot) => {
    if (relative === target && unavailable) throw Error('Temporary read failure');
    return resolve(id, relative, allowRoot);
  };
  const failed = (await service.ontology(space.scopeId)).report!;
  assert.deepEqual(
    failed.findings.map(({ kind }) => kind),
    ['unreadable'],
  );
  unavailable = false;
  const recovered = (await service.ontology(space.scopeId)).report!;
  assert.equal(recovered.findingCount, 0);
  assert.equal(recovered.types.find(({ name }) => name === 'project')!.pages, 1);
});

test('A new page of a declared type follows the declaration from its first save', async (t) => {
  const { root, files, space, write, service } = await fixture(t);
  await write('.property/property.json', JSON.stringify(vocabulary));
  const git = { userEmail: async () => 'mika@example.invalid' };
  const created = await createTypedNote(
    files,
    git,
    space.scopeId,
    '案件 A',
    'Knowledge_Base/wiki',
    'project',
  );
  assert.equal(created.path, 'Knowledge_Base/wiki/案件 A.md');
  assert.equal(
    await readFile(path.join(root, created.path), 'utf8'),
    '---\ntype: project\ntitle: 案件 A\n---\n\n',
  );
  // A concept must carry sources: the key is there, empty, and the check says so.
  await createTypedNote(files, git, space.scopeId, 'Claim', 'Knowledge_Base/wiki', 'concept');
  assert.equal(
    await readFile(path.join(root, 'Knowledge_Base/wiki/Claim.md'), 'utf8'),
    '---\ntype: concept\ntitle: Claim\nsources: []\n---\n\n',
  );
  assert.deepEqual(
    (await service.ontology(space.scopeId)).report!.findings.map(({ path: file, kind }) => [
      path.posix.basename(file),
      kind,
    ]),
    [['Claim.md', 'key-missing']],
  );
  // A type the knowledge base does not declare is refused, and an existing page is never replaced.
  await assert.rejects(
    createTypedNote(files, git, space.scopeId, 'X', 'Knowledge_Base/wiki', 'experiment'),
    /experiment/,
  );
  await assert.rejects(
    createTypedNote(files, git, space.scopeId, 'Claim', 'Knowledge_Base/wiki', 'concept'),
  );
});

test('A relation target is written as the link that leads back to the page', () => {
  for (const [from, target, link] of [
    ['wiki/a.md', 'wiki/b.md', 'b.md'],
    ['wiki/a.md', 'wiki/deep/b.md', 'deep/b.md'],
    ['wiki/deep/a.md', 'wiki/b.md', '../b.md'],
    ['journal/2026/a.md', 'wiki/案件 A.md', '../../wiki/案件 A.md'],
    ['a.md', 'wiki/b.md', 'wiki/b.md'],
    ['wiki/a.md', 'b.md', '../b.md'],
    ['wiki/a.md', 'wiki/100% #1?.md', '100%25 %231%3F.md'],
    ['a.md', 'note: draft.md', './note: draft.md'],
  ] as const) {
    assert.equal(linkTo(from, target), link, `${from} to ${target}`);
    assert.deepEqual(resolveNoteLink(from, link), { kind: 'internal', path: target }, link);
  }
});

test('The pages a relation can point at are listed with their titles and types', async (t) => {
  const { space, write, service } = await fixture(t);
  await write('.property/property.json', JSON.stringify(vocabulary));
  await write('Knowledge_Base/wiki/b.md', page({ type: 'project', title: 'Beta' }));
  await write('Knowledge_Base/wiki/a.md', page({ type: 'org', title: 'Acme' }));
  await write(`Knowledge_Base/wiki/${'ガ.md'.normalize('NFD')}`, '# No frontmatter\n');
  await write('Knowledge_Base/wiki/index.md', '# wiki\n');
  assert.deepEqual(await service.pages(space.scopeId), [
    { path: 'Knowledge_Base/wiki/a.md', title: 'Acme', type: 'org' },
    { path: 'Knowledge_Base/wiki/b.md', title: 'Beta', type: 'project' },
    // The path as it is on disk, so the link written from it opens the file that is there.
    { path: `Knowledge_Base/wiki/${'ガ.md'.normalize('NFD')}`, title: undefined, type: undefined },
  ]);
});
