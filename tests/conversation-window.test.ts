import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import {
  appendFile,
  mkdtemp,
  open as openFile,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { ConversationStore, jsonLine, storedLine } from '../src/agents/conversations';
import { DeviceIdentity } from '../src/host/device';
import type { StartRun } from '../src/domain/types';

async function fixture(t: TestContext) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'irori conversation window '));
  const open = () => new ConversationStore(dataDir, new DeviceIdentity(dataDir));
  const store = open();
  const owner = { kind: 'hibachi' as const, id: randomUUID(), name: 'KB' };
  const placement = { owner, agent: 'pi' as const, create: true };
  const input = (prompt: string): StartRun => ({ scopeId: owner.id, agent: 'pi', prompt });
  const id = randomUUID();
  const runId = randomUUID();
  await store.begin(id, placement, { runId, eventId: randomUUID() }, input('first'));
  await store.finish(id, { runId, type: 'done', text: 'done', outcome: 'completed' });
  const file = path.join(dataDir, 'conversations', id, 'events.jsonl');
  t.after(async () => {
    await store.flush();
    await rm(dataDir, { recursive: true, force: true });
  });
  return { store, open, id, runId, file, placement, input };
}

test('Events before the view window are counted without being parsed: a reply written in lines is one, a broken line is damaged', async (t) => {
  const { open, id, runId, file } = await fixture(t);
  // Before the window: a reply flushed in five lines, a tool, a broken line, a cut line.
  const reply = randomUUID();
  const early = [
    ...Array.from({ length: 5 }, (_, n) =>
      jsonLine(storedLine({ id: reply, runId, type: 'text', text: `part ${n} ` })),
    ),
    jsonLine(storedLine({ runId, type: 'tool', text: 'early tool' })),
    '{broken}\n',
    '{"id":"cut off\n',
    '\n',
  ].join('');
  await appendFile(file, early);
  // The window: 1000 tools, the last of them after another broken line.
  const windowLines = Array.from({ length: 1000 }, (_, n) =>
    jsonLine(storedLine({ runId, type: 'tool', text: `tool ${n}` })),
  );
  windowLines.splice(999, 0, 'not json\n');
  await appendFile(file, windowLines.join(''));
  const value = await open().read(id);
  assert.equal(value.events.length, 1000);
  assert.equal(value.events[0].text, 'tool 0');
  assert.equal(value.events.at(-1)?.text, 'tool 999');
  // first, done, the reply (one event of five lines), early tool.
  assert.equal(value.earlier, 4);
  assert.equal(value.damaged, 3, 'two before the window, one inside it');
});

test('Streamed text crossing the window edge stays one whole event, and the byte limit is met as from the start', async (t) => {
  const { store, open, id, runId, file, placement, input } = await fixture(t);
  const reply = randomUUID();
  const lines = [
    jsonLine(storedLine({ runId, type: 'tool', text: 'before' })),
    ...Array.from({ length: 3 }, (_, n) =>
      jsonLine(storedLine({ id: reply, runId, type: 'text', text: `${n}` })),
    ),
    ...Array.from({ length: 999 }, (_, n) =>
      jsonLine(storedLine({ runId, type: 'tool', text: `tool ${n}` })),
    ),
  ];
  await appendFile(file, lines.join(''));
  let value = await open().read(id);
  assert.equal(value.events.length, 1000);
  assert.equal(value.events[0].id, reply);
  assert.equal(value.events[0].text, '012', 'all of its lines, though the window began among them');
  assert.equal(value.earlier, 3);
  // A later turn moves the window on by what it adds, and the count follows.
  const next = randomUUID();
  await store.begin(id, placement, { runId: next, eventId: randomUUID() }, input('again'));
  store.event(id, { runId: next, type: 'text', text: 'あ'.repeat(2 * 1024 * 1024) });
  store.event(id, { runId: next, type: 'text', text: 'い'.repeat(2 * 1024 * 1024) });
  await store.finish(id, { runId: next, type: 'done', text: 'done', outcome: 'completed' });
  value = await store.read(id);
  // Two 6 MiB replies: the older one crosses the limit and stays; everything before it is earlier.
  assert.deepEqual(
    value.events.map((event) => event.type),
    ['text', 'text', 'done'],
  );
  assert.equal(value.events[0].text.length, 2 * 1024 * 1024);
  assert.equal(value.earlier, 3 + 1 + 999 + 1, 'first, done, before, reply, 999 tools, again');
  assert.equal(value.damaged, 0);
});

