import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import {
  appendFile,
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ConversationStore, jsonLine, storedLine, viewDetails } from '../src/agents/conversations';
import { DeviceIdentity } from '../src/host/device';
import type { StartRun } from '../src/domain/types';

const posix = process.platform !== 'win32';

async function fixture(t: TestContext) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'irori conversation '));
  const open = () => new ConversationStore(dataDir, new DeviceIdentity(dataDir));
  const store = open();
  const owner = { kind: 'hibachi' as const, id: randomUUID(), name: 'KB' };
  const placement = { owner, agent: 'pi' as const, create: true };
  const input = (prompt: string, extra: Partial<StartRun> = {}): StartRun => ({
    scopeId: owner.id,
    agent: 'pi',
    prompt,
    ...extra,
  });
  const folder = (id: string) => path.join(dataDir, 'conversations', id);
  t.after(async () => {
    await store.flush();
    await rm(dataDir, { recursive: true, force: true });
  });
  return { dataDir, open, store, owner, placement, input, folder };
}
async function lines(file: string) {
  return (await readFile(file, 'utf8')).split('\n').filter(Boolean);
}

test('A conversation is a folder of metadata and events, made on its first instruction and titled by its first line', async (t) => {
  const { dataDir, open, store, owner, placement, input, folder } = await fixture(t);
  const id = store.reserve(owner.id, 'pi');
  // A reserved id writes nothing until an instruction arrives.
  await assert.rejects(stat(path.join(dataDir, 'conversations')));
  const title = 'あ'.repeat(48) + '👨‍👩‍👧' + 'い'.repeat(10);
  const sources = [{ scopeId: randomUUID(), path: '資料/出典.md' }];
  const queue = await store.enqueue(
    id,
    { owner, agent: 'pi' },
    input(`\n  ${title}\n次の行  `, { notePath: 'Wiki/選択.md', sources }),
  );
  queue[0].prompt = 'changed';
  sources[0].path = 'changed.md';
  const meta = JSON.parse(await readFile(path.join(folder(id), 'meta.json'), 'utf8'));
  assert.equal(meta.id, id);
  assert.deepEqual(meta.owner, owner);
  assert.equal(meta.agent, 'pi');
  assert.equal(meta.title, 'あ'.repeat(48) + '👨‍👩‍👧' + 'い', 'cut at 50 characters, never inside one');
  assert.equal(meta.titleSource, 'first-message');
  assert.equal(meta.linkedNote, 'Wiki/選択.md');
  assert.deepEqual(meta.native, {});
  assert.deepEqual((await readdir(folder(id))).sort(), ['events.jsonl', 'meta.json']);
  // The queue is this device's: it stays in the data directory, never in the conversation.
  assert.doesNotMatch(await readFile(path.join(folder(id), 'meta.json'), 'utf8'), /次の行/);
  const restarted = open();
  const saved = await restarted.read(id);
  assert.equal(saved.queued[0].prompt, `\n  ${title}\n次の行  `);
  assert.equal(saved.queued[0].notePath, 'Wiki/選択.md');
  assert.equal(saved.queued[0].sources?.[0].path, '資料/出典.md');
  if (posix) {
    assert.equal((await stat(path.join(folder(id), 'meta.json'))).mode & 0o777, 0o600);
    assert.equal((await stat(path.join(folder(id), 'events.jsonl'))).mode & 0o777, 0o600);
    assert.equal(
      (await stat(path.join(dataDir, 'conversation-state', `${id}.json`))).mode & 0o777,
      0o600,
    );
  }
  // An id nobody reserved, another owner's, or another CLI's is refused.
  await assert.rejects(
    store.enqueue(randomUUID(), { owner, agent: 'pi' }, input('x')),
    /ありません/,
  );
  await assert.rejects(
    store.enqueue(id, { owner: { ...owner, id: randomUUID() }, agent: 'pi' }, input('x')),
    /持ち主/,
  );
  await assert.rejects(store.enqueue(id, { ...placement, agent: 'codex' }, input('x')), /Pi/);
  const [row] = await restarted.list(owner.id);
  assert.ok(row && !('damaged' in row));
  assert.equal(row.queued, 1);
  assert.equal(row.running, false);
  assert.deepEqual(await restarted.list(randomUUID()), []);
});

