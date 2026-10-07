import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { KnowledgeStore } from '../src/knowledge/store';

async function fixture(t: TestContext) {
  const base = await fs.mkdtemp(path.join(tmpdir(), 'irori-host-knowledge-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const store = new KnowledgeStore(base, async () => {
    throw Error('No source access');
  });
  const scopeId = randomUUID();
  const file = (kind: string, id: string) =>
    path.join(store.directory, kind, scopeId, `${id}.json`);
  const write = async (kind: string, id: string, value: unknown) => {
    const filename = file(kind, id);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, JSON.stringify(value));
  };
  return { store, scopeId, file, write };
}

test('History validates dates once, retains the newest 100 and reads only their outcomes with bounded parallelism', async (t) => {
  const { store, scopeId, file, write } = await fixture(t);
  const ids: string[] = [];
  for (let i = 0; i < 140; i++) {
    const id = randomUUID();
    ids.push(id);
    const at = new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString();
    await write('runs', id, { id, scopeId, agent: 'codex', createdAt: at, sources: [] });
    await write('outcomes', id, { outcome: 'completed' });
    await write('artifacts', id, {
      id,
      runId: id,
      source: { id, scopeId, path: 'note.md', hash: 'a'.repeat(64), size: 1, capturedAt: at },
      registeredAt: at,
      evidence: 'manual-registration',
    });
    // Filesystem timestamps deliberately disagree with the record dates.
    await fs.utimes(file('runs', id), new Date(2030, 0, 1), new Date(2030, 0, 1));
  }
  const readFile = fs.readFile;
  const reads = { runs: 0, artifacts: 0, outcomes: 0 };
  let active = 0,
    maximum = 0;
  t.mock.method(fs, 'readFile', async (...args: any[]) => {
    const kind = path.basename(path.dirname(path.dirname(String(args[0])))) as keyof typeof reads;
    if (!(kind in reads)) return Reflect.apply(readFile, fs, args);
    reads[kind]++;
    maximum = Math.max(maximum, ++active);
    try {
      await delay(1);
      return await Reflect.apply(readFile, fs, args);
    } finally {
      active--;
    }
  });
  const results = await Promise.all(Array.from({ length: 10 }, () => store.history(scopeId)));
  const history = results[0];
  assert.deepEqual(
    history.runs.map((run) => run.id),
    ids.slice(40).reverse(),
  );
  assert.deepEqual(
    history.artifacts.map((artifact) => artifact.id),
    ids.slice(40).reverse(),
  );
  assert.ok(history.runs.every((run) => run.outcome === 'completed'));
  assert.deepEqual(reads, { runs: 140, artifacts: 140, outcomes: 100 });
  assert.ok(maximum > 1 && maximum <= 8);
  history.artifacts[0].source.path = 'caller-edit.md';
  assert.equal(results[1].artifacts[0].source.path, 'note.md');
  const again = await store.history(scopeId);
  assert.equal(again.artifacts[0].source.path, 'note.md');
  assert.deepEqual(reads, { runs: 140, artifacts: 140, outcomes: 100 });
  const added = randomUUID();
  const createdAt = '2026-10-07T00:00:00.000Z';
  await write('runs', added, { id: added, scopeId, agent: 'codex', createdAt, sources: [] });
  const fresh = await store.history(scopeId);
  assert.equal(fresh.runs[0].id, added);
  assert.equal(fresh.runs.length, 100);
  assert.equal(fresh.runs[0].outcome, undefined);
  await store.finish(fresh.runs[0], 'failed');
  assert.equal((await store.history(scopeId)).runs[0].outcome, 'failed');
  assert.deepEqual(reads, { runs: 141, artifacts: 140, outcomes: 101 });
  assert.equal((await fs.readdir(path.dirname(file('runs', added)))).length, 141);
});

test('Changed record stamps invalidate summaries, old corrupt records still fail and errors are retryable', async (t) => {
  const { store, scopeId, file, write } = await fixture(t);
  const id = randomUUID();
  const record = {
    id,
    scopeId,
    agent: 'codex',
    createdAt: '2026-01-01T00:00:00.000Z',
    sources: [],
  };
  await write('runs', id, record);
  assert.equal((await store.history(scopeId)).runs[0].createdAt, record.createdAt);
  const changed = { ...record, createdAt: '2026-02-01T00:00:00.000Z' };
  await write('runs', id, changed);
  const later = new Date(2030, 0, 1);
  await fs.utimes(file('runs', id), later, later);
  assert.equal((await store.history(scopeId)).runs[0].createdAt, changed.createdAt);
  const old = randomUUID();
  await write('runs', old, { ...record, id: old, createdAt: '2020-01-01T00:00:00.000Z' });
  await store.history(scopeId);
  await fs.writeFile(file('runs', old), '{corrupt');
  await assert.rejects(store.history(scopeId));
  await write('runs', old, { ...record, id: old, createdAt: '2020-01-01T00:00:00.000Z' });
  assert.equal((await store.history(scopeId)).runs.length, 2);
});

test('Old outcomes are not opened when they cannot appear among the newest 100 runs', async (t) => {
  const { store, scopeId, file, write } = await fixture(t);
  let oldest = '';
  for (let i = 0; i < 101; i++) {
    const id = randomUUID();
    if (!i) oldest = id;
    await write('runs', id, {
      id,
      scopeId,
      agent: 'codex',
      createdAt: new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString(),
      sources: [],
    });
  }
  await write('outcomes', oldest, 'invalid old outcome');
  assert.equal((await store.history(scopeId)).runs.length, 100);
  assert.equal(await fs.readFile(file('outcomes', oldest), 'utf8'), '"invalid old outcome"');
});
