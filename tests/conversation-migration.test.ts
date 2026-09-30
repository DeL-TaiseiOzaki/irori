import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { migrateConversations, migratedId } from '../src/agents/conversation-migration';
import { ConversationStore } from '../src/agents/conversations';
import { sessionKey } from '../src/agents/sessions';
import { DeviceIdentity } from '../src/host/device';
import { conversationMetas } from './fixtures/conversations';

test('Conversations kept before ADR 017 become conversations once, with their events, queue and handle', async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'irori migration '));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const conversations = path.join(dataDir, 'agent-conversations');
  const sessions = path.join(dataDir, 'agent-sessions');
  await mkdir(conversations);
  await mkdir(sessions);
  const hibachi = { scopeId: randomUUID(), agent: 'pi' as const, root: '/work/研究' };
  const you = { scopeId: randomUUID(), agent: 'claude' as const, root: '/home/me/irori/you' };
  const gone = { scopeId: randomUUID(), agent: 'codex' as const, root: '/old/place/archive' };
  const runId = randomUUID();
  const activeRunId = randomUUID();
  const record = (binding: typeof hibachi | typeof you, extra: object = {}) => ({
    schemaVersion: 1,
    ...binding,
    events: [
      { runId, role: 'user', type: 'status', text: '最初の指示' },
      { runId, type: 'text', text: '日本語の返事' },
      { runId, type: 'tool', text: 'read', details: '{"path":"note.md"}' },
      { runId, type: 'done', text: '完了', outcome: 'completed' },
    ],
    queued: [],
    truncated: false,
    ...extra,
  });
  const write = (dir: string, binding: object, value: unknown) =>
    writeFile(
      path.join(dir, `${sessionKey(binding as typeof hibachi)}.json`),
      typeof value === 'string' ? value : JSON.stringify(value),
    );
  const queuedId = randomUUID();
  await write(
    conversations,
    hibachi,
    record(hibachi, {
      truncated: true,
      activeRunId,
      queued: [
        { id: queuedId, prompt: '待っていた指示', notePath: 'a.md', newSession: true },
        { id: randomUUID(), prompt: '二つ目' },
      ],
    }),
  );
  const session = (binding: object, handle: string) => ({
    schemaVersion: 1,
    ...binding,
    handle,
    access: 'full-access',
    updatedAt: new Date().toISOString(),
  });
  await write(sessions, hibachi, session(hibachi, 'pi-handle'));
  await write(conversations, you, record(you));
  // A handle alone, from a checkout no longer registered.
  await write(sessions, gone, session(gone, 'codex-handle'));
  // A damaged record and one filed under another binding's name.
  const damaged = { ...hibachi, agent: 'hermes' as const };
  await write(conversations, damaged, '{broken');
  await writeFile(
    path.join(conversations, `${createHash('sha256').update('elsewhere').digest('hex')}.json`),
    JSON.stringify(record(hibachi)),
  );
  const before = await Promise.all(
    [conversations, sessions].flatMap(async (dir) =>
      Promise.all(
        (await readdir(dir)).map(async (name) => [
          name,
          await readFile(path.join(dir, name), 'utf8'),
        ]),
      ),
    ),
  );
  const device = new DeviceIdentity(dataDir);
  const options = {
    deviceId: () => device.id(),
    youId: you.scopeId,
    spaceName: (scopeId: string) => (scopeId === hibachi.scopeId ? '研究' : undefined),
  };
  const result = await migrateConversations(dataDir, options);
  assert.equal(result?.migrated, 3);
  assert.equal(result?.skipped.length, 2);
  const metas = await conversationMetas(dataDir);
  const deviceId = await device.id();
  const own = metas.find((meta) => meta.owner.id === hibachi.scopeId)!;
  assert.equal(own.id, migratedId(sessionKey(hibachi)));
  assert.deepEqual(own.owner, { kind: 'hibachi', id: hibachi.scopeId, name: '研究' });
  assert.equal(own.title, '以前の会話');
  assert.equal(own.titleSource, 'migration');
  assert.equal(own.agent, 'pi');
  assert.equal(own.native[deviceId].handle, 'pi-handle');
  assert.equal(own.native[deviceId].access, 'full-access');
  assert.equal(own.native[deviceId].root, createHash('sha256').update(hibachi.root).digest('hex'));
  const yours = metas.find((meta) => meta.owner.id === you.scopeId)!;
  assert.deepEqual(yours.owner, { kind: 'irori-agent', id: you.scopeId, name: 'irori agent' });
  assert.deepEqual(yours.native, {});
  const old = metas.find((meta) => meta.owner.id === gone.scopeId)!;
  assert.equal(old.owner.name, 'archive', 'a hibachi no longer registered keeps its folder name');
  assert.equal(old.native[deviceId].handle, 'codex-handle');
  for (const meta of metas) assert.ok(!JSON.stringify(meta).includes('/work/'), 'no local path');

  // The store reads what the migration wrote: the events, the queue and the unconfirmed run.
  const store = new ConversationStore(dataDir, device);
  const read = await store.read(own.id);
  assert.deepEqual(
    read.events.map((event) => [event.role ?? '', event.type, event.text.slice(0, 6)]),
    [
      ['', 'status', 'これより前の'],
      ['user', 'status', '最初の指示'],
      ['', 'text', '日本語の返事'],
      ['', 'tool', 'read'],
      ['', 'done', '完了'],
      ['', 'error', '前回の実行結'],
    ],
  );
  assert.deepEqual(
    read.queued.map((item) => [item.id, item.prompt]),
    [
      [queuedId, '待っていた指示'],
      [read.queued[1].id, '二つ目'],
    ],
  );
  assert.equal(read.activeRunId, undefined, 'a run of the old version is never sent again');
  assert.equal((await store.nextQueued(hibachi.scopeId))?.item.id, queuedId);
  assert.deepEqual(
    (await store.list(hibachi.scopeId)).map((row) => row.id),
    [own.id],
  );
  assert.equal((await store.read(old.id)).events.length, 0);

  // The old files are left as they were.
  const after = await Promise.all(
    [conversations, sessions].flatMap(async (dir) =>
      Promise.all(
        (await readdir(dir)).map(async (name) => [
          name,
          await readFile(path.join(dir, name), 'utf8'),
        ]),
      ),
    ),
  );
  assert.deepEqual(after, before);
  // It runs once; run again after the mark is lost, it adds nothing.
  assert.equal(await migrateConversations(dataDir, options), undefined);
  await rm(path.join(dataDir, 'conversations-migrated.json'));
  assert.equal((await migrateConversations(dataDir, options))?.migrated, 0);
  assert.equal((await conversationMetas(dataDir)).length, 3);
});

test('Without old records the migration only leaves its mark and makes no device id', async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'irori migration empty '));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const result = await migrateConversations(dataDir, {
    deviceId: () => Promise.reject(Error('not needed')),
    spaceName: () => undefined,
  });
  assert.deepEqual(result, { migrated: 0, skipped: [] });
  assert.deepEqual((await readdir(dataDir)).sort(), ['conversations-migrated.json']);
});
