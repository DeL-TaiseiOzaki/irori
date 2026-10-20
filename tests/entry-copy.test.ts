import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { FileService } from '../src/host/files';
import { hostArguments } from '../src/domain/host-requests';
import { connectedFixture, connectionRoot } from './fixtures/cloud';

async function fixture(t: TestContext) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori copy '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const vault = async (name: string) => {
    const root = path.join(base, name);
    await mkdir(root);
    const space = await files.register(root, name, 'personal');
    return {
      id: space.scopeId,
      root,
      write: async (relative: string, text: string | Buffer) => {
        const file = path.join(root, relative);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, text);
      },
      read: (relative: string) => readFile(path.join(root, relative), 'utf8'),
      exists: (relative: string) =>
        lstat(path.join(root, relative)).then(
          () => true,
          () => false,
        ),
    };
  };
  const a = await vault('A');
  /** Copies as the host's paste does, from knowledge. */
  const copy = async (id: string, from: string, toId: string, directory: string) =>
    files.copyEntry(toId, directory, await files.copySource(id, from), path.posix.basename(from), {
      scopeId: id,
      path: from,
    });
  return { base, files, a, vault, copy };
}

test('A copy beside its original takes a free name and keeps the original as it was', async (t) => {
  const { a, copy } = await fixture(t);
  await a.write('Knowledge_Base/notes/plan.md', '# Plan\n\n[budget](budget.md)\n');
  await a.write('Knowledge_Base/notes/budget.md', '# Budget\n');
  const first = await copy(a.id, 'Knowledge_Base/notes/plan.md', a.id, 'Knowledge_Base/notes');
  assert.deepEqual(first, {
    path: 'Knowledge_Base/notes/plan 2.md',
    name: 'plan 2.md',
    directory: false,
    layer: 'Knowledge_Base',
    note: true,
  });
  const second = await copy(a.id, 'Knowledge_Base/notes/plan.md', a.id, 'Knowledge_Base/notes');
  assert.equal(second.name, 'plan 3.md');
  assert.equal(await a.read('Knowledge_Base/notes/plan 2.md'), '# Plan\n\n[budget](budget.md)\n');
  assert.equal(await a.read('Knowledge_Base/notes/plan.md'), '# Plan\n\n[budget](budget.md)\n');
});

test("A copy in another folder of the vault still leads where the original's links led", async (t) => {
  const { a, copy } = await fixture(t);
  await a.write('Knowledge_Base/top.md', '# Top\n');
  await a.write(
    'Knowledge_Base/project/one.md',
    '[two](two.md) [top](../top.md#part) [web](https://example.com)\n',
  );
  await a.write('Knowledge_Base/project/two.md', '[one](one.md)\n');
  await a.write('Knowledge_Base/project/.hidden', 'stays');
  await a.write('Knowledge_Base/archive/2026/.keep', '');

  // One note: every link is rewritten for where the copy is.
  const note = await copy(a.id, 'Knowledge_Base/project/one.md', a.id, 'Knowledge_Base');
  assert.equal(note.path, 'Knowledge_Base/one.md');
  assert.equal(
    await a.read('Knowledge_Base/one.md'),
    '[two](project/two.md) [top](top.md#part) [web](https://example.com)\n',
  );

  // A folder: links inside it lead within the copy, links out still lead out.
  const folder = await copy(a.id, 'Knowledge_Base/project', a.id, 'Knowledge_Base/archive/2026');
  assert.deepEqual(folder, {
    path: 'Knowledge_Base/archive/2026/project',
    name: 'project',
    directory: true,
    layer: 'Knowledge_Base',
    note: false,
  });
  assert.equal(
    await a.read('Knowledge_Base/archive/2026/project/one.md'),
    '[two](two.md) [top](../../../top.md#part) [web](https://example.com)\n',
  );
  assert.equal(await a.read('Knowledge_Base/archive/2026/project/two.md'), '[one](one.md)\n');
  // Hidden entries would be Schema in knowledge; they stay behind.
  assert.equal(await a.exists('Knowledge_Base/archive/2026/project/.hidden'), false);
  assert.equal(
    await a.read('Knowledge_Base/project/one.md'),
    '[two](two.md) [top](../top.md#part) [web](https://example.com)\n',
  );
});

