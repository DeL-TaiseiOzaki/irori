import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentService, itemStart } from '../src/agents/service';
import { FileService } from '../src/host/files';
import type { AgentEvent } from '../src/domain/types';

/** How many deltas the fixture streams for each of its two replies. */
const deltas = 300;
// A protocol stand-in for Codex's app server: two replies streamed one word at a
// time around a file change. No model, no provider account.
const codexFixture = `#!/usr/bin/env node
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const m = JSON.parse(line);
  if (!m.method || m.id === undefined) return;
  const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
  const result = m.method.startsWith('thread/') ? {thread:{id:'fixture-thread'}}
    : m.method === 'turn/start' ? {turn:{id:'fixture-turn'}} : {};
  send({id:m.id,result});
  if (m.method !== 'turn/start') return;
  const reply = (word) => { for (let n = 0; n < ${deltas}; n++) send({method:'item/agentMessage/delta',params:{delta:word + n + ' '}}); };
  reply('first');
  const item = {type:'fileChange',id:'change-1',status:'inProgress',changes:[{path:'note.md',kind:'update',diff:'--- a\\n+++ b\\n-old\\n+new\\n'}]};
  send({method:'item/started',params:{item}});
  send({method:'item/completed',params:{item:{...item,status:'completed'}}});
  reply('second');
  send({method:'turn/completed',params:{turn:{status:'completed'}}});
});
`;

test(
  'Streamed deltas reach the views a few at a time, in order with the other events, and the history keeps the same words',
  { skip: process.platform === 'win32' && 'POSIX protocol fixture executable', timeout: 30000 },
  async (t) => {
    const base = await mkdtemp(path.join(tmpdir(), 'irori agent stream '));
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
    const events: AgentEvent[] = [];
    let done!: () => void;
    const completed = new Promise<void>((resolve) => {
      done = resolve;
    });
    const service = new AgentService(files, (event) => {
      events.push(event);
      if (event.type === 'done') done();
    });
    t.after(() => service.cancel());
    service.start({ scopeId: space.scopeId, agent: 'codex', prompt: 'Stream fixture' });
    await completed;
    assert.equal(events.at(-1)?.outcome, 'completed', JSON.stringify(events.slice(-3)));
    const expected = (word: string) =>
      Array.from({ length: deltas }, (_, n) => `${word}${n} `).join('');
    const text = events.filter((event) => event.type === 'text');
    assert.ok(text.length < deltas / 4, `${text.length} text events for ${2 * deltas} deltas`);
    // Each reply keeps one id, and nothing of it comes after the event that follows it.
    const tools = events.filter((event) => event.type === 'tool');
    assert.equal(tools.length, 2);
    const before = events.indexOf(tools[0]);
    const first = text.filter((event) => events.indexOf(event) < before);
    const second = text.filter((event) => events.indexOf(event) > events.indexOf(tools[1]));
    assert.equal(first.length + second.length, text.length);
    assert.equal(new Set(first.map((event) => event.id)).size, 1);
    assert.equal(new Set(second.map((event) => event.id)).size, 1);
    assert.equal(first.map((event) => event.text).join(''), expected('first'));
    assert.equal(second.map((event) => event.text).join(''), expected('second'));
    // The started item is stored without the diff its completion carries.
    assert.equal(tools[0].call, 'change-1');
    assert.doesNotMatch(tools[0].details!, /diff/);
    assert.match(tools[0].details!, /"path":"note.md"/);
    assert.match(tools[1].details!, /\+new/);
    assert.equal(tools[1].result, true);
    // The saved conversation holds the same replies, whole.
    const saved = await service.conversation(space.scopeId, 'codex');
    const replies = saved.events.filter((event) => event.type === 'text');
    assert.deepEqual(
      replies.map((event) => event.text),
      [expected('first'), expected('second')],
    );
    assert.deepEqual(
      saved.events.slice(-4).map((event) => event.type),
      ['tool', 'tool', 'text', 'done'],
    );
    assert.equal(saved.events.filter((e) => e.type === 'tool')[0].details?.includes('diff'), false);
  },
);

test('What item/started keeps of an item: everything but its output and diffs', () => {
  assert.deepEqual(
    itemStart({
      type: 'commandExecution',
      id: 'c',
      command: 'ls',
      cwd: '/x',
      aggregatedOutput: 'files',
      formattedOutput: 'files',
      exitCode: 0,
    }),
    { type: 'commandExecution', id: 'c', command: 'ls', cwd: '/x', exitCode: 0 },
  );
  assert.deepEqual(
    itemStart({
      type: 'fileChange',
      id: 'f',
      changes: [{ path: 'a.md', kind: 'add', diff: '+x' }, null],
    }),
    { type: 'fileChange', id: 'f', changes: [{ path: 'a.md', kind: 'add' }, null] },
  );
  assert.deepEqual(
    itemStart({
      type: 'mcpToolCall',
      id: 'm',
      server: 's',
      tool: 't',
      arguments: { a: 1 },
      result: {},
    }),
    { type: 'mcpToolCall', id: 'm', server: 's', tool: 't', arguments: { a: 1 } },
  );
});