test('Events are appended, a streamed reply keeps one id across writes, and details over 1 MiB keep a marker', async (t) => {
  const { open, store, owner, placement, input, folder } = await fixture(t);
  const id = randomUUID();
  const runId = randomUUID();
  const eventId = randomUUID();
  await store.begin(id, placement, { runId, eventId }, input('最初の指示'));
  const file = path.join(folder(id), 'events.jsonl');
  const first = await readFile(file, 'utf8');
  const reply = randomUUID();
  store.event(id, { id: reply, runId, type: 'text', text: '途中までの' });
  await store.flush();
  store.event(id, { id: reply, runId, type: 'text', text: '日本語' });
  const details = '日本語'.repeat(200000); // 1.8 MB of UTF-8
  store.event(id, { runId, type: 'tool', text: 'read', details, call: 'call-1' });
  store.event(id, {
    runId,
    type: 'tool',
    text: 'read の結果',
    details: 'ok',
    call: 'call-1',
    result: true,
  });
  const long = randomUUID();
  store.event(id, { id: long, runId, type: 'text', text: 'x'.repeat(2.5 * 1024 * 1024) });
  store.event(id, {
    runId,
    type: 'question',
    text: '質問',
    requestId: randomUUID(),
    questions: [{ id: 'q', title: '選択' }],
  });
  await store.finish(id, { runId, type: 'done', text: '完了', outcome: 'completed' });
  // Append only: what was written stays byte for byte.
  assert.ok((await readFile(file, 'utf8')).startsWith(first));
  const stored = (await lines(file)).map((line) => JSON.parse(line));
  assert.equal(stored.filter((line) => line.id === reply).length, 2, 'two writes, one id');
  assert.ok(stored.filter((line) => line.id === long).length >= 3, 'a long reply spans lines');
  const tool = stored.find((line) => line.call === 'call-1' && !line.result);
  assert.equal(tool.cut, Buffer.byteLength(details));
  assert.ok(Buffer.byteLength(tool.details) <= 1024 * 1024);
  assert.ok(tool.details.startsWith('日本語'));
  const { events, earlier, damaged, activeRunId, meta } = await open().read(id);
  assert.equal(earlier, 0);
  assert.equal(damaged, 0);
  assert.equal(activeRunId, undefined);
  assert.equal(meta.updatedAt > meta.createdAt, true);
  assert.deepEqual(
    events.map((event) => [event.role ?? '', event.type]),
    [
      ['user', 'status'],
      ['', 'text'],
      ['', 'tool'],
      ['', 'tool'],
      ['', 'text'],
      ['', 'status'],
      ['', 'done'],
    ],
  );
  assert.equal(events[0].id, eventId);
  assert.equal(events[1].text, '途中までの日本語');
  assert.equal(events[1].id, reply);
  assert.equal(events[2].details?.length, viewDetails, 'a view gets the first 16,000');
  assert.equal(events[2].cut, Buffer.byteLength(details));
  assert.equal(events[3].result, true);
  assert.equal(events[4].text.length, 2.5 * 1024 * 1024, 'text is kept whole');
  assert.ok(events.every((event) => !event.requestId && !event.questions));
  assert.ok(events.every((event) => event.conversationId === id && event.agent === 'pi'));
});

