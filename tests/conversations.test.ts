import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { ConversationStore } from '../src/agents/conversations';
import { sessionKey } from '../src/agents/sessions';

async function fixture(t: TestContext) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'irori conversation '));
  const binding = { scopeId: randomUUID(), agent: 'pi' as const, root: path.join(dataDir, 'KB') };
  const store = new ConversationStore(dataDir);
  t.after(async () => {
    await store.flush();
    await rm(dataDir, { recursive: true, force: true });
  });
  const filename = path.join(dataDir, 'agent-conversations', sessionKey(binding) + '.json');
  return { dataDir, binding, store, filename };
}

test('Accepted instructions retain their note and multiple sources across restart and checkout isolation', async (t) => {
  const { dataDir, binding, store, filename } = await fixture(t);
  const input = {
    ...binding,
    prompt: '  日本語の指示\n次の行  ',
    notePath: 'Wiki/選択.md',
    sources: [{ scopeId: randomUUID(), path: '資料/出典.md' }],
  };
  const queue = await store.enqueue(binding, input);
  input.sources[0].path = 'changed.md';
  queue[0].prompt = 'changed';
  const restarted = new ConversationStore(dataDir);
  const saved = await restarted.read(binding);
  assert.equal(saved.queued[0].prompt, '  日本語の指示\n次の行  ');
  assert.equal(saved.queued[0].notePath, 'Wiki/選択.md');
  assert.equal(saved.queued[0].sources?.[0].path, '資料/出典.md');
  for (const other of [
    { ...binding, agent: 'codex' as const },
    { ...binding, scopeId: randomUUID() },
    { ...binding, root: path.join(dataDir, 'copied-KB') },
  ])
    assert.deepEqual((await restarted.read(other)).queued, []);
  if (process.platform !== 'win32') assert.equal((await stat(filename)).mode & 0o777, 0o600);
  await restarted.remove(binding, saved.queued[0].id);
  assert.deepEqual((await new ConversationStore(dataDir).read(binding)).queued, []);
});

test('A persisted start is never replayed after interruption and restored requests cannot be answered', async (t) => {
  const { dataDir, binding, store } = await fixture(t);
  const first = { ...binding, prompt: 'first' };
  await store.enqueue(binding, first);
  const queue = await store.enqueue(binding, { ...binding, prompt: 'second' });
  const runId = randomUUID();
  await store.begin(binding, runId, first, queue[0].id);
  await store.event(binding, { runId, type: 'text', text: '途中までの' });
  await store.event(binding, { runId, type: 'text', text: '日本語' });
  await store.event(binding, {
    runId,
    type: 'question',
    text: '質問',
    requestId: randomUUID(),
    questions: [{ id: 'q', title: '選択' }],
  });
  await store.flush();
  const restarted = new ConversationStore(dataDir);
  const recovered = await restarted.read(binding);
  assert.deepEqual(
    recovered.queued.map((item) => item.prompt),
    ['second'],
  );
  assert.equal(recovered.activeRunId, undefined);
  assert.ok(recovered.events.some((event) => event.text === '途中までの日本語'));
  assert.match(recovered.events.at(-1)!.text, /未確認.*再送していません/);
  assert.ok(recovered.events.every((event) => !event.requestId && !event.questions));
  await assert.rejects(restarted.begin(binding, randomUUID(), first, queue[0].id), /順序/);
  const nextId = randomUUID();
  await restarted.begin(binding, nextId, { ...binding, prompt: 'second' }, queue[1].id);
  await restarted.finish(binding, {
    runId: nextId,
    type: 'done',
    text: '完了',
    outcome: 'completed',
  });
  const finished = await new ConversationStore(dataDir).read(binding);
  assert.equal(finished.queued.length, 0);
  assert.equal(finished.events.filter((event) => event.role === 'user').length, 2);
  assert.equal(finished.events.at(-1)?.outcome, 'completed');
});

test('Corrupt and mismatched history fails closed without replacing accepted instructions', async (t) => {
  const { dataDir, binding, store, filename } = await fixture(t);
  await store.enqueue(binding, { ...binding, prompt: 'Keep this instruction' });
  const original = await readFile(filename, 'utf8');
  for (const content of [
    '{broken',
    JSON.stringify({ ...JSON.parse(original), root: 'elsewhere' }),
  ]) {
    await writeFile(filename, content);
    const restarted = new ConversationStore(dataDir);
    await assert.rejects(restarted.read(binding));
    await assert.rejects(restarted.enqueue(binding, { ...binding, prompt: 'new' }));
    assert.equal(await readFile(filename, 'utf8'), content);
  }
  await writeFile(filename, original);
  assert.equal(
    (await new ConversationStore(dataDir).read(binding)).queued[0].prompt,
    'Keep this instruction',
  );
});

test('A failed claim leaves its queued instruction intact and history stays within a readable bound', async (t) => {
  const { dataDir, binding, store, filename } = await fixture(t);
  const input = { ...binding, prompt: 'Keep me' };
  const queued = await store.enqueue(binding, input);
  const original = await readFile(filename, 'utf8');
  await rm(filename);
  await mkdir(filename);
  await assert.rejects(store.begin(binding, randomUUID(), input, queued[0].id), /regular file/);
  assert.equal((await store.read(binding)).queued[0].id, queued[0].id);
  await rm(filename, { recursive: true });
  await writeFile(filename, original);
  const runId = randomUUID();
  await store.begin(binding, runId, input, queued[0].id);
  for (let i = 0; i < 430; i++)
    await store.event(binding, {
      runId,
      type: 'tool',
      text: `event ${i}`,
      details: '日本語'.repeat(500),
    });
  await store.event(binding, { runId, type: 'text', text: '\0'.repeat(150000) });
  await store.finish(binding, { runId, type: 'done', text: '完了', outcome: 'completed' });
  assert.ok((await stat(filename)).size < 2 * 1024 * 1024);
  const restored = await new ConversationStore(dataDir).read(binding);
  assert.equal(restored.truncated, true);
  assert.equal(restored.events.at(-1)?.text, '完了');
});

test('Queue count and byte limits reject additions without dropping previously accepted messages', async (t) => {
  const { binding, store, dataDir } = await fixture(t);
  for (let i = 0; i < 20; i++) await store.enqueue(binding, { ...binding, prompt: String(i) });
  await assert.rejects(store.enqueue(binding, { ...binding, prompt: 'overflow' }), /20/);
  assert.equal((await new ConversationStore(dataDir).read(binding)).queued.length, 20);
  const another = { ...binding, agent: 'codex' as const };
  const input = { ...another, prompt: '\0'.repeat(32000) };
  for (let i = 0; i < 5; i++) await store.enqueue(another, input);
  await assert.rejects(store.enqueue(another, input), /保存容量/);
  assert.equal((await new ConversationStore(dataDir).read(another)).queued.length, 5);
});
