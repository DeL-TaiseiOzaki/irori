import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { draftFile, FileService } from '../src/host/files';
import { SearchService } from '../src/host/search';
import { GraphIndexService } from '../src/host/graph-index';
import { renameLayerFolder } from '../src/host/layer-folders';
import { AuthorshipStore } from '../src/knowledge/authorship';
import { addNoteComment, readNoteComments } from '../src/host/comments';
import { noteDirectory } from '../src/host/notes';
import { classify } from '../src/domain/scopes';
import { layerFolderProblem, layerLabel } from '../src/domain/layers';
import { hostArguments } from '../src/domain/host-requests';
import { connectedFixture, connectionName } from './fixtures/cloud';

async function fixture(t: TestContext) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori layer names '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const root = path.join(base, 'KB');
  await mkdir(root);
  const space = await files.register(root, 'Layers', 'personal');
  const write = async (relative: string, text: string) => {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
  };
  const read = (relative: string) => readFile(path.join(root, relative), 'utf8');
  const meta = async () => JSON.parse(await read('.irori/scope.json'));
  return { base, root, files, id: space.scopeId, write, read, meta };
}

const git = { userEmail: async () => 'person@example.com' };

test('Layer names are kept in scope.json, and an empty one returns to irori’s', async (t) => {
  const { files, id, meta } = await fixture(t);
  assert.equal(layerLabel(files.get(id), 'Knowledge_Base'), 'Knowledge');
  const named = await files.update(id, { labels: { Knowledge_Base: ' 知識 ', contents: '資料' } });
  assert.equal(layerLabel(named, 'Knowledge_Base'), '知識');
  assert.equal(layerLabel(named, 'contents'), '資料');
  // Schema keeps its name whatever the declaration says.
  assert.equal(layerLabel(named, 'schema'), 'Schema');
  assert.deepEqual((await meta()).labels, { Knowledge_Base: '知識', contents: '資料' });
  const cleared = await files.update(id, { labels: { Knowledge_Base: '' } });
  assert.equal(layerLabel(cleared, 'Knowledge_Base'), 'Knowledge');
  assert.deepEqual((await meta()).labels, { contents: '資料' });
  await files.update(id, { labels: null });
  assert.equal('labels' in (await meta()), false);
});

test('Renaming the knowledge folder moves it and carries links, comments, drafts and note places', async (t) => {
  const { files, id, write, read, meta, root } = await fixture(t);
  await write('Knowledge_Base/wiki/a.md', '# A\n\n[B](b.md) [top](../../index.md)\n');
  await write(
    'Knowledge_Base/wiki/b.md',
    '---\nsources:\n  - resource: Knowledge_Base/wiki/a.md\n---\n# B\n',
  );
  await write(
    'Knowledge_Base/c.md',
    '---\nsources:\n  - resource: Knowledge_Base/wiki/a.md\n---\n# C\n',
  );
  await write('index.md', '# Index\n\n- [A](Knowledge_Base/wiki/a.md)\n');
  await write('.agents/skills/use/SKILL.md', 'Apply [A](../../../Knowledge_Base/wiki/a.md).\n');
  await write(
    '.irori/notes.json',
    JSON.stringify({ schemaVersion: 1, newNoteDirectory: 'Knowledge_Base/Inbox' }),
  );
  await addNoteComment(files, git, id, 'Knowledge_Base/wiki/a.md', { body: 'Check this' });
  const draft = await files.read(id, 'Knowledge_Base/wiki/b.md');
  await files.draft({ ...draft, text: draft.text + 'unsaved\n' });

  const result = await renameLayerFolder({ files }, id, 'Knowledge_Base', '知識');
  assert.equal(result.previous, 'Knowledge_Base');
  assert.equal(result.notice, undefined);
  assert.equal((await meta()).knowledge, '知識');
  await assert.rejects(lstat(path.join(root, 'Knowledge_Base')));
  // Links into the folder follow it; links inside it and out of it already worked.
  assert.equal(await read('index.md'), '# Index\n\n- [A](知識/wiki/a.md)\n');
  assert.equal(await read('.agents/skills/use/SKILL.md'), 'Apply [A](../../../知識/wiki/a.md).\n');
  assert.equal(await read('知識/wiki/a.md'), '# A\n\n[B](b.md) [top](../../index.md)\n');
  // A source path written from the repository root stays one.
  assert.equal(await read('知識/c.md'), '---\nsources:\n  - resource: 知識/wiki/a.md\n---\n# C\n');
  // The page holds unsaved text, so its rooted source is left for the person.
  assert.deepEqual(result.skipped, ['知識/wiki/b.md']);
  assert.equal((await files.read(id, '知識/wiki/b.md')).draft?.text, draft.text + 'unsaved\n');
  assert.deepEqual(
    (await readNoteComments(files, id, '知識/wiki/a.md')).map((c) => c.body),
    ['Check this'],
  );
  assert.equal(JSON.parse(await read('.irori/notes.json')).newNoteDirectory, '知識/Inbox');
  assert.equal(await noteDirectory(files, id), '知識/Inbox');

  // Back to irori's name: the declaration no longer names one.
  await files.save({ ...(await files.read(id, '知識/wiki/b.md')), draft: undefined });
  const back = await renameLayerFolder({ files }, id, 'Knowledge_Base', 'Knowledge_Base');
  assert.equal(back.notes, 3);
  assert.equal('knowledge' in (await meta()), false);
  assert.match(await read('Knowledge_Base/c.md'), /resource: Knowledge_Base\/wiki\/a\.md/);
});