test('A damaged meta.json is listed and never replaced; a damaged line is skipped and later turns still append', async (t) => {
  const { open, store, owner, placement, input, folder } = await fixture(t);
  const a = randomUUID();
  const b = randomUUID();
  for (const id of [a, b]) {
    const runId = randomUUID();
    await store.begin(id, placement, { runId, eventId: randomUUID() }, input(`about ${id}`));
    store.event(id, { runId, type: 'text', text: 'reply' });
    store.event(id, { runId, type: 'tool', text: 'tool' });
    await store.finish(id, { runId, type: 'done', text: '完了', outcome: 'completed' });
  }
  const file = path.join(folder(a), 'events.jsonl');
  const written = await lines(file);
  written[1] = '{broken';
  await writeFile(file, written.join('\n') + '\n');
  // A crash in the middle of a write leaves a line without its end.
  await appendFile(file, '{"id":"half a line');
  let restarted = open();
  const read = await restarted.read(a);
  assert.equal(read.damaged, 2);
  assert.deepEqual(
    read.events.map((event) => event.type),
    ['status', 'tool', 'done'],
  );
  const runId = randomUUID();
  await restarted.begin(a, placement, { runId, eventId: randomUUID() }, input('again'));
  await restarted.finish(a, { runId, type: 'done', text: '完了', outcome: 'completed' });
  const after = await open().read(a);
  assert.equal(after.damaged, 2, 'the cut line stays apart from the next write');
  assert.equal(after.events.at(-2)?.text, 'again');
  assert.equal(after.events.at(-1)?.outcome, 'completed');

  const metaFile = path.join(folder(b), 'meta.json');
  for (const content of [
    '{broken',
    JSON.stringify({ schemaVersion: 1, id: b, owner: { id: owner.id }, title: 3 }),
  ]) {
    await writeFile(metaFile, content);
    restarted = open();
    const rows = await restarted.list(owner.id);
    const row = rows.find((item) => item.id === b);
    assert.ok(row && 'damaged' in row, JSON.stringify(rows));
    assert.match(row.damaged, /meta\.json/);
    await assert.rejects(restarted.read(b), /meta\.json/);
    await assert.rejects(restarted.enqueue(b, placement, input('new')), /meta\.json/);
    assert.equal(await readFile(metaFile, 'utf8'), content);
  }
  // Its owner still readable, a damaged row stays out of another owner's list.
  assert.equal((await restarted.list(randomUUID())).length, 0);
  await restarted.remove(b);
  await assert.rejects(stat(folder(b)));
  assert.deepEqual(
    (await restarted.list(owner.id)).map((row) => row.id),
    [a],
  );
});

test('Pending instructions stay on this device, come back paused and run oldest first across conversations', async (t) => {
  const { dataDir, open, store, owner, placement, input } = await fixture(t);
  const x = randomUUID();
  const y = randomUUID();
  const [x1] = await store.enqueue(x, placement, input('x1\nbody of x1'));
  const [y1] = await store.enqueue(y, placement, input('y1\nbody of y1'));
  await store.enqueue(x, placement, input('x2\nbody of x2'));
  assert.equal(await store.pending(owner.id), 3);
  assert.equal((await store.nextQueued(owner.id))?.item.prompt, 'x1\nbody of x1');
  assert.equal(await store.current(owner.id, 'pi'), x, 'the conversation queued longest is shown');
  // An instruction cannot pass the queue it waits behind, or take another's place.
  await assert.rejects(
    store.begin(x, placement, { runId: randomUUID(), eventId: randomUUID() }, input('now')),
    /送信待ちがあります/,
  );
  await assert.rejects(
    store.begin(x, placement, { runId: randomUUID(), eventId: randomUUID() }, input('y1'), y1.id),
    /順序/,
  );
  const runId = randomUUID();
  await store.begin(x, placement, { runId, eventId: randomUUID() }, input(x1.prompt), x1.id);
  assert.equal(await store.current(owner.id, 'pi'), x, 'the running conversation is shown');
  const running = (await store.list(owner.id)).find((row) => row.id === x);
  assert.ok(running && !('damaged' in running) && running.running);
  await store.finish(x, { runId, type: 'done', text: '完了', outcome: 'completed' });
  // The oldest waiting instruction is now in the other conversation.
  const restarted = open();
  assert.equal(await restarted.pending(owner.id), 2);
  const next = await restarted.nextQueued(owner.id);
  assert.equal(next?.conversationId, y);
  assert.equal(next?.item.prompt, 'y1\nbody of y1');
  assert.equal((await restarted.read(x)).queued[0].prompt, 'x2\nbody of x2');
  // Nothing about the queue is in the conversations folder.
  for (const id of [x, y])
    for (const name of ['meta.json', 'events.jsonl'])
      assert.doesNotMatch(
        await readFile(path.join(dataDir, 'conversations', id, name), 'utf8'),
        /body of (x2|y1)/,
      );
  await restarted.removeQueued(y, y1.id);
  await assert.rejects(restarted.removeQueued(y, y1.id), /送信待ちにありません/);
  await assert.rejects(stat(path.join(dataDir, 'conversation-state', `${y}.json`)));
});

