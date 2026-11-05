import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentService } from '../src/agents/service';
import { MessageChannel, Steering } from '../src/agents/steering';
import { FileService } from '../src/host/files';
import type { AgentEvent, AgentId } from '../src/domain/types';

// Protocol stand-ins only: no model, no provider account. A turn whose words hold
// "quick" ends at once; any other works until words reach it or it is stopped.
const codexFixture = `#!/usr/bin/env node
const fs = require('node:fs');
let turns = 0;
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const m = JSON.parse(line);
  if (!m.method || m.id === undefined) return;
  fs.appendFileSync('protocol.jsonl', JSON.stringify(m) + '\\n');
  if (m.method === 'turn/steer') {
    if (fs.existsSync('refuse-steer')) {
      send({id:m.id,error:{code:-32600,message:'no active turn to steer'}});
      return;
    }
    send({id:m.id,result:{turnId:m.params.expectedTurnId}});
    // The turn takes the words at its next step and goes on with them.
    setTimeout(() => {
      send({method:'item/agentMessage/delta',params:{delta:'heard: ' + m.params.input[0].text}});
      send({method:'turn/completed',params:{turn:{status:'completed'}}});
    }, 30);
    return;
  }
  const result = m.method.startsWith('thread/') ? {thread:{id:'fixture-thread'}}
    : m.method === 'turn/start' ? {turn:{id:'turn-' + (++turns)}} : {};
  send({id:m.id,result});
  if (m.method !== 'turn/start') return;
  send({method:'item/agentMessage/delta',params:{delta:'working'}});
  if (m.params.input.at(-1).text.includes('quick'))
    send({method:'turn/completed',params:{turn:{status:'completed'}}});
});
`;

// Claude Code's stream-json side: the request starts a turn that waits; words that
// arrive while it works join it, as Claude Code takes them at its next step.
const claudeFixture = `#!/usr/bin/env node
const fs = require('node:fs');
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
const log = value => fs.appendFileSync('claude-fixture.jsonl', JSON.stringify(value) + '\\n');
let users = 0;
const assistant = text => send({type:'assistant',parent_tool_use_id:null,session_id:'fixture-session',
  message:{id:'msg-' + users,type:'message',role:'assistant',model:'fixture',content:[{type:'text',text}],
  stop_reason:null,stop_sequence:null,usage:{}}});
const result = () => send({type:'result',subtype:'success',result:'done',is_error:false,
  session_id:'fixture-session',duration_ms:1,duration_api_ms:0,num_turns:1,total_cost_usd:0,usage:{},
  modelUsage:{},permission_denials:[]});
const lines = require('node:readline').createInterface({input:process.stdin});
lines.on('line', line => {
  const m = JSON.parse(line);
  if (m.type === 'control_request') {
    send({type:'control_response',response:{subtype:'success',request_id:m.request_id,response:{}}});
    return;
  }
  if (m.type !== 'user') return;
  const text = m.message.content.map(part => part.text ?? '').join('');
  log({text, priority: m.priority});
  if (++users === 1) {
    send({type:'system',subtype:'init',session_id:'fixture-session'});
    assistant('working');
    if (text.includes('quick')) result();
    return;
  }
  setTimeout(() => { assistant('heard: ' + text); result(); }, 30);
});
lines.on('close', () => { log({closed: true}); process.exit(0); });
`;