test('Without a declared note place, new notes go to Notes in the knowledge folder', async (t) => {
  const { files, id } = await fixture(t);
  assert.equal(await noteDirectory(files, id), 'Knowledge_Base/Notes');
  await renameLayerFolder({ files }, id, 'Knowledge_Base', 'wiki');
  assert.equal(await noteDirectory(files, id), 'wiki/Notes');
});

test('A folder not there yet is renamed in the declaration alone, naming one the KB has', async (t) => {
  const { files, id, write, meta } = await fixture(t);
  await write('Vault/page.md', '# Page\n');
  const result = await renameLayerFolder({ files }, id, 'Knowledge_Base', 'Vault');
  assert.equal(result.space.knowledge, 'Vault');
  assert.equal((await meta()).knowledge, 'Vault');
  assert.equal((await files.read(id, 'Vault/page.md')).text, '# Page\n');
});

test('A layer folder name must be free, ordinary and not another layer’s', async (t) => {
  const { files, id, write, meta } = await fixture(t);
  await write('Knowledge_Base/a.md', '# A\n');
  await write('taken/b.md', '# B\n');
  for (const name of ['schema', '.hidden', 'a/b', 'AGENTS.md', 'README.md', 'trailing.', ''])
    assert(layerFolderProblem(name), name);
  await assert.rejects(files.renameLayerFolder(id, 'Knowledge_Base', 'schema'));
  await assert.rejects(
    files.renameLayerFolder(id, 'Knowledge_Base', 'taken'),
    /既にあります|already exists/,
  );
  await assert.rejects(
    files.renameLayerFolder(id, 'Knowledge_Base', 'contents'),
    /別の層|another layer/,
  );
  await assert.rejects(
    files.renameLayerFolder(id, 'contents', 'Knowledge_Base'),
    /別の層|another layer/,
  );
  assert.equal('knowledge' in (await meta()), false);
  assert.deepEqual((await meta()).contents, ['contents']);
  assert.throws(() => hostArguments.renameLayerFolder.parse([id, 'schema', 'x']));
  assert.throws(() => hostArguments.renameLayerFolder.parse([id, 'contents', '../out']));
  assert.throws(() =>
    hostArguments.updateSpace.parse([id, { labels: { Knowledge_Base: 'x'.repeat(41) } }]),
  );
});