test('A claimed run is never sent again after an interruption, and its message comes back from the claim', async (t) => {
  const { dataDir, open, store, placement, input } = await fixture(t);
  const id = randomUUID();
  const [first] = await store.enqueue(id, placement, input('first'));
  await store.enqueue(id, placement, input('second'));
  const runId = randomUUID();
  await store.begin(id, placement, { runId, eventId: randomUUID() }, input('first'), first.id);
  store.event(id, { runId, type: 'text', text: '途中まで' });
  await store.flush();
  let recovered = await open().read(id);
  assert.equal(recovered.activeRunId, undefined);
  assert.deepEqual(
    recovered.queued.map((item) => item.prompt),
    ['second'],
  );
  assert.equal(recovered.events[1].text, '途中まで');
  assert.match(recovered.events.at(-1)!.text, /未確認.*再送していません/);

  // The host stopped between the claim and the message: the claim holds the message.
  const other = randomUUID();
  await store.enqueue(other, placement, input('placeholder'));
  const state = path.join(dataDir, 'conversation-state', `${other}.json`);
  const record = JSON.parse(await readFile(state, 'utf8'));
  const eventId = randomUUID();
  const claimed = randomUUID();
  record.queued = [];
  record.active = {
    runId: claimed,
    eventId,
    at: new Date().toISOString(),
    input: { prompt: '取り出した指示' },
  };
  await writeFile(state, JSON.stringify(record));
  recovered = await open().read(other);
  assert.deepEqual(
    recovered.events.map((event) => [event.id === eventId, event.role, event.text.slice(0, 8)]),
    [
      [true, 'user', '取り出した指示'],
      [false, undefined, '前回の実行結果は'],
    ],
  );
  await assert.rejects(stat(state), 'nothing is left to recover or send');
});

test('Queue count and byte limits refuse additions without dropping accepted instructions', async (t) => {
  const { open, store, placement, input } = await fixture(t);
  const id = randomUUID();
  for (let i = 0; i < 20; i++) await store.enqueue(id, placement, input(String(i)));
  await assert.rejects(store.enqueue(id, placement, input('overflow')), /20/);
  assert.equal((await open().read(id)).queued.length, 20);
  const another = randomUUID();
  for (let i = 0; i < 5; i++) await store.enqueue(another, placement, input('\0'.repeat(32000)));
  await assert.rejects(store.enqueue(another, placement, input('\0'.repeat(32000))), /保存容量/);
  assert.equal((await open().read(another)).queued.length, 5);
});

test('Rename, pin, archive and delete change only irori’s copy', async (t) => {
  const { dataDir, open, store, owner, placement, input, folder } = await fixture(t);
  const ids: string[] = [];
  for (const prompt of ['one', 'two', 'three']) {
    const id = randomUUID();
    const runId = randomUUID();
    await store.begin(id, placement, { runId, eventId: randomUUID() }, input(prompt));
    await store.finish(id, { runId, type: 'done', text: '完了', outcome: 'completed' });
    ids.push(id);
  }
  const [one, two, three] = ids;
  assert.deepEqual(
    (await store.list(owner.id)).map((row) => row.id),
    [three, two, one],
    'newest first',
  );
  const renamed = await store.rename(one, '  名前を\n変えた  ');
  assert.equal(renamed.title, '名前を 変えた');
  await assert.rejects(store.rename(one, '   '));
  await store.pin(one, true);
  await store.archive(three, true);
  const rows = await open().list(owner.id);
  assert.deepEqual(
    rows.map((row) => row.id),
    [one, three, two],
    'pinned first; an archived row is still listed, marked',
  );
  assert.equal(
    JSON.parse(await readFile(path.join(folder(one), 'meta.json'), 'utf8')).titleSource,
    'person',
  );
  assert.equal(
    await store.latest(owner.id, 'pi'),
    two,
    'the latest not archived; pins do not count',
  );
  // Sending in an archived conversation brings it back.
  await store.enqueue(three, placement, input('back'));
  assert.equal(
    JSON.parse(await readFile(path.join(folder(three), 'meta.json'), 'utf8')).archived,
    false,
  );
  await assert.rejects(store.remove(three), /取り消して/);
  const [item] = (await store.read(three)).queued;
  await store.removeQueued(three, item.id);
  await store.remove(three);
  await assert.rejects(stat(folder(three)));
  const runId = randomUUID();
  await store.begin(two, placement, { runId, eventId: randomUUID() }, input('busy'));
  await assert.rejects(store.remove(two), /停止/);
  await store.finish(two, { runId, type: 'done', text: '完了', outcome: 'completed' });
  if (posix) {
    // A conversation folder that is a link is removed as a link.
    const outside = path.join(dataDir, 'outside');
    await mkdir(outside);
    await writeFile(path.join(outside, 'keep.txt'), 'keep');
    const linked = randomUUID();
    await symlink(outside, folder(linked));
    const fresh = open();
    assert.ok((await fresh.list(owner.id)).some((row) => row.id === linked && 'damaged' in row));
    await fresh.remove(linked);
    assert.equal(await readFile(path.join(outside, 'keep.txt'), 'utf8'), 'keep');
  }
});

