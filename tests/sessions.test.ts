import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SessionStore } from '../src/agents/sessions';
import { AgentService } from '../src/agents/service';
import { FileService } from '../src/host/files';
import type { AgentEvent } from '../src/domain/types';

test('Session handles survive restart and remain isolated by scope, provider and checkout', async (t) => {
  const base = await mkdtemp(path.join(tmpdir(), 'irori sessions '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const binding = { scopeId: randomUUID(), agent: 'codex' as const, root: path.join(base, 'KB') };
  const store = new SessionStore(base);
  await store.save(binding, 'native-session-one');
  const restarted = new SessionStore(base);
  assert.equal((await restarted.read(binding))?.handle, 'native-session-one');
  for (const other of [
    { ...binding, scopeId: randomUUID() },
    { ...binding, agent: 'claude' as const },
    { ...binding, root: path.join(base, 'copied-KB') },
  ])
    assert.equal(await restarted.read(other), undefined);
  const claude = { ...binding, agent: 'claude' as const };
  await restarted.save(claude, 'native-session-two');
  await restarted.reset(binding);
  assert.equal((await new SessionStore(base).status(binding)).state, 'empty');
  assert.equal((await restarted.read(claude))?.handle, 'native-session-two');
  assert.deepEqual(Object.keys(await restarted.status(claude)).sort(), ['state', 'updatedAt']);
});

test('Malformed or mismatched session records fail closed and can be explicitly reset', async (t) => {
  const base = await mkdtemp(path.join(tmpdir(), 'irori sessions damaged '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const binding = { scopeId: randomUUID(), agent: 'claude' as const, root: base };
  const store = new SessionStore(base);
  await store.save(binding, 'native-session');
  const filename = path.join(
    base,
    'agent-sessions',
    (await readdir(path.join(base, 'agent-sessions')))[0],
  );
  const original = JSON.parse(await readFile(filename, 'utf8'));
  for (const bytes of [
    '{broken',
    JSON.stringify({ ...original, root: 'another-checkout' }),
    'x'.repeat(32769),
  ]) {
    await writeFile(filename, bytes);
    assert.equal((await store.status(binding)).state, 'unavailable');
    await assert.rejects(store.read(binding), /リセット/);
  }
  await store.reset(binding);
  assert.equal((await store.status(binding)).state, 'empty');
  await store.save(binding, 'replacement-session');
  assert.equal((await store.read(binding))?.handle, 'replacement-session');
});

// This executable is a protocol fixture, not a native-provider acceptance test.
test(
  'Codex adapter resumes persisted handles, preserves failed resumes and resets explicitly',
  {
    skip: process.platform === 'win32' ? 'POSIX protocol fixture executable' : false,
    timeout: 20000,
  },
  async (t) => {
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
    await writeFile(
      path.join(bin, 'codex'),
      `#!/usr/bin/env node
const fs = require('node:fs');
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const m = JSON.parse(line);
  if (!m.method || m.id === undefined) return;
  fs.appendFileSync('protocol.jsonl', JSON.stringify(m) + '\\n');
  const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
  if (m.method === 'thread/resume' && fs.existsSync('fail-resume')) {
    send({id:m.id,error:{code:-1,message:'Fixture session no longer exists'}}); return;
  }
  const result = m.method.startsWith('thread/') ? {thread:{id:m.params.threadId || 'fixture-native-handle'}}
    : m.method === 'turn/start' ? {turn:{id:'fixture-turn'}} : {};
  send({id:m.id,result});
  if (m.method === 'turn/start') send({method:'turn/completed',params:{turn:{status:'completed'}}});
});
`,
      { mode: 0o700 },
    );
    process.env.PATH = bin + path.delimiter + oldPath;
    const files = new FileService(path.join(base, 'device'));
    await files.init();
    const space = await files.register(root, 'KB', 'personal');
    const input = {
      scopeId: space.scopeId,
      agent: 'codex' as const,
      prompt: 'Protocol fixture only',
    };
    async function run(newSession = false) {
      const events: AgentEvent[] = [];
      let done!: () => void;
      const completed = new Promise<void>((resolve) => {
        done = resolve;
      });
      const service = new AgentService(files, (event) => {
        events.push(event);
        if (event.type === 'done') done();
      });
      service.start({ ...input, newSession });
      await assert.rejects(service.resetSession(space.scopeId, 'codex'), /停止/);
      await completed;
      assert.equal(service.busy, false);
      return { service, events };
    }
    assert.equal((await run()).events.at(-1)?.outcome, 'completed');
    assert.equal((await run()).events.at(-1)?.outcome, 'completed');
    let calls = (await readFile(path.join(root, 'protocol.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      calls.filter((m) => m.method.startsWith('thread/')).map((m) => m.method),
      ['thread/start', 'thread/resume'],
    );
    assert.equal(
      calls.find((m) => m.method === 'thread/resume').params.threadId,
      'fixture-native-handle',
    );
    await writeFile(path.join(root, 'fail-resume'), '');
    const failed = await run();
    assert.equal(failed.events.at(-1)?.outcome, 'failed');
    assert.ok(failed.events.some((e) => e.type === 'error' && e.text.includes('リセット')));
    assert.equal((await failed.service.session(space.scopeId, 'codex')).state, 'saved');
    calls = (await readFile(path.join(root, 'protocol.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(calls.filter((m) => m.method === 'thread/start').length, 1);
    assert.equal(calls.filter((m) => m.method === 'turn/start').length, 2);
    assert.equal((await run(true)).events.at(-1)?.outcome, 'completed');
    await failed.service.resetSession(space.scopeId, 'codex');
    assert.equal((await failed.service.session(space.scopeId, 'codex')).state, 'empty');
  },
);
