import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { FileService } from '../src/host/files';
import { SearchService } from '../src/host/search';
import { GraphIndexService } from '../src/host/graph-index';
import type { Space } from '../src/domain/types';
import { graphIndexFiles } from '../src/domain/graph-index';

function gate() {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release };
}

test('Graph checks coalesce by scope, queue fresh updates and retry failed walks', async (t) => {
  const base = await mkdtemp(path.join(tmpdir(), 'irori-host-graph-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const spaces: Space[] = [];
  for (const name of ['First', 'Second']) {
    const root = path.join(base, name);
    await mkdir(path.join(root, 'Knowledge_Base/wiki'), { recursive: true });
    await writeFile(path.join(root, 'Knowledge_Base/wiki/note.md'), '---\ntitle: Note\n---\nBody');
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
  const graph = new GraphIndexService(files, search);
  const building = graph as unknown as { build: (id: string, fresh?: boolean) => Promise<unknown> };
  const build = building.build.bind(graph);
  const updateStarted = gate();
  let builds = 0;
  building.build = (id, fresh) => {
    if (id === spaces[0].scopeId && ++builds === 2) updateStarted.release();
    return build(id, fresh);
  };
  const first = graph.status(spaces[0].scopeId);
  await started.wait;
  const burst = Array.from({ length: 20 }, () => graph.status(spaces[0].scopeId));
  const updating = graph.update(spaces[0].scopeId);
  await updateStarted.wait;
  assert.equal((await graph.status(spaces[1].scopeId)).pages, 1);
  resume.release();
  assert.ok((await Promise.all([first, ...burst])).every((status) => status.pages === 1));
  assert.equal((await updating).current, true);
  assert.equal(walks.get(spaces[0].scopeId), 2);
  assert.equal((await graph.status(spaces[0].scopeId)).current, true);
  assert.equal(walks.get(spaces[0].scopeId), 3);
  fail = true;
  await assert.rejects(graph.status(spaces[0].scopeId), /Temporary walk failure/);
  assert.equal((await graph.status(spaces[0].scopeId)).current, true);
});

test('An explicit graph update rereads pages edited after a coalesced status walk checked them', async (t) => {
  const base = await mkdtemp(path.join(tmpdir(), 'irori-host-graph-update-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const root = path.join(base, 'KB');
  await mkdir(path.join(root, 'Knowledge_Base/wiki'), { recursive: true });
  const note = path.join(root, 'Knowledge_Base/wiki/note.md');
  const page = (title: string) =>
    `---\ntitle: ${title}\nrelations:\n  - { rel: uses, target: other.md }\n---\nBody`;
  await writeFile(note, page('OriginalTitle'));
  await writeFile(path.join(root, 'Knowledge_Base/wiki/other.md'), '# Other');
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
  const graph = new GraphIndexService(files, search);
  const building = graph as unknown as { build: (id: string, fresh?: boolean) => Promise<unknown> };
  const build = building.build.bind(graph);
  const updateStarted = gate();
  building.build = (id, fresh) => {
    if (fresh) updateStarted.release();
    return build(id, fresh);
  };
  const checking = graph.status(space.scopeId);
  await started.wait;
  await writeFile(note, page('UpdatedTitleWithMoreText'));
  const updating = graph.update(space.scopeId);
  await updateStarted.wait;
  resume.release();
  await checking;
  assert.equal((await updating).current, true);
  assert.equal(walks, 2);
  const entities = await readFile(path.join(root, graphIndexFiles.entities), 'utf8');
  assert.match(entities, /UpdatedTitleWithMoreText/);
  assert.doesNotMatch(entities, /OriginalTitle/);
});
