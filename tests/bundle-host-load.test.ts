import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { FileService } from '../src/host/files';
import { SearchService } from '../src/host/search';
import { BundleService } from '../src/host/bundle';
import type { Space } from '../src/domain/types';

const okf = '---\nokf_version: "0.2"\n---\n';
const declaration = JSON.stringify({
  schemaVersion: 1,
  types: { concept: { heading: '# Concepts' } },
});

function gate() {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release };
}

test('Checks coalesce by scope, queue fresh updates and retry failed walks', async (t) => {
  const base = await mkdtemp(path.join(tmpdir(), 'irori-host-graph-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const spaces: Space[] = [];
  for (const name of ['First', 'Second']) {
    const root = path.join(base, name);
    await mkdir(path.join(root, 'Knowledge_Base/wiki'), { recursive: true });
    await writeFile(path.join(root, 'Knowledge_Base/wiki/note.md'), '---\ntitle: Note\n---\nBody');
    await writeFile(path.join(root, 'Knowledge_Base/index.md'), okf);
    await mkdir(path.join(root, '.property'));
    await writeFile(path.join(root, '.property/property.json'), declaration);
    spaces.push(await files.register(root, name, 'personal'));
  }
  const search = new SearchService(files);
  const walk = search.walk.bind(search);
  const started = gate(),
    resume = gate();
  t.after(resume.release);
  const walks = new Map<string, number>();
  let fail = false;
  search.walk = async (...args) => {
    walks.set(args[0], (walks.get(args[0]) ?? 0) + 1);
    if (fail) {
      fail = false;
      throw Error('Temporary walk failure');
    }
    if (args[0] === spaces[0].scopeId && walks.get(args[0]) === 1) {
      started.release();
      await resume.wait;
    }
    return walk(...args);
  };
  const graph = new BundleService(files, search);
  const building = graph as unknown as { build: (id: string, fresh?: boolean) => Promise<unknown> };
  const build = building.build.bind(graph);
  const updateStarted = gate();
  let builds = 0;
  const pages = async (id: string) => (await graph.ontology(id)).report!.pages;
  const current = async (id: string) => {
    const { indexes } = await graph.ontology(id);
    return !!indexes && !indexes.added && !indexes.changed;
  };
  building.build = (id, fresh) => {
    if (id === spaces[0].scopeId && ++builds === 2) updateStarted.release();
    return build(id, fresh);
  };
  const first = pages(spaces[0].scopeId);
  await started.wait;
  const burst = Array.from({ length: 20 }, () => pages(spaces[0].scopeId));
  const updating = graph.update(spaces[0].scopeId);
  await updateStarted.wait;
  assert.equal(await pages(spaces[1].scopeId), 1);
  resume.release();
  assert.ok((await Promise.all([first, ...burst])).every((count) => count === 1));
  assert.deepEqual((await updating).written, [
    'Knowledge_Base/index.md',
    'Knowledge_Base/wiki/index.md',
  ]);
  assert.equal(walks.get(spaces[0].scopeId), 2);
  assert.equal(await current(spaces[0].scopeId), true);
  assert.equal(walks.get(spaces[0].scopeId), 3);
  fail = true;
  await assert.rejects(graph.ontology(spaces[0].scopeId), /Temporary walk failure/);
  assert.equal(await current(spaces[0].scopeId), true);
});

test('An explicit update rereads pages edited after a coalesced check walked them', async (t) => {
  const base = await mkdtemp(path.join(tmpdir(), 'irori-host-graph-update-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const root = path.join(base, 'KB');
  await mkdir(path.join(root, 'Knowledge_Base/wiki'), { recursive: true });
  const note = path.join(root, 'Knowledge_Base/wiki/note.md');
  const page = (title: string) => `---\ntype: concept\ntitle: ${title}\n---\nBody`;
  await writeFile(note, page('OriginalTitle'));
  await writeFile(path.join(root, 'Knowledge_Base/index.md'), okf);
  await mkdir(path.join(root, '.property'));
  await writeFile(path.join(root, '.property/property.json'), declaration);
  const space = await files.register(root, 'Fixture', 'personal');
  const search = new SearchService(files);
  const walk = search.walk.bind(search);
  const started = gate(),
    resume = gate();
  t.after(resume.release);
  let walks = 0;
  search.walk = async (...args) => {
    const result = await walk(...args);
    if (++walks === 1) {
      started.release();
      await resume.wait;
    }
    return result;
  };
  const graph = new BundleService(files, search);
  const building = graph as unknown as { build: (id: string, fresh?: boolean) => Promise<unknown> };
  const build = building.build.bind(graph);
  const updateStarted = gate();
  building.build = (id, fresh) => {
    if (fresh) updateStarted.release();
    return build(id, fresh);
  };
  const checking = graph.ontology(space.scopeId);
  await started.wait;
  await writeFile(note, page('UpdatedTitleWithMoreText'));
  const updating = graph.update(space.scopeId);
  await updateStarted.wait;
  resume.release();
  await checking;
  assert.equal((await updating).written.length, 2);
  assert.equal(walks, 2);
  const index = await readFile(path.join(root, 'Knowledge_Base/wiki/index.md'), 'utf8');
  assert.match(index, /UpdatedTitleWithMoreText/);
  assert.doesNotMatch(index, /OriginalTitle/);
});
