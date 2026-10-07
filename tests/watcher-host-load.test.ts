import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { FileService, watcherIgnored } from '../src/host/files';
import type { Space } from '../src/domain/types';
import chokidar from 'chokidar';
import { setTimeout as delay } from 'node:timers/promises';

test('Watcher boundaries exclude tool caches and nested hibachis, retaining knowledge and metadata events', () => {
  const space: Space = {
    schemaVersion: 1,
    scopeId: randomUUID(),
    root: path.resolve('fixture'),
    name: 'Fixture',
    category: 'personal',
    contents: ['materials'],
  };
  const nested = { ...space, root: path.join(space.root, 'sub/KB'), scopeId: randomUUID() };
  const ignored = watcherIgnored(space, [space, nested]);
  for (const name of [
    '.git',
    'node_modules',
    '.venv',
    'venv',
    '__pycache__',
    '.pytest_cache',
    '.mypy_cache',
    '.ruff_cache',
    '.tox',
    '.next',
    '.turbo',
    '.cache',
  ]) {
    assert.equal(ignored(path.join(space.root, name)), true, name);
    assert.equal(ignored(path.join(space.root, 'sub', name, 'generated.md')), true, name);
  }
  for (const relative of [
    '.DS_Store',
    'sub/.DS_Store',
    'materials',
    'materials/cloud.md',
    'sub/KB',
    'sub/KB/note.md',
  ])
    assert.equal(ignored(path.join(space.root, relative)), true, relative);
  for (const relative of [
    '',
    'Knowledge_Base/note.md',
    'schema/rules.md',
    '.irori/scope.json',
    '.irori/routines/example/routine.yaml',
    'sub/KB-other/note.md',
    'venv-notes.md',
  ])
    assert.equal(ignored(path.join(space.root, relative)), false, relative);
  // A named knowledge layer is authoritative even if its name looks like a tool folder.
  const declared = watcherIgnored({ ...space, knowledge: 'venv' }, [space]);
  assert.equal(declared(path.join(space.root, 'venv/note.md')), false);
  assert.equal(declared(path.join(space.root, 'venv/__pycache__/generated')), true);
  assert.equal(watcherIgnored(nested, [space, nested])(path.join(nested.root, 'note.md')), false);
});

test('Registration changes rebuild cached watcher boundaries, including removal and renamed contents', async (t) => {
  const base = await mkdtemp(path.join(tmpdir(), 'irori-host-watcher-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const root = path.join(base, 'KB');
  await mkdir(path.join(root, 'sub'), { recursive: true });
  const space = await files.register(root, 'Fixture', 'personal');
  let ignored = watcherIgnored(space, files.list());
  const list = files.list.bind(files);
  let lists = 0,
    changes = 0;
  files.list = () => {
    lists++;
    return list();
  };
  const stop = files.onRegistrationsChanged(() => {
    changes++;
    ignored = watcherIgnored(files.get(space.scopeId), files.list());
  });
  t.after(stop);
  const nested = await files.register(path.join(root, 'sub'), 'Nested', 'team');
  assert.equal(changes, 1);
  assert.equal(ignored(path.join(root, 'sub/note.md')), true);
  for (let i = 0; i < 1000; i++) ignored(path.join(root, `note-${i}.md`));
  assert.equal(lists, 1);
  await files.unregister(nested.scopeId);
  assert.equal(ignored(path.join(root, 'sub/note.md')), false);
  await files.renameLayerFolder(space.scopeId, 'contents', 'Materials');
  assert.equal(changes, 3);
  assert.equal(ignored(path.join(root, 'Materials/cloud.md')), true);
  assert.equal(ignored(path.join(root, 'contents/note.md')), false);
  assert.equal(lists, 3);
});

test(
  'Real watchers leave cache trees unobserved and route a nested hibachi only to its own scope',
  { timeout: 10000 },
  async (t) => {
    const base = await mkdtemp(path.join(tmpdir(), 'irori-host-watch-events-'));
    t.after(() => rm(base, { recursive: true, force: true }));
    const root = path.join(base, 'KB');
    const nestedRoot = path.join(root, 'sub/KB');
    for (const relative of ['.venv/lib', '__pycache__', 'contents', 'sub/KB'])
      await mkdir(path.join(root, relative), { recursive: true });
    const space: Space = {
      schemaVersion: 1,
      scopeId: randomUUID(),
      root,
      name: 'Outer',
      category: 'personal',
      contents: ['contents'],
    };
    const nested = { ...space, scopeId: randomUUID(), root: nestedRoot, name: 'Nested' };
    const spaces = [space, nested];
    const outer = chokidar.watch(root, {
      ignoreInitial: true,
      depth: 6,
      followSymlinks: false,
      ignored: watcherIgnored(space, spaces),
    });
    const inner = chokidar.watch(nestedRoot, {
      ignoreInitial: true,
      depth: 6,
      followSymlinks: false,
      ignored: watcherIgnored(nested, spaces),
    });
    t.after(async () => {
      await Promise.all([outer.close(), inner.close()]);
    });
    const outerEvents: string[] = [],
      innerEvents: string[] = [];
    outer.on('all', (_, filename) => outerEvents.push(path.relative(root, filename)));
    inner.on('all', (_, filename) => innerEvents.push(path.relative(nestedRoot, filename)));
    await Promise.all(
      [outer, inner].map(
        (watcher) =>
          new Promise<void>((resolve, reject) => {
            watcher.once('ready', resolve);
            watcher.once('error', reject);
          }),
      ),
    );
    const watched = Object.keys(outer.getWatched()).map((folder) => path.relative(root, folder));
    for (const relative of ['.venv', '.venv/lib', '__pycache__', 'contents', 'sub/KB'])
      assert.ok(!watched.includes(relative), relative);
    await writeFile(path.join(root, '.venv/lib/cache.md'), 'cache');
    await writeFile(path.join(root, '__pycache__/cache.md'), 'cache');
    await writeFile(path.join(root, '.DS_Store'), 'system');
    await writeFile(path.join(nestedRoot, 'note.md'), 'nested knowledge');
    await writeFile(path.join(root, 'note.md'), 'outer knowledge');
    for (
      let i = 0;
      i < 100 && (!outerEvents.includes('note.md') || !innerEvents.includes('note.md'));
      i++
    )
      await delay(10);
    await delay(100);
    assert.deepEqual(outerEvents, ['note.md']);
    assert.deepEqual(innerEvents, ['note.md']);
  },
);