test('A failed claim leaves its queued instruction where it was', async (t) => {
  const { open, store, placement, input, folder } = await fixture(t);
  const id = randomUUID();
  const [queued] = await store.enqueue(id, placement, input('Keep me'));
  const file = path.join(folder(id), 'events.jsonl');
  await rm(file);
  await mkdir(file);
  await assert.rejects(
    store.begin(
      id,
      placement,
      { runId: randomUUID(), eventId: randomUUID() },
      input('Keep me'),
      queued.id,
    ),
    /regular file|EISDIR/,
  );
  const restarted = open();
  assert.equal(await restarted.pending(placement.owner.id), 1);
  assert.equal((await restarted.nextQueued(placement.owner.id))?.item.id, queued.id);
});

test('Line and paragraph separators and lone carriage returns stay inside their event', async (t) => {
  const { open, store, placement, input, folder } = await fixture(t);
  const id = randomUUID();
  const runId = randomUUID();
  await store.begin(id, placement, { runId, eventId: randomUUID() }, input('区切り を含む指示'));
  store.event(id, { runId, type: 'text', text: '日本語 の 応答\rです' });
  store.event(id, { runId, type: 'tool', text: 'read', details: '{"a":" "}' });
  await store.finish(id, { runId, type: 'done', text: '完了', outcome: 'completed' });
  const raw = await readFile(path.join(folder(id), 'events.jsonl'), 'utf8');
  assert.ok(!raw.includes(' ') && !raw.includes(' '));
  const { events, damaged } = await open().read(id);
  assert.equal(damaged, 0);
  assert.equal(events[0].text, '区切り を含む指示');
  assert.equal(events[1].text, '日本語 の 応答\rです');
  assert.equal(events[2].details, '{"a":" "}');
});

test('Long histories keep the newest events, join buffered text and count earlier and damaged events', async (t) => {
  const { store, placement, input, folder } = await fixture(t);
  const id = randomUUID();
  const runId = randomUUID();
  await store.begin(id, placement, { runId, eventId: randomUUID() }, input('first'));
  for (let index = 0; index < 1005; index++)
    store.event(id, { runId, type: 'tool', text: String(index) });
  const reply = randomUUID();
  store.event(id, { id: reply, runId, type: 'text', text: 'saved' });
  await store.flush();
  await appendFile(path.join(folder(id), 'events.jsonl'), '{broken}\n');
  store.event(id, { id: reply, runId, type: 'text', text: ' and buffered' });
  let value = await store.read(id);
  assert.equal(value.events.length, 1000);
  assert.equal(value.earlier, 7);
  assert.equal(value.events[0].text, '6');
  assert.equal(value.events.at(-1)?.text, 'saved and buffered');
  assert.equal(value.damaged, 1);
  await store.finish(id, { runId, type: 'done', text: 'done', outcome: 'completed' });
  value = await store.read(id);
  assert.equal(value.events.length, 1000);
  assert.equal(value.earlier, 8);
  assert.equal(value.events[0].text, '7');
  assert.equal(value.damaged, 1);
});

test('The history byte window keeps whole UTF-8 replies including the event crossing its limit', async (t) => {
  const { store, placement, input } = await fixture(t);
  const id = randomUUID();
  const runId = randomUUID();
  await store.begin(id, placement, { runId, eventId: randomUUID() }, input('first'));
  const text = 'あ'.repeat(1024 * 1024);
  const replies = Array.from({ length: 4 }, () => randomUUID());
  for (const reply of replies) store.event(id, { id: reply, runId, type: 'text', text });
  await store.finish(id, { runId, type: 'done', text: 'done', outcome: 'completed' });
  const value = await store.read(id);
  assert.equal(value.earlier, 2);
  assert.equal(value.damaged, 0);
  assert.deepEqual(
    value.events.slice(0, -1).map((event) => event.id),
    replies.slice(1),
  );
  assert.ok(value.events.slice(0, -1).every((event) => event.text === text));
  assert.equal(value.events.at(-1)?.type, 'done');
});

