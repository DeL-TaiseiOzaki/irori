import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentService } from '../src/agents/service';
import { FileService } from '../src/host/files';
import { conversationAccess, defaultAgentAccess } from '../src/domain/agent-access';
import { environmentPreferences } from '../src/domain/environment';
import { SettingsService } from '../src/host/settings';
import type { AgentAccess, AgentEvent } from '../src/domain/types';

test('A conversation runs with the access chosen for it, else its last, else standard', () => {
  assert.equal(conversationAccess('claude'), 'default');
  assert.equal(conversationAccess('claude', undefined, 'full-access'), 'full-access');
  assert.equal(conversationAccess('claude', 'default', 'full-access'), 'default');
  assert.equal(conversationAccess('codex', 'full-access', 'default'), 'full-access');
  // Pi takes its own settings only: nothing else is offered or kept for it.
  assert.equal(conversationAccess('pi', 'full-access', 'full-access'), 'default');
  // The settings' choice is where a new conversation starts, and only there.
  assert.equal(conversationAccess('codex', undefined, undefined, 'full-access'), 'full-access');
  assert.equal(conversationAccess('codex', undefined, 'default', 'full-access'), 'default');
  assert.equal(conversationAccess('claude', 'default', undefined, 'full-access'), 'default');
  assert.equal(conversationAccess('pi', undefined, undefined, 'full-access'), 'default');
  assert.equal(defaultAgentAccess('opencode', 'full-access'), 'full-access');
  assert.equal(defaultAgentAccess('opencode'), 'default');
});

test('The device keeps the access new conversations start in, standard until changed', async (t) => {
  const base = await mkdtemp(path.join(tmpdir(), 'irori access setting '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const settings = new SettingsService(base);
  assert.equal((await settings.read()).agentAccess, 'default');
  await settings.save({ agentAccess: 'full-access' });
  assert.equal((await new SettingsService(base).read()).agentAccess, 'full-access');
  // Other choices leave it as it is.
  await settings.save({ vaultAgent: true });
  assert.equal((await settings.read()).agentAccess, 'full-access');
  // It stays on this device: a saved environment does not carry it to another.
  assert.equal((environmentPreferences as readonly string[]).includes('agentAccess'), false);
});

// A protocol stand-in for Codex's app server that notes the approval policy of each
// thread it is asked for. No model, no provider account.
const codexFixture = `#!/usr/bin/env node
const fs = require('node:fs');
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const m = JSON.parse(line);
  if (!m.method || m.id === undefined) return;
  if (m.method.startsWith('thread/'))
    fs.appendFileSync('threads.jsonl', JSON.stringify([m.method, m.params.approvalPolicy]) + '\\n');
  const result = m.method.startsWith('thread/') ? {thread:{id:m.params.threadId || 'fixture-thread'}}
    : m.method === 'turn/start' ? {turn:{id:'fixture-turn'}} : {};
  send({id:m.id,result});
  if (m.method === 'turn/start') send({method:'turn/completed',params:{turn:{status:'completed'}}});
});
`;

test(
  'The host keeps the access each conversation last ran with, across a restart',
  { skip: process.platform === 'win32' && 'POSIX protocol fixture executable', timeout: 30000 },
  async (t) => {
    const base = await mkdtemp(path.join(tmpdir(), 'irori conversation access '));
    const previous = process.env.PATH;
    t.after(async () => {
      process.env.PATH = previous;
      await rm(base, { recursive: true, force: true });
    });
    const bin = path.join(base, 'bin');
    const root = path.join(base, 'KB');
    await mkdir(bin);
    await mkdir(root);
    await writeFile(path.join(bin, 'codex'), codexFixture, { mode: 0o700 });
    process.env.PATH = bin + path.delimiter + previous;
    const files = new FileService(path.join(base, 'device'));
    await files.init();
    const space = await files.register(root, 'KB', 'personal');
    /** One host, as after each start of irori. */
    function host() {
      const ended = new Map<string, () => void>();
      const service = new AgentService(files, (event: AgentEvent) => {
        if (event.type === 'done') ended.get(event.runId)?.();
      });
      t.after(() => service.cancel());
      return {
        service,
        async run(conversationId: string, access: AgentAccess) {
          const done = new Promise<void>((resolve) => {
            const runId = service.start({
              scopeId: space.scopeId,
              agent: 'codex',
              conversationId,
              access,
              prompt: 'Protocol fixture only',
            });
            ended.set(runId, resolve);
          });
          await done;
        },
      };
    }
    const first = host();
    const full = first.service.createConversation(space.scopeId, 'codex');
    const standard = first.service.createConversation(space.scopeId, 'codex');
    // Not begun: nothing is kept, and the composer offers the standard access.
    assert.equal(
      (await first.service.conversation(space.scopeId, 'codex', full)).access,
      undefined,
    );
    await first.run(full, 'full-access');
    await first.run(standard, 'default');
    await first.run(full, 'full-access');
    const again = host();
    assert.equal(
      (await again.service.conversation(space.scopeId, 'codex', full)).access,
      'full-access',
    );
    assert.equal(
      (await again.service.conversation(space.scopeId, 'codex', standard)).access,
      'default',
    );
    // Each conversation's own native session goes on in its own access.
    const threads = (await readFile(path.join(root, 'threads.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line).join(':'));
    assert.deepEqual(threads, [
      'thread/start:never',
      'thread/start:on-request',
      'thread/resume:never',
    ]);
  },
);