test('Renaming contents keeps its connected folders, their records and the ignore line', async (t) => {
  const { files, space, cloud, target } = await connectedFixture(t);
  const id = space.scopeId;
  await writeFile(path.join(target, 'paper.md'), '# Paper\n');
  await mkdir(path.join(space.root, 'Knowledge_Base'), { recursive: true });
  await writeFile(
    path.join(space.root, 'Knowledge_Base', 'note.md'),
    `---\nsources:\n  - resource: contents/${connectionName}/paper.md\n---\n# Note\n`,
  );
  const result = await renameLayerFolder({ files, cloud }, id, 'contents', '資料');
  assert.equal(result.notice, undefined);
  assert.deepEqual(files.get(id).contents, ['資料']);
  const entry = path.join(space.root, '資料', connectionName);
  assert((await lstat(entry)).isSymbolicLink());
  assert.equal(await readlink(entry), target);
  assert.deepEqual(cloud.linkedPaths(id), [`資料/${connectionName}`]);
  const records = JSON.parse(
    await readFile(path.join(space.root, '.irori', 'local-folders.json'), 'utf8'),
  );
  assert.equal(records[0].contentsRoot, '資料');
  // The previous line stays for a device whose folder has the old name.
  const ignore = (await readFile(path.join(space.root, '.gitignore'), 'utf8')).split('\n');
  assert(ignore.includes('/contents/') && ignore.includes('/資料/'));
  assert.equal(classify(files.get(id), `資料/${connectionName}/paper.md`), 'contents');
  assert.equal(
    (await files.read(id, `資料/${connectionName}/paper.md`)).text.replace(/\r\n/g, '\n'),
    '# Paper\n',
  );
  assert.match(
    await readFile(path.join(space.root, 'Knowledge_Base', 'note.md'), 'utf8'),
    new RegExp(`resource: "?資料/${connectionName}/paper\\.md`),
  );
});

test('The graph index lives in the knowledge folder the hibachi names', async (t) => {
  const { files, id, write, read } = await fixture(t);
  await write(
    'Knowledge_Base/a.md',
    '---\ntype: concept\nrelations:\n  - { rel: uses, target: b.md }\n---\n',
  );
  await write('Knowledge_Base/b.md', '---\ntype: concept\n---\n');
  await renameLayerFolder({ files }, id, 'Knowledge_Base', 'wiki');
  const service = new GraphIndexService(files, new SearchService(files));
  const update = await service.update(id);
  assert.deepEqual(update.written.sort(), [
    'wiki/ontology/entities.csv',
    'wiki/ontology/index.md',
    'wiki/ontology/relations.csv',
  ]);
  assert.match(await read('wiki/ontology/entities.csv'), /^a,a,wiki\/a\.md,,concept$/m);
  assert.match(await read('wiki/ontology/index.md'), /inside `wiki\/`/);
  assert.equal((await service.status(id)).current, true);
});

test('Drafts of moved knowledge files are kept under their new paths', async (t) => {
  const { files, id, write, base } = await fixture(t);
  await write('Knowledge_Base/x.md', '# X\n');
  const doc = await files.read(id, 'Knowledge_Base/x.md');
  await files.draft({ ...doc, text: '# X edited\n' });
  await files.renameLayerFolder(id, 'Knowledge_Base', 'notes');
  await assert.rejects(lstat(draftFile(path.join(base, 'device'), id, 'Knowledge_Base/x.md')));
  assert.equal((await files.read(id, 'notes/x.md')).draft?.text, '# X edited\n');
});

test('The person’s lines of a moved page stay theirs on this device', async (t) => {
  const { files, id, write, base } = await fixture(t);
  await write('Knowledge_Base/p.md', '# P\n');
  const authorship = new AuthorshipStore(path.join(base, 'device'));
  await authorship.observe({ scopeId: id, path: 'Knowledge_Base/p.md' }, '# P\nmine\n', '# P\n');
  await write('Knowledge_Base/p.md', '# P\nmine\n');
  await renameLayerFolder({ files, authorship }, id, 'Knowledge_Base', 'wiki');
  const view = await authorship.view({ scopeId: id, path: 'wiki/p.md' }, '# P\nmine\n');
  assert.equal(view.lines.filter(Boolean).length, 1);
});
