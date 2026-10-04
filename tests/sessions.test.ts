import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentService } from '../src/agents/service';
import { FileService } from '../src/host/files';
import { DeviceIdentity } from '../src/host/device';
import type { AgentAccess, AgentEvent } from '../src/domain/types';
import { conversationMetas, deviceId } from './fixtures/conversations';

test('The device id is made once and a damaged one is never replaced', async (t) => {
  const base = await mkdtemp(path.join(tmpdir(), 'irori device '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const id = await new DeviceIdentity(base).id();
  assert.equal(await new DeviceIdentity(base).id(), id);
  await writeFile(path.join(base, 'device.json'), '{broken');
  await assert.rejects(new DeviceIdentity(base).id(), /device\.json/);
  assert.equal(await readFile(path.join(base, 'device.json'), 'utf8'), '{broken');
});

// This executable is a protocol fixture, not a native-provider acceptance test.
const codexFixture = `#!/usr/bin/env node
const fs = require('node:fs');
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const m = JSON.parse(line);
  if (!m.method || m.id === undefined) return;
  fs.appendFileSync('protocol.jsonl', JSON.stringify(m) + '\\n');
  const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
  if (m.method === 'thread/resume' && fs.existsSync('fail-resume')) {
    send({id:m.id,error:{code:-1,message:'Fixture session no longer exists'}}); return;
  }
  const result = m.method.startsWith('thread/') ? {thread:{id:m.params.threadId || 'fixture-native-' + Date.now()}}
    : m.method === 'turn/start' ? {turn:{id:'fixture-turn'}} : {};
  send({id:m.id,result});
  if (m.method === 'turn/start') {
    send({method:'item/started',params:{item:{type:'commandExecution',id:'item-1',command:'ls'}}});
    send({method:'item/completed',params:{item:{type:'commandExecution',id:'item-1',command:'ls',aggregatedOutput:'note.md'}}});
    send({method:'turn/completed',params:{turn:{status:'completed'}}});
  }
});
`;

async function codex(t: TestContext) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori session transport '));
  const oldPath = process.env.PATH;
  t.after(async () => {
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
    await rm(base, { recursive: true, force: true });
  });
  const bin = path.join(base, 'bin');
  const root = path.join(base, 'KB');
  await mkdir(bin);
  await mkdir(root);
  await writeFile(path.join(bin, 'codex'), codexFixture, { mode: 0o700 });
  process.env.PATH = bin + path.delimiter + oldPath;
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const space = await files.register(root, 'KB', 'personal');
  /** One run by a new host; `fresh` runs it in a new conversation. */
  async function run(access: AgentAccess = 'default', fresh = false) {
    const events: AgentEvent[] = [];
    let done!: () => void;
    const completed = new Promise<void>((resolve) => {
      done = resolve;
    });
    const service = new AgentService(files, (event) => {
      events.push(event);
      if (event.type === 'done') done();
    });
    service.start({
      scopeId: space.scopeId,
      agent: 'codex',
      prompt: 'Protocol fixture only',
      access,
      conversationId: fresh ? service.createConversation(space.scopeId, 'codex') : undefined,
    });
    await completed;
    assert.equal(service.busy(space.scopeId), false);
    return {
      service,
      events,
      conversationId: events.find((e) => e.conversationId)?.conversationId,
    };
  }
  const threads = async () =>
    (await readFile(path.join(root, 'protocol.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .filter((m) => m.method.startsWith('thread/'))
      .map((m) => [m.method, m.params.sandbox]);
  return { base, root, files, space, run, threads };
}

test(
  'A conversation resumes its native session only with the same access, and a failed resume starts the next turn afresh',
  { skip: process.platform === 'win32' && 'POSIX protocol fixture executable', timeout: 30000 },
  async (t) => {
    const { root, files, space, run, threads } = await codex(t);
    const first = await run();
    assert.equal(first.events.at(-1)?.outcome, 'completed');
    // The command's output is kept as the result of its call.
    const result = first.events.find((e) => e.type === 'tool' && e.result);
    assert.equal(result?.call, 'item-1');
    assert.match(result?.details ?? '', /aggregatedOutput/);
    const second = await run();
    assert.equal(second.conversationId, first.conversationId, 'the latest conversation goes on');
    assert.ok(second.events.some((e) => e.text === '保存済みのセッションを引き継ぎます。'));
    // A change of access starts a new native session in the same conversation (ADR 009).
    const full = await run('full-access');
    assert.equal(full.conversationId, first.conversationId);
    assert.ok(full.events.some((e) => e.text.includes('アクセス設定が変わったため')));
    assert.equal(
      (await full.service.conversation(space.scopeId, 'codex')).session.access,
      'full-access',
    );
    assert.deepEqual(await threads(), [
      ['thread/start', 'workspace-write'],
      ['thread/resume', 'workspace-write'],
      ['thread/start', 'danger-full-access'],
    ]);
    await writeFile(path.join(root, 'fail-resume'), '');
    const failed = await run('full-access');
    assert.equal(failed.events.at(-1)?.outcome, 'failed');
    assert.ok(failed.events.some((e) => e.type === 'error' && e.text.includes('新しいセッション')));
    assert.equal(
      (await failed.service.conversation(space.scopeId, 'codex')).session.state,
      'empty',
    );
    const fresh = await run('full-access');
    assert.equal(fresh.events.at(-1)?.outcome, 'completed');
    assert.equal((await threads()).at(-1)?.[0], 'thread/start');
    // A new conversation never continues another's native session.
    const other = await run('full-access', true);
    assert.notEqual(other.conversationId, first.conversationId);
    assert.equal((await threads()).at(-1)?.[0], 'thread/start');
    const metas = await conversationMetas(files.dataDir);
    assert.equal(metas.length, 2);
    assert.ok(metas.every((meta) => Object.keys(meta.native).length === 1));
  },
);

test(
  'Opened on another device or in another checkout, a conversation starts a new native session and keeps the other handle',
  { skip: process.platform === 'win32' && 'POSIX protocol fixture executable', timeout: 30000 },
  async (t) => {
    const { files, space, run, threads } = await codex(t);
    const first = await run();
    const one = await deviceId(files.dataDir);
    const [before] = await conversationMetas(files.dataDir);
    const handle = before.native[one];
    assert.ok(handle?.handle);
    assert.match(handle.root, /^[0-9a-f]{64}$/);
    assert.ok(!JSON.stringify(before).includes(space.root), 'no local path in the conversation');
    // The same data read by another device: a new id, the same conversations folder.
    const two = randomUUID();
    await writeFile(
      path.join(files.dataDir, 'device.json'),
      JSON.stringify({ schemaVersion: 1, id: two }),
    );
    const elsewhere = await run();
    assert.equal(elsewhere.conversationId, first.conversationId);
    assert.ok(elsewhere.events.some((e) => e.text === 'この端末では新しいセッションで続けます。'));
    assert.equal((await threads()).at(-1)?.[0], 'thread/start');
    const [after] = await conversationMetas(files.dataDir);
    assert.deepEqual(after.native[one], handle, 'the first device keeps its handle');
    assert.ok(after.native[two]?.handle);
    // The checkout moved: the handle is not resumed there.
    after.native[two].root = '0'.repeat(64);
    await writeFile(
      path.join(files.dataDir, 'conversations', after.id, 'meta.json'),
      JSON.stringify(after),
    );
    const moved = await run();
    assert.ok(moved.events.some((e) => e.text.includes('別のフォルダ')));
    assert.equal((await threads()).at(-1)?.[0], 'thread/start');
    // A damaged device id stops runs with the reason, and is left as it is.
    await writeFile(path.join(files.dataDir, 'device.json'), '{broken');
    const refused = await run();
    assert.equal(refused.events.at(-1)?.outcome, 'failed');
    assert.ok(refused.events.some((e) => e.type === 'error' && e.text.includes('device.json')));
  },
);

test(
  "A hibachi's local folders become Codex writable roots in standard access only",
  { skip: process.platform === 'win32' && 'POSIX protocol fixture executable', timeout: 30000 },
  async (t) => {
    const { root, files, run } = await codex(t);
    const folder = path.join(root, '..', 'Synced');
    files.cloud = {
      resolve: async () => folder,
      rootEntries: async () => undefined,
      localFolders: () => [folder],
      linkedPaths: () => ['contents/Synced'],
    };
    await run('default', true);
    await run('full-access', true);
    // Each request names where the folder appears, since searches skip the link.
    const requests = (await readFile(path.join(root, 'protocol.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .filter((m) => m.method === 'turn/start')
      .map((m) => JSON.stringify(m.params));
    assert.equal(requests.length, 2);
    for (const request of requests) {
      assert.match(request, /connected folders in this hibachi's contents: \\"contents\/Synced\\"/);
      assert.match(request, /rg -L/);
    }
    const starts = (await readFile(path.join(root, 'protocol.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .filter((m) => m.method === 'thread/start')
      .map((m) => m.params.config);
    assert.deepEqual(starts, [{ 'sandbox_workspace_write.writable_roots': [folder] }, undefined]);
  },
);