test('A copy refuses a folder into itself, the knowledge folder, a folder holding a vault and aliases', async (t) => {
  const { base, files, a, copy } = await fixture(t);
  await a.write('Knowledge_Base/a/x.txt', 'x');
  await assert.rejects(copy(a.id, 'Knowledge_Base/a', a.id, 'Knowledge_Base/a'), /自分自身/);
  await a.write('Knowledge_Base/a/inner/y.txt', 'y');
  await assert.rejects(copy(a.id, 'Knowledge_Base/a', a.id, 'Knowledge_Base/a/inner'), /自分自身/);
  await assert.rejects(files.copySource(a.id, 'Knowledge_Base'), /vault の設定/);
  await assert.rejects(files.copySource(a.id, '.irori/scope.json'), /ナレッジかコンテンツ/);
  await a.write('Knowledge_Base/shelf/inner/readme.md', '# Inner\n');
  await files.register(path.join(base, 'A/Knowledge_Base/shelf/inner'), 'Inner', 'personal');
  await assert.rejects(copy(a.id, 'Knowledge_Base/shelf', a.id, 'Knowledge_Base'), /別の vault/);
  // An alias inside a copied folder stays behind; one copied by itself is refused.
  await symlink(
    path.join(a.root, 'Knowledge_Base/a/x.txt'),
    path.join(a.root, 'Knowledge_Base/a/link.txt'),
  );
  const copied = await copy(a.id, 'Knowledge_Base/a', a.id, 'Knowledge_Base');
  assert.equal(copied.name, 'a 2');
  assert.equal(await a.exists('Knowledge_Base/a 2/x.txt'), true);
  assert.equal(await a.exists('Knowledge_Base/a 2/link.txt'), false);
  await assert.rejects(
    files.copyEntry(
      a.id,
      'Knowledge_Base',
      path.join(a.root, 'Knowledge_Base/a/link.txt'),
      'link.txt',
    ),
    /シンボリックリンク/,
  );
  assert.equal(await a.exists('Knowledge_Base/link.txt'), false);
});

test('A note copied into another vault brings its managed images', async (t) => {
  const { a, vault, copy } = await fixture(t);
  const b = await vault('B');
  const bytes = Buffer.from('png bytes');
  const image = `_assets/image-${createHash('sha256').update(bytes).digest('hex')}.png`;
  await a.write(`Knowledge_Base/${image}`, bytes);
  await a.write('Knowledge_Base/note.md', `# Note\n\n![x](${image})\n`);
  await b.write('Knowledge_Base/inbox/.keep', '');
  const copied = await copy(a.id, 'Knowledge_Base/note.md', b.id, 'Knowledge_Base/inbox');
  assert.equal(copied.path, 'Knowledge_Base/inbox/note.md');
  assert.equal(await b.read('Knowledge_Base/inbox/note.md'), `# Note\n\n![x](${image})\n`);
  assert.equal(await b.read(`Knowledge_Base/inbox/${image}`), 'png bytes');
  assert.equal(await a.exists('Knowledge_Base/note.md'), true);
});

test('Copies go between knowledge and connected folders; a read-only one is only read', async (t) => {
  const { files, cloud, space, target } = await connectedFixture(t, { writable: true });
  const id = space.scopeId;
  await mkdir(path.join(space.root, 'Knowledge_Base'), { recursive: true });
  await writeFile(path.join(space.root, 'Knowledge_Base/memo.md'), '# Memo\n');
  await mkdir(path.join(target, 'shared/deep'), { recursive: true });
  await writeFile(path.join(target, 'shared/deep/data.csv'), 'a,b\n');
  await writeFile(path.join(target, 'shared/.sync'), 'sync state');

  const out = await cloud.copyEntry(
    id,
    connectionRoot,
    await files.copySource(id, 'Knowledge_Base/memo.md'),
    'memo.md',
  );
  assert.deepEqual(out, {
    path: `${connectionRoot}/memo.md`,
    name: 'memo.md',
    directory: false,
    layer: 'contents',
    note: true,
    writable: true,
  });
  assert.equal(await readFile(path.join(target, 'memo.md'), 'utf8'), '# Memo\n');

  const into = await files.copyEntry(
    id,
    'Knowledge_Base',
    await files.copySource(id, `${connectionRoot}/shared`),
    'shared',
  );
  assert.equal(into.path, 'Knowledge_Base/shared');
  assert.equal(
    await readFile(path.join(space.root, 'Knowledge_Base/shared/deep/data.csv'), 'utf8'),
    'a,b\n',
  );
  await assert.rejects(lstat(path.join(space.root, 'Knowledge_Base/shared/.sync')));

  const readOnly = await connectedFixture(t);
  const source = await readOnly.files.copySource(readOnly.space.scopeId, connectionRoot);
  await assert.rejects(
    readOnly.cloud.copyEntry(readOnly.space.scopeId, connectionRoot, source, 'again'),
    /読み取り専用/,
  );
});

test('The renderer asks for a copy only through a validated request', () => {
  const id = '00000000-0000-4000-8000-000000000000';
  assert.equal(
    hostArguments.copyEntry.safeParse([id, 'Knowledge_Base/a.md', id, 'Knowledge_Base']).success,
    true,
  );
  assert.equal(hostArguments.copyEntry.safeParse([id, '', id, 'Knowledge_Base']).success, false);
  assert.equal(hostArguments.copyEntry.safeParse([id, 'a.md', 'not an id', '']).success, false);
});