test('Large tool histories open within a bounded heap while their full details stay on disk', async (t) => {
  const { dataDir, store, placement, input, folder } = await fixture(t);
  const id = randomUUID();
  const runId = randomUUID();
  await store.begin(id, placement, { runId, eventId: randomUUID() }, input('first'));
  await store.finish(id, { runId, type: 'done', text: 'done', outcome: 'completed' });
  const file = path.join(folder(id), 'events.jsonl');
  const details = 'x'.repeat(256 * 1024);
  for (let batch = 0; batch < 20; batch++)
    await appendFile(
      file,
      Array.from({ length: 20 }, () =>
        jsonLine(storedLine({ runId, type: 'tool', text: 'tool', details })),
      ).join(''),
    );
  assert.ok((await stat(file)).size > 100 * 1024 * 1024);
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      '--max-old-space-size=64',
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      `import { ConversationStore } from ${JSON.stringify(new URL('../src/agents/conversations.ts', import.meta.url).href)};
       import { DeviceIdentity } from ${JSON.stringify(new URL('../src/host/device.ts', import.meta.url).href)};
       const dataDir = ${JSON.stringify(dataDir)};
       const value = await new ConversationStore(dataDir, new DeviceIdentity(dataDir)).read(${JSON.stringify(id)});
       console.log(JSON.stringify({ count: value.events.length, earlier: value.earlier, damaged: value.damaged,
         details: value.events.filter(event => event.type === 'tool').map(event => event.details.length) }));`,
    ],
    { timeout: 30000 },
  );
  const value = JSON.parse(stdout);
  assert.equal(value.count, 402);
  assert.equal(value.earlier, 0);
  assert.equal(value.damaged, 0);
  assert.deepEqual(value.details, Array(400).fill(viewDetails));
});

test('The irori agent keeps a history per workspace; a hibachi keeps one wherever it is opened', async (t) => {
  const { open, store, owner: hibachi, input } = await fixture(t);
  const you = { kind: 'irori-agent' as const, id: randomUUID(), name: 'irori agent' };
  const [a, b] = [randomUUID(), randomUUID()];
  const yours = (prompt: string, workspace?: string) => ({
    ...input(prompt, { scopeId: you.id, workspace }),
  });
  const inA = { owner: you, agent: 'pi' as const, workspace: a };
  const inB = { ...inA, workspace: b };
  // Conversations made in each workspace, and one from before workspaces were kept.
  const first = store.reserve(you.id, 'pi', a);
  await store.enqueue(first, inA, yours('in a', a));
  const second = randomUUID();
  await store.enqueue(second, { ...inB, create: true }, yours('in b', b));
  const older = randomUUID();
  await store.enqueue(older, { owner: you, agent: 'pi', create: true }, yours('before'));
  const theirs = randomUUID();
  await store.enqueue(theirs, { owner: hibachi, agent: 'pi', create: true }, input('hibachi'));

  const restarted = open();
  const ids = async (workspace?: string) =>
    (await restarted.list(you.id, workspace)).map((row) => row.id);
  assert.deepEqual(await ids(a), [first]);
  assert.deepEqual(await ids(b), [second]);
  assert.deepEqual(await ids(), [older], 'one begun in no workspace stays out of every workspace');
  assert.equal(
    JSON.parse(await readFile(path.join(restarted.folder, first, 'meta.json'), 'utf8')).workspace,
    a,
  );
  assert.equal(await restarted.latest(you.id, 'pi', a), first);
  assert.equal(await restarted.current(you.id, 'pi', b), second);
  assert.equal(await restarted.pending(you.id, a), 1);
  assert.equal((await restarted.nextQueued(you.id, undefined, b))?.conversationId, second);
  assert.equal(restarted.workspaceOf(first), a);
  // A conversation continues only in its own workspace.
  await assert.rejects(restarted.enqueue(first, inB, yours('moved', b)), /別のワークスペース/);
  await assert.rejects(restarted.enqueue(older, inA, yours('moved', a)), /別のワークスペース/);
  // An id reserved in one workspace is not made in another.
  const reserved = restarted.reserve(you.id, 'pi', a);
  await assert.rejects(restarted.enqueue(reserved, inB, yours('x', b)), /ありません/);
  // A hibachi's history is the same whatever workspace is asked for.
  assert.deepEqual(
    (await restarted.list(hibachi.id, a)).map((row) => row.id),
    [theirs],
  );
  assert.equal(await restarted.pending(hibachi.id, b), 1);
});
