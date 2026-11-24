import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { classify, ownContents, ownLayer } from '../src/domain/scopes';
import { connectedFixture, connectionName, fixture } from './fixtures/cloud';

/** A repository of code registered as a vault of Schema and Contents (ADR 071). */
async function workspace(t: TestContext) {
  const value = await fixture(t);
  const { files, space } = value;
  const write = async (relative: string, text: string) => {
    const file = path.join(space.root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
  };
  await write('AGENTS.md', '# Dev\n');
  await write('.github/workflows/ci.yml', 'on: push\n');
  await write('package.json', '{}\n');
  await write('src/main.ts', 'export const main = 1;\n');
  await files.update(space.scopeId, { layers: ['contents'] });
  const read = (relative: string) => readFile(path.join(space.root, relative), 'utf8');
  return { ...value, id: space.scopeId, write, read };
}

test('The layer of a vault’s own files follows its layers and its choice', () => {
  const base = { contents: ['contents'] };
  assert.equal(ownLayer(base), 'Knowledge_Base');
  assert.equal(ownLayer({ ...base, layers: ['contents'] }), 'contents');
  assert.equal(ownLayer({ ...base, layers: ['Knowledge_Base'] }), 'Knowledge_Base');
  assert.equal(ownLayer({ ...base, layers: [] }), 'schema');
  // The choice counts only beside a named Knowledge folder.
  const both = { ...base, rootLayer: 'contents' as const };
  assert.equal(ownLayer(both), 'contents');
  assert.equal(ownLayer({ ...both, knowledge: '.' }), 'Knowledge_Base');
  assert.equal(ownLayer({ ...both, layers: ['Knowledge_Base'] }), 'Knowledge_Base');
  assert.equal(classify(both, 'Knowledge_Base/Notes/idea.md'), 'Knowledge_Base');
  assert.equal(classify({ ...both, knowledge: 'wiki' }, 'wiki/page.md'), 'Knowledge_Base');
  assert.equal(classify({ ...both, knowledge: 'wiki' }, 'wikipedia/page.md'), 'contents');
  assert.equal(classify(both, 'src/main.ts'), 'contents');
  assert.equal(classify(both, 'AGENTS.md'), 'schema');
  assert.equal(ownContents(both, 'src/main.ts'), true);
  // What a contents folder holds is connected, not the vault's own.
  assert.equal(ownContents(both, 'contents/repo/main.ts'), false);
  assert.equal(ownContents(base, 'src/main.ts'), false);
});

test('A vault’s own files in Contents are listed, opened and saved in place', async (t) => {
  const { files, id, read } = await workspace(t);
  const top = await files.entries(id, '');
  const entry = (name: string) => top.find((item) => item.path === name);
  assert.deepEqual(
    [entry('src')?.layer, entry('src')?.writable, entry('src')?.blocked],
    ['contents', true, undefined],
  );
  assert.equal(entry('package.json')?.layer, 'contents');
  assert.equal(entry('AGENTS.md')?.layer, 'schema');
  assert.equal(entry('.github')?.layer, 'schema');
  // The contents folder is still where connections go.
  assert.equal(entry('contents')?.layer, 'contents');
  const inside = await files.entries(id, 'src');
  assert.deepEqual(
    inside.map((item) => [item.path, item.layer, item.writable]),
    [['src/main.ts', 'contents', true]],
  );

  const doc = await files.read(id, 'src/main.ts');
  assert.equal(doc.readOnly, false);
  assert.equal(doc.text, 'export const main = 1;\n');
  const saved = await files.save({ ...doc, text: 'export const main = 2;\n' });
  assert.equal(saved.text, 'export const main = 2;\n');
  assert.equal(await read('src/main.ts'), 'export const main = 2;\n');
  // A stale save is refused, as in a connected folder.
  await assert.rejects(files.save({ ...doc, text: 'export const main = 3;\n' }), /CONFLICT/);
});

test('The vault’s own files take new entries, move and go to the trash, and stay its own', async (t) => {
  const { files, cloud, id, read, trashed, space } = await workspace(t);
  // At the top of the vault and inside one of its folders.
  assert.equal((await cloud.createEntry(id, '', { kind: 'folder', name: 'docs' })).path, 'docs');
  const plan = await cloud.createEntry(id, 'docs', {
    kind: 'file',
    name: 'plan.md',
    bytes: new TextEncoder().encode('# Plan\n'),
  });
  assert.deepEqual([plan.path, plan.layer, plan.writable], ['docs/plan.md', 'contents', true]);
  assert.equal((await cloud.createNote(id, '', 'Changelog')).path, 'Changelog.md');
  assert.equal(await read('Changelog.md'), '# Changelog\n\n');
  // A hidden name at the top would be Schema, not one of the vault's own files.
  await assert.rejects(
    cloud.createEntry(id, '', { kind: 'file', name: '.env' }),
    /out of the vault's own Contents files|Contents のファイルではなくなります/,
  );

  assert.equal((await cloud.moveEntry(id, 'docs/plan.md', 'src/plan.md')).path, 'src/plan.md');
  assert.equal(await read('src/plan.md'), '# Plan\n');
  assert.equal((await cloud.moveEntry(id, 'src/plan.md', 'plan.md')).path, 'plan.md');
  // Not into the contents folder, nor under a name that is Schema.
  await assert.rejects(
    cloud.moveEntry(id, 'plan.md', 'contents/plan.md'),
    /out of the vault's own Contents files|Contents のファイルではなくなります/,
  );
  await assert.rejects(
    cloud.moveEntry(id, 'plan.md', '.plan.md'),
    /out of the vault's own Contents files|Contents のファイルではなくなります/,
  );
  // Schema is not reached through these operations.
  await assert.rejects(cloud.moveEntry(id, 'AGENTS.md', 'docs/AGENTS.md'));
  await assert.rejects(cloud.deleteEntry(id, '.github'));
  assert.equal(await read('AGENTS.md'), '# Dev\n');

  await cloud.deleteEntry(id, 'plan.md');
  assert.deepEqual(trashed, [path.join(space.root, 'plan.md')]);
  await assert.rejects(stat(path.join(space.root, 'plan.md')));
  assert.equal(
    (await files.entries(id, '')).some((item) => item.path === 'plan.md'),
    false,
  );
});

test('A folder of the vault’s own goes nowhere with another vault in it, and links are not followed', async (t) => {
  const { files, cloud, id, space, base, write } = await workspace(t);
  await write('packages/app/index.ts', 'export {};\n');
  const nested = path.join(space.root, 'packages', 'inner');
  await mkdir(nested);
  await files.register(nested, 'Inner', 'personal');
  await assert.rejects(cloud.deleteEntry(id, 'packages'), /another vault|別の vault/);
  await assert.rejects(cloud.moveEntry(id, 'packages', 'pkgs'), /another vault|別の vault/);
  // The other vault's files are its own.
  await assert.rejects(
    cloud.createEntry(id, 'packages/inner', { kind: 'folder', name: 'x' }),
    /未接続|not connected/,
  );
  assert.equal((await cloud.moveEntry(id, 'packages/app', 'packages/web')).path, 'packages/web');

  const outside = path.join(base, 'Outside');
  await mkdir(outside);
  await writeFile(path.join(outside, 'secret.txt'), 'secret\n');
  await symlink(outside, path.join(space.root, 'linked'));
  await assert.rejects(cloud.document(id, 'linked/secret.txt'));
  await assert.rejects(
    cloud.createEntry(id, 'linked', { kind: 'file', name: 'new.txt' }),
    /alias|リンク/,
  );
});

test('Own files in Contents beside a Knowledge folder; connections keep their rules', async (t) => {
  const { files, cloud, space, target } = await connectedFixture(t, { writable: true });
  const id = space.scopeId;
  await files.createNote(id, 'Idea');

  // The root as the knowledge folder leaves none of the vault's own files for Contents.
  await files.renameLayerFolder(id, 'Knowledge_Base', '.');
  await assert.rejects(
    files.update(id, { rootLayer: 'contents' }),
    /Give the Knowledge folder a name|名前を付けて/,
  );
  await files.renameLayerFolder(id, 'Knowledge_Base', 'wiki');
  // Made after the folder has its name: naming it takes the root's knowledge entries along.
  await mkdir(path.join(space.root, 'src'));
  await writeFile(path.join(space.root, 'src', 'main.ts'), 'export {};\n');

  const both = await files.update(id, { rootLayer: 'contents' });
  assert.equal(both.rootLayer, 'contents');
  const top = await files.entries(id, '');
  assert.equal(top.find((item) => item.path === 'src')?.layer, 'contents');
  assert.equal(top.find((item) => item.path === 'wiki')?.layer, 'Knowledge_Base');
  // Notes are still made in the knowledge folder, and the root cannot become it.
  assert.equal((await files.createNote(id, 'Again', 'wiki/Notes')).path, 'wiki/Notes/Again.md');
  // Outside the knowledge folder there is no place for a note.
  await assert.rejects(files.createNote(id, 'Stray', 'src'));
  await assert.rejects(
    files.renameLayerFolder(id, 'Knowledge_Base', '.'),
    /cannot be the Knowledge folder while|フォルダにできません/,
  );
  // A knowledge page is not one of the vault's own Contents files.
  await assert.rejects(cloud.moveEntry(id, 'wiki/Notes/Again.md', 'src/Again.md'));
  await assert.rejects(
    cloud.moveEntry(id, 'src/main.ts', 'wiki/main.ts'),
    /out of the vault's own Contents files|Contents のファイルではなくなります/,
  );

  // A connected folder's files stay inside it, and the vault's own stay out of it.
  await writeFile(path.join(target, 'paper.md'), '# Paper\n');
  await assert.rejects(
    cloud.moveEntry(id, `contents/${connectionName}/paper.md`, 'src/paper.md'),
    /同じ接続フォルダ|within its own connected folder/,
  );
  await assert.rejects(
    cloud.moveEntry(id, 'src/main.ts', `contents/${connectionName}/main.ts`),
    /out of the vault's own Contents files|Contents のファイルではなくなります/,
  );
  assert.equal(
    (
      await cloud.moveEntry(
        id,
        `contents/${connectionName}/paper.md`,
        `contents/${connectionName}/p.md`,
      )
    ).path,
    `contents/${connectionName}/p.md`,
  );

  // Back to Knowledge: the same files are notes' neighbours again.
  const back = await files.update(id, { rootLayer: null });
  assert.equal(back.rootLayer, undefined);
  assert.equal(
    (await files.entries(id, '')).find((item) => item.path === 'src')?.layer,
    'Knowledge_Base',
  );
});