test('A second read of a long history counts only what was written since', async (t) => {
  const { store, open, id, runId, file } = await fixture(t);
  const prefix = Array.from({ length: 3000 }, (_, n) =>
    jsonLine(storedLine({ runId, type: 'tool', text: `old ${n}` })),
  ).join('');
  await appendFile(file, prefix);
  const first = await store.read(id);
  assert.equal(first.earlier, 2002);
  assert.equal(first.damaged, 0);
  // Prove the older lines are not read again: once counted, their bytes are overwritten in place.
  const handle = await openFile(file, 'r+');
  try {
    await handle.write(Buffer.alloc(Buffer.byteLength(prefix) / 2, 0x78), 0, undefined, 0);
  } finally {
    await handle.close();
  }
  await appendFile(file, jsonLine(storedLine({ runId, type: 'tool', text: 'new' })));
  const second = await store.read(id);
  assert.equal(second.earlier, 2003);
  assert.equal(second.damaged, 0);
  assert.equal(second.events.at(-1)?.text, 'new');
  // A fresh store has no count yet and sees the file as it is now.
  const fresh = await open().read(id);
  assert.ok(fresh.damaged >= 1);
  assert.equal(fresh.events.at(-1)?.text, 'new');
});

test('A line over the limit before or inside the window is one damaged line, and a file cut mid-line still opens', async (t) => {
  const { open, id, runId, file } = await fixture(t);
  await appendFile(file, '{"id":"' + 'x'.repeat(9 * 1024 * 1024) + '"}\n');
  await appendFile(file, jsonLine(storedLine({ runId, type: 'tool', text: 'after' })));
  await appendFile(file, '{"id":"half');
  const value = await open().read(id);
  assert.deepEqual(
    value.events.map((event) => event.text),
    ['first', 'done', 'after'],
  );
  assert.equal(value.damaged, 2);
  assert.equal(value.earlier, 0);
  assert.ok((await stat(file)).size > 9 * 1024 * 1024);
  assert.equal(
    (await readFile(file, 'utf8')).endsWith('{"id":"half'),
    true,
    'nothing is rewritten',
  );
});

test('A reply split between the file and the unwritten lines is one earlier event, now and after it is written', async (t) => {
  const { store, id, runId } = await fixture(t);
  const reply = randomUUID();
  store.event(id, { id: reply, runId, type: 'text', text: 'on disk ' });
  await store.flush();
  store.event(id, { id: reply, runId, type: 'text', text: 'and buffered' });
  for (let n = 0; n < 1000; n++) store.event(id, { runId, type: 'tool', text: `tool ${n}` });
  // Read before the buffer is written: the window is the buffered tools alone.
  let value = await store.read(id);
  assert.equal(value.events.length, 1000);
  assert.equal(value.events[0].text, 'tool 0');
  assert.equal(value.earlier, 3, 'first, done, the reply');
  await store.flush();
  store.event(id, { runId, type: 'tool', text: 'one more' });
  await store.flush();
  value = await store.read(id);
  assert.equal(value.events[0].text, 'tool 1');
  assert.equal(value.earlier, 4, 'first, done, the reply once, tool 0');
  assert.equal(value.damaged, 0);
});

test('Lines ending in CRLF before the window count as events', async (t) => {
  const { open, id, runId, file } = await fixture(t);
  const early = Array.from({ length: 3 }, (_, n) =>
    jsonLine(storedLine({ runId, type: 'tool', text: `crlf ${n}` })).replace(/\n$/, '\r\n'),
  ).join('');
  await appendFile(file, early);
  await appendFile(
    file,
    Array.from({ length: 1000 }, (_, n) =>
      jsonLine(storedLine({ runId, type: 'tool', text: `tool ${n}` })),
    ).join(''),
  );
  const value = await open().read(id);
  assert.equal(value.earlier, 5);
  assert.equal(value.damaged, 0);
});

test('A run cut short by a crash is recovered even when its message line was cut after its id', async (t) => {
  const { store, open, id, file, placement, input } = await fixture(t);
  const runId = randomUUID();
  const eventId = randomUUID();
  await store.begin(id, placement, { runId, eventId }, input('the instruction that was cut'));
  // The crash left the message's line without its end, its id intact.
  const text = await readFile(file, 'utf8');
  const cut = text.lastIndexOf('"text"');
  assert.ok(cut > text.lastIndexOf(eventId));
  await writeFile(file, text.slice(0, cut + 20));
  const value = await open().read(id);
  assert.equal(value.activeRunId, undefined, 'the claim is cleared');
  assert.equal(value.damaged, 1);
  const user = value.events.filter((event) => event.role === 'user');
  assert.deepEqual(
    user.map((event) => event.text),
    ['first', 'the instruction that was cut'],
    'the message comes back from the claim',
  );
  assert.equal(user[1].id, eventId);
  assert.equal(value.events.at(-1)?.type, 'error');
});