async function setup(t: TestContext) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori send now '));
  const previous = process.env.PATH;
  t.after(async () => {
    process.env.PATH = previous;
    await rm(base, { recursive: true, force: true });
  });
  const bin = path.join(base, 'bin');
  const root = path.join(base, 'KB');
  await mkdir(bin);
  await mkdir(path.join(root, 'Knowledge_Base'), { recursive: true });
  await writeFile(path.join(root, 'Knowledge_Base', 'other.md'), '# Other\n');
  await writeFile(path.join(bin, 'codex'), codexFixture, { mode: 0o700 });
  await writeFile(path.join(bin, 'claude'), claudeFixture, { mode: 0o700 });
  process.env.PATH = bin + path.delimiter + previous;
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const space = await files.register(root, 'KB', 'personal');
  const events: AgentEvent[] = [];
  const ended = new Map<string, (event: AgentEvent) => void>();
  const endings = new Map<string, Promise<AgentEvent>>();
  const end = (runId: string) => {
    if (!endings.has(runId))
      endings.set(runId, new Promise((resolve) => ended.set(runId, resolve)));
    return endings.get(runId)!;
  };
  const service = new AgentService(files, (event) => {
    events.push(event);
    if (event.type === 'done') {
      end(event.runId);
      ended.get(event.runId)!(event);
    }
  });
  t.after(() => service.cancel());
  /** Resolves once the run has said its first words: its turn is under way. */
  async function underWay(runId: string) {
    while (!events.some((event) => event.runId === runId && event.type === 'text'))
      await new Promise((resolve) => setTimeout(resolve, 5));
  }
  /** Starts a run that keeps working, and names its conversation. */
  async function working(agent: AgentId, prompt = 'First request', conversationId?: string) {
    const runId = await service.startAccepted({
      scopeId: space.scopeId,
      agent,
      prompt,
      conversationId,
    });
    await underWay(runId);
    return {
      runId,
      conversationId: conversationId ?? (await service.conversation(space.scopeId, agent)).id!,
    };
  }
  const queue = (agent: AgentId, conversationId: string, prompt: string, extra = {}) =>
    service.queueMessage({ scopeId: space.scopeId, agent, conversationId, prompt, ...extra });
  const lines = async (file: string) =>
    (await readFile(path.join(root, file), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
  return { root, files, space, service, events, end, working, queue, lines };
}

test(
  'Codex: an instruction sent now joins the turn in progress with turn/steer, ahead of the queue',
  { skip: process.platform === 'win32' && 'POSIX protocol fixture executable', timeout: 30000 },
  async (t) => {
    const { space, service, events, end, working, queue, lines } = await setup(t);
    const { runId, conversationId } = await working('codex');
    await queue('codex', conversationId, 'Waits its turn');
    const later = await queue('codex', conversationId, 'Also look at the other note', {
      notePath: 'Knowledge_Base/other.md',
    });
    const sent = await service.sendNow(space.scopeId, conversationId, later[1].id);
    assert.equal(sent.steered, true);
    assert.equal(sent.runId, runId);
    assert.deepEqual(
      sent.queued.map((item) => item.prompt),
      ['Waits its turn'],
    );
    assert.equal((await end(runId)).outcome, 'completed');
    const protocol = await lines('protocol.jsonl');
    assert.equal(protocol.filter((m) => m.method === 'turn/start').length, 1);
    const [steer] = protocol.filter((m) => m.method === 'turn/steer');
    assert.equal(steer.params.threadId, 'fixture-thread');
    assert.equal(steer.params.expectedTurnId, 'turn-1');
    // The note now open is named, as with a request of its own, then the person's words.
    assert.match(steer.params.input[0].text, /Knowledge_Base\/other\.md/);
    assert.match(steer.params.input[0].text, /Also look at the other note$/);
    // The view and the history show the words where the run took them, in the same run.
    const own = events.filter((event) => event.runId === runId);
    const said = own.findIndex((event) => event.role === 'user' && event.text.startsWith('Also'));
    assert.ok(said > 0);
    assert.ok(own.slice(said).some((event) => event.text.startsWith('heard: ')));
    assert.equal(own.filter((event) => event.type === 'done').length, 1);
    const saved = await service.conversation(space.scopeId, 'codex', conversationId);
    assert.deepEqual(
      saved.events.filter((event) => event.role === 'user').map((event) => event.text),
      ['First request', 'Also look at the other note'],
    );
    assert.deepEqual(
      saved.queued.map((item) => item.prompt),
      ['Waits its turn'],
    );
  },
);

test(
  'Claude Code: an instruction sent now goes to the CLI mid-turn with priority next',
  { skip: process.platform === 'win32' && 'POSIX protocol fixture executable', timeout: 30000 },
  async (t) => {
    const { space, service, end, working, queue, lines } = await setup(t);
    const { runId, conversationId } = await working('claude');
    const queued = await queue('claude', conversationId, 'Use shorter headings');
    const sent = await service.sendNow(space.scopeId, conversationId, queued[0].id);
    assert.equal(sent.steered, true);
    assert.equal(sent.runId, runId);
    assert.deepEqual(sent.queued, []);
    assert.equal((await end(runId)).outcome, 'completed');
    const seen = await lines('claude-fixture.jsonl');
    assert.equal(seen.length, 3);
    assert.match(seen[0].text, /First request$/);
    assert.equal(seen[0].priority, undefined);
    assert.deepEqual(seen[1], { text: 'Use shorter headings', priority: 'next' });
    // Once the turn's result came, the input closed and the CLI ended.
    assert.deepEqual(seen[2], { closed: true });
    const saved = await service.conversation(space.scopeId, 'claude', conversationId);
    assert.deepEqual(
      saved.events.filter((event) => event.role === 'user').map((event) => event.text),
      ['First request', 'Use shorter headings'],
    );
    assert.deepEqual(
      saved.events.filter((event) => event.type === 'text').map((event) => event.text),
      ['working', 'heard: Use shorter headings'],
    );
  },
);

test(
  'An instruction the run cannot take stops it and starts at once; a refused steer does too',
  { skip: process.platform === 'win32' && 'POSIX protocol fixture executable', timeout: 30000 },
  async (t) => {
    const { root, space, service, end, working, queue, lines } = await setup(t);
    // Another model than the run's goes in a request of its own.
    const first = await working('codex');
    await queue('codex', first.conversationId, 'Waits its turn');
    const other = await queue('codex', first.conversationId, 'quick, on another model', {
      model: 'gpt-fixture',
    });
    const sent = await service.sendNow(space.scopeId, first.conversationId, other[1].id);
    assert.equal(sent.steered, false);
    assert.ok(sent.runId && sent.runId !== first.runId);
    assert.equal((await end(first.runId)).outcome, 'cancelled');
    assert.equal((await end(sent.runId!)).outcome, 'completed');
    assert.deepEqual(
      sent.queued.map((item) => item.prompt),
      ['Waits its turn'],
    );
    const starts = (await lines('protocol.jsonl')).filter((m) => m.method === 'turn/start');
    assert.equal(starts.length, 2);
    assert.equal(starts[1].params.model, 'gpt-fixture');
    assert.match(starts[1].params.input.at(-1).text, /quick, on another model$/);
    assert.equal(
      (await lines('protocol.jsonl')).filter((m) => m.method === 'turn/steer').length,
      0,
    );

    // A turn that refuses the words (it has just ended) leaves the instruction to a run of its own.
    await writeFile(path.join(root, 'refuse-steer'), '');
    const { runId: second, conversationId } = await working(
      'codex',
      'Back to work',
      service.createConversation(space.scopeId, 'codex'),
    );
    const [refused] = await queue('codex', conversationId, 'quick follow-up');
    const again = await service.sendNow(space.scopeId, conversationId, refused.id);
    assert.equal(again.steered, false);
    assert.equal((await end(second)).outcome, 'cancelled');
    assert.equal((await end(again.runId!)).outcome, 'completed');
    assert.deepEqual(again.queued, []);
    assert.equal(
      (await lines('protocol.jsonl')).filter((m) => m.method === 'turn/steer').length,
      1,
    );
    const saved = await service.conversation(space.scopeId, 'codex', conversationId);
    // The instruction shows once, in the run that took it.
    assert.deepEqual(
      saved.events.filter((event) => event.role === 'user').map((event) => event.text),
      ['Back to work', 'quick follow-up'],
    );
  },
);

test(
  'Without a run, an instruction sent now starts ahead of older ones; nobody else’s queue is reached',
  { skip: process.platform === 'win32' && 'POSIX protocol fixture executable', timeout: 30000 },
  async (t) => {
    const { files, space, service, end, queue } = await setup(t);
    const done = await service.startAccepted({
      scopeId: space.scopeId,
      agent: 'codex',
      prompt: 'quick start',
    });
    await end(done);
    const conversationId = (await service.conversation(space.scopeId, 'codex')).id!;
    const [older, newer] = await queue('codex', conversationId, 'Older').then(() =>
      queue('codex', conversationId, 'quick, newer'),
    );
    const sent = await service.sendNow(space.scopeId, conversationId, newer.id);
    assert.equal(sent.steered, false);
    assert.deepEqual(sent.queued, [older]);
    assert.equal((await end(sent.runId!)).outcome, 'completed');
    // Another owner's id does not reach this queue; nor does an id it does not hold.
    const elsewhere = path.join(path.dirname(space.root), 'Elsewhere');
    await mkdir(elsewhere);
    const stranger = await files.register(elsewhere, 'Elsewhere', 'personal');
    await assert.rejects(service.sendNow(stranger.scopeId, conversationId, older.id));
    assert.deepEqual((await service.conversation(space.scopeId, 'codex', conversationId)).queued, [
      older,
    ]);
    await assert.rejects(
      service.sendNow(space.scopeId, conversationId, newer.id),
      /送信待ちにありません|not in the queue/,
    );
  },
);

test(
  "A routine's step is neither steered nor stopped by an instruction sent now",
  { skip: process.platform === 'win32' && 'POSIX protocol fixture executable', timeout: 30000 },
  async (t) => {
    const { space, service, events, end, queue } = await setup(t);
    const step = service.startStep(
      { scopeId: space.scopeId, agent: 'codex', prompt: 'Routine step' },
      { preamble: 'A routine step.', directories: [], notice: 'Routine', env: {} },
    );
    while (!events.some((event) => event.runId === step.runId && event.type === 'text'))
      await new Promise((resolve) => setTimeout(resolve, 5));
    const [waiting] = await queue('codex', step.conversationId, 'Not now');
    await assert.rejects(
      service.sendNow(space.scopeId, step.conversationId, waiting.id),
      /ルーティン|routine/,
    );
    const shown = await service.conversation(space.scopeId, 'codex', step.conversationId);
    assert.equal(shown.activeRunId, step.runId);
    assert.deepEqual(shown.queued, [waiting]);
    await service.cancelRun(step.runId);
    assert.equal((await end(step.runId)).outcome, 'cancelled');
  },
);

test('Steering waits for a turn to open and answers none once it is closed', async () => {
  const steering = new Steering();
  const ready = steering.ready();
  const steer = async () => true;
  steering.open(steer);
  assert.equal(await ready, steer);
  steering.close();
  assert.equal(await steering.ready(), undefined);
  steering.open(steer);
  assert.equal(await steering.ready(), undefined);
  const never = new Steering();
  const waiting = never.ready();
  never.close();
  assert.equal(await waiting, undefined);
});

test('A message channel gives what was pushed, in order, and ends once closed', async () => {
  const channel = new MessageChannel<number>();
  const read = (async () => {
    const seen: number[] = [];
    for await (const item of channel) seen.push(item);
    return seen;
  })();
  channel.push(1);
  await new Promise((resolve) => setTimeout(resolve, 5));
  channel.push(2);
  channel.push(3);
  channel.close();
  assert.equal(channel.push(4), false);
  assert.deepEqual(await read, [1, 2, 3]);
});
