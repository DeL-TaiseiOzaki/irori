import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { FileService } from '../src/host/files';
import { SearchService } from '../src/host/search';
import { GraphIndexService } from '../src/host/graph-index';
import { renameLayerFolder } from '../src/host/layer-folders';
import { addNoteComment, readNoteComments } from '../src/host/comments';
import { noteDirectory } from '../src/host/notes';
import { classify } from '../src/domain/scopes';
import { knowledgeFolder, layerRoots, movedPath } from '../src/domain/layers';
import { bundlePage, pageId } from '../src/domain/graph-index';
import { hostArguments } from '../src/domain/host-requests';

async function fixture(t: TestContext, name = 'KB') {
  const base = await mkdtemp(path.join(tmpdir(), 'irori knowledge root '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const root = path.join(base, name);
  await mkdir(root);
  const write = async (relative: string, text: string) => {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
  };
  const read = (relative: string) => readFile(path.join(root, relative), 'utf8');
  const exists = (relative: string) => lstat(path.join(root, relative)).then(Boolean, () => false);
  const meta = async () => JSON.parse(await read('.irori/scope.json'));
  return { base, root, files, write, read, exists, meta };
}

const git = { userEmail: async () => 'person@example.com' };
const okf = '---\nokf_version: "0.2"\n---\n';

test('The vault’s root is a knowledge folder of its own, `.` in the declaration', () => {
  const space = { knowledge: '.', contents: ['contents'] };
  assert.equal(knowledgeFolder(space), '');
  assert.deepEqual(layerRoots(space), ['contents']);
  assert.equal(classify(space, 'wiki/a.md'), 'Knowledge_Base');
  assert.equal(classify(space, 'index.md'), 'Knowledge_Base');
  assert.equal(classify(space, 'README.md'), 'schema');
  assert.equal(classify(space, 'AGENTS.md'), 'schema');
  assert.equal(classify(space, 'contents/drive/a.md'), 'contents');
  // The bundle's pages are every Markdown file but Schema's and the indexes.
  assert(bundlePage('wiki/a.md', ''));
  assert(!bundlePage('AGENTS.md', ''));
  assert(!bundlePage('readme.md', ''));
  assert(!bundlePage('index.md', ''));
  assert(!bundlePage('ontology/x.md', ''));
  assert.equal(pageId('wiki/a.md', ''), 'wiki/a');
  // Moves to and from the root name the entries that moved.
  const up = { from: 'Knowledge_Base', to: '', entries: ['wiki', 'index.md'] };
  assert.equal(movedPath(up, 'Knowledge_Base/wiki/a.md'), 'wiki/a.md');
  assert.equal(movedPath(up, 'AGENTS.md'), undefined);
  const down = { from: '', to: 'Knowledge_Base', entries: ['wiki', 'index.md'] };
  assert.equal(movedPath(down, 'wiki/a.md'), 'Knowledge_Base/wiki/a.md');
  assert.equal(movedPath(down, 'index.md'), 'Knowledge_Base/index.md');
  assert.equal(movedPath(down, 'AGENTS.md'), undefined);
  assert.equal(movedPath(down, 'wikis/a.md'), undefined);
  // Only the knowledge folder may be the root.
  const id = '00000000-0000-4000-8000-000000000000';
  assert.doesNotThrow(() => hostArguments.renameLayerFolder.parse([id, 'Knowledge_Base', '.']));
  assert.throws(() => hostArguments.renameLayerFolder.parse([id, 'Knowledge_Base', '..']));
});

test('Knowledge moves to the vault’s root and back, carrying links, comments, drafts and note places', async (t) => {
  const { files, write, read, exists, meta, root } = await fixture(t);
  const id = (await files.register(root, 'Root', 'personal')).scopeId;
  await write('Knowledge_Base/index.md', `${okf}\n# Folders\n\n* [wiki](wiki/)\n`);
  const a =
    '# A\n\n[B](b.md) [paper](../../contents/drive/paper.pdf) [contract](../../AGENTS.md)\n';
  await write('Knowledge_Base/wiki/a.md', a);
  await write(
    'Knowledge_Base/wiki/b.md',
    '---\nsources:\n  - resource: Knowledge_Base/wiki/a.md\n  - resource: contents/drive/paper.pdf\n---\n# B\n',
  );
  await write('Knowledge_Base/journal/d.md', '# D\n');
  await write('Knowledge_Base/.DS_Store', 'look');
  const agents = 'Read [the index](Knowledge_Base/index.md) and [A](Knowledge_Base/wiki/a.md).\n';
  await write('AGENTS.md', agents);
  await write('README.md', '# Root\n');
  await write('.agents/skills/use/SKILL.md', 'Apply [A](../../../Knowledge_Base/wiki/a.md).\n');
  const notes = {
    schemaVersion: 1,
    newNoteDirectory: 'Knowledge_Base/journal',
    daily: { path: 'Knowledge_Base/journal/{{date}}.md', template: '.irori/templates/daily.md' },
  };
  await write('.irori/notes.json', JSON.stringify(notes));
  await addNoteComment(files, git, id, 'Knowledge_Base/wiki/a.md', { body: 'On A' });
  await addNoteComment(files, git, id, 'Knowledge_Base/index.md', { body: 'On the index' });
  const draft = await files.read(id, 'Knowledge_Base/journal/d.md');
  await files.draft({ ...draft, text: '# D\nunsaved\n' });

  const up = await renameLayerFolder({ files }, id, 'Knowledge_Base', '.');
  assert.equal(up.previous, 'Knowledge_Base');
  assert.deepEqual(up.entries?.sort(), ['index.md', 'journal', 'wiki']);
  assert.equal(up.notice, undefined);
  assert.equal((await meta()).knowledge, '.');
  assert.equal(knowledgeFolder(files.get(id)), '');
  assert.equal(await exists('Knowledge_Base'), false);
  assert.equal(await read('index.md'), `${okf}\n# Folders\n\n* [wiki](wiki/)\n`);
  // Links into the folder lose its name; a moved page's links out keep their targets.
  assert.equal(await read('AGENTS.md'), 'Read [the index](index.md) and [A](wiki/a.md).\n');
  assert.equal(await read('.agents/skills/use/SKILL.md'), 'Apply [A](../../../wiki/a.md).\n');
  assert.equal(
    await read('wiki/a.md'),
    '# A\n\n[B](b.md) [paper](../contents/drive/paper.pdf) [contract](../AGENTS.md)\n',
  );
  // A source rooted in the old folder now reads from its page; one in contents stays rooted.
  assert.equal(
    await read('wiki/b.md'),
    '---\nsources:\n  - resource: a.md\n  - resource: contents/drive/paper.pdf\n---\n# B\n',
  );
  assert.deepEqual(up.skipped, ['journal/d.md']);
  assert.equal((await files.read(id, 'journal/d.md')).draft?.text, '# D\nunsaved\n');
  assert.deepEqual(
    (await readNoteComments(files, id, 'wiki/a.md')).map((c) => c.body),
    ['On A'],
  );
  assert.deepEqual(
    (await readNoteComments(files, id, 'index.md')).map((c) => c.body),
    ['On the index'],
  );
  assert.deepEqual(JSON.parse(await read('.irori/notes.json')), {
    ...notes,
    newNoteDirectory: 'journal',
    daily: { ...notes.daily, path: 'journal/{{date}}.md' },
  });
  assert.equal(await noteDirectory(files, id), 'journal');

  // Back into a named folder: the knowledge entries go, Schema stays.
  const kept = await files.read(id, 'journal/d.md');
  await files.save({ ...kept, text: kept.draft!.text, draft: undefined });
  const down = await renameLayerFolder({ files }, id, 'Knowledge_Base', 'Knowledge_Base');
  assert.equal(down.previous, '');
  assert.deepEqual(down.entries?.sort(), ['index.md', 'journal', 'wiki']);
  assert.equal('knowledge' in (await meta()), false);
  assert.equal(await read('AGENTS.md'), agents);
  assert.equal(await read('README.md'), '# Root\n');
  assert.equal(await read('Knowledge_Base/wiki/a.md'), a);
  assert.equal(await read('Knowledge_Base/journal/d.md'), '# D\nunsaved\n');
  assert.deepEqual(
    (await readNoteComments(files, id, 'Knowledge_Base/index.md')).map((c) => c.body),
    ['On the index'],
  );
  assert.equal(await noteDirectory(files, id), 'Knowledge_Base/journal');
});

test('A move to the root stops before anything moves when a name is taken there', async (t) => {
  const { files, write, exists, meta, root } = await fixture(t);
  const id = (await files.register(root, 'Root', 'personal')).scopeId;
  await write('Knowledge_Base/wiki/a.md', '# A\n');
  await write('Knowledge_Base/notes.md', '# Notes\n');
  await write('Knowledge_Base/README.md', '# A page about the folder\n');
  await write('wiki/old.md', '# Old\n');
  const refused = await files.renameLayerFolder(id, 'Knowledge_Base', '.').then(
    () => '',
    (error: Error) => error.message,
  );
  assert.match(refused, /README\.md/);
  assert.match(refused, /wiki/);
  assert.equal('knowledge' in (await meta()), false);
  assert(await exists('Knowledge_Base/notes.md'));
  assert.equal(await exists('notes.md'), false);
  // The root is for knowledge only.
  await assert.rejects(files.renameLayerFolder(id, 'contents', '.'));
});

test('From the root, an existing folder is taken as it is', async (t) => {
  const { files, write, read, meta, root } = await fixture(t);
  await write('index.md', `${okf}\n# Folders\n`);
  const id = (await files.register(root, 'Root', 'personal')).scopeId;
  await write('wiki/a.md', '# A\n');
  await write('journal/b.md', '# B\n');
  const result = await renameLayerFolder({ files }, id, 'Knowledge_Base', 'wiki');
  assert.deepEqual(result.entries, []);
  assert.equal((await meta()).knowledge, 'wiki');
  assert.equal(await read('journal/b.md'), '# B\n');
});

test('A folder registered with its OKF bundle at the root keeps knowledge there, and its indexes too', async (t) => {
  const { files, write, read, root } = await fixture(t, 'ysai-kb');
  await write('.git/HEAD', 'ref: refs/heads/main\n');
  await write(
    '.property/property.json',
    JSON.stringify({
      schemaVersion: 1,
      properties: {},
      types: { concept: { heading: '# Concepts' }, journal: { heading: '# Entries' } },
    }),
  );
  await write('AGENTS.md', '# Contract\n');
  await write('README.md', '# ysai-kb\n');
  await write('index.md', `${okf}\n# Folders\n\n* [wiki](wiki/) - What we know\n`);
  await write(
    'wiki/a.md',
    '---\ntype: concept\ntitle: A\nrelations:\n  - { rel: uses, target: b.md }\n---\n',
  );
  await write('wiki/b.md', '---\ntype: concept\ntitle: B\ndescription: The other\n---\n');
  await write('journal/2026/d.md', '---\ntype: journal\ntitle: D\n---\n');
  await write('contents/drive/c.md', '---\ntype: concept\ntitle: Not knowledge\n---\n');
  const space = await files.register(root, 'ysai-kb', 'personal');
  assert.equal(space.knowledge, '.');
  assert.equal(JSON.parse(await read('.irori/scope.json')).knowledge, '.');
  assert.equal(await noteDirectory(files, space.scopeId), 'Notes');

  const service = new GraphIndexService(files, new SearchService(files));
  const update = await service.update(space.scopeId);
  assert.deepEqual(update.written.sort(), [
    'index.md',
    'journal/2026/index.md',
    'journal/index.md',
    'ontology/entities.csv',
    'ontology/index.md',
    'ontology/relations.csv',
    'wiki/index.md',
  ]);
  assert.equal(update.pages, 3);
  assert.equal(
    await read('ontology/entities.csv'),
    'id,label,note,parentId,group\nwiki/a,A,wiki/a.md,,concept\nwiki/b,B,wiki/b.md,,concept\n',
  );
  assert.match(await read('ontology/index.md'), /path from the repository root without/);
  // The root index lists knowledge folders only, and keeps its frontmatter.
  assert.equal(
    await read('index.md'),
    `${okf}\n# Folders\n\n* [journal](journal/)\n* [wiki](wiki/) - What we know\n`,
  );
  assert.equal(await read('wiki/index.md'), '# Concepts\n\n* [A](a.md)\n* [B](b.md) - The other\n');
  const status = await service.status(space.scopeId);
  assert.equal(status.current, true);
  assert.deepEqual(status.indexes, { folders: 4, added: 0, changed: 0 });
});

test('A pulled declaration may name the root as the knowledge folder', async (t) => {
  const { files, root, meta } = await fixture(t);
  const space = await files.register(root, 'Root', 'personal');
  const incoming = JSON.stringify({ ...(await meta()), knowledge: '.' });
  assert.equal(await files.incomingDeclarationProblem(space.scopeId, incoming), undefined);
  const outside = JSON.stringify({ ...(await meta()), knowledge: '..' });
  assert.equal(
    await files.incomingDeclarationProblem(space.scopeId, outside),
    'The incoming declaration does not parse',
  );
});
