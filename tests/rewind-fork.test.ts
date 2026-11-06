import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentService } from '../src/agents/service';
import { FileService } from '../src/host/files';
import { earlierConversation } from '../prompts';
import type { AgentEvent, AgentId } from '../src/domain/types';

// Protocol stand-ins only: no model, no provider account. Each answers a turn
// with "reply to <its last line>" and notes what it was asked for.
const codexFixture = `#!/usr/bin/env node
const fs = require('node:fs');
let turns = 0;
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
const log = value => fs.appendFileSync('codex.jsonl', JSON.stringify(value) + '\\n');
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const m = JSON.parse(line);
  if (!m.method || m.id === undefined) return;
  if (m.method === 'thread/start') {
    log({method: m.method});
    return send({id:m.id,result:{thread:{id:'thread-' + Date.now()}}});
  }
  if (m.method === 'thread/resume') {
    log({method: m.method, threadId: m.params.threadId});
    return send({id:m.id,result:{thread:{id:m.params.threadId}}});
  }
  if (m.method === 'thread/fork') {
    log({method: m.method, threadId: m.params.threadId, lastTurnId: m.params.lastTurnId, approvalPolicy: m.params.approvalPolicy});
    return send({id:m.id,result:{thread:{id:'fork-of-' + m.params.threadId + '-at-' + m.params.lastTurnId}}});
  }
  if (m.method === 'turn/start') {
    const text = m.params.input.at(-1).text;
    const turn = 'turn-' + Date.now() + '-' + (++turns);
    log({method: m.method, threadId: m.params.threadId, turn, text});
    send({id:m.id,result:{turn:{id:turn}}});
    send({method:'item/agentMessage/delta',params:{delta:'reply to ' + text.trim().split('\\n').at(-1)}});
    return send({method:'turn/completed',params:{turn:{status:'completed'}}});
  }
  send({id:m.id,result:{}});
});
`;

// Claude Code's stream-json side: notes its arguments and gives each reply an id.
const claudeFixture = `#!/usr/bin/env node
const fs = require('node:fs');
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
const args = process.argv.slice(2);
const flag = name => { const at = args.findIndex(a => a === name || a.startsWith(name + '=')); return at < 0 ? undefined : args[at].includes('=') ? args[at].split('=')[1] : args[at + 1]; };
const session = args.includes('--fork-session') ? 'forked-' + Date.now() : flag('--resume') || 'session-' + Date.now();
const lines = require('node:readline').createInterface({input:process.stdin});
lines.on('line', line => {
  const m = JSON.parse(line);
  if (m.type === 'control_request') {
    send({type:'control_response',response:{subtype:'success',request_id:m.request_id,response:{}}});
    return;
  }
  if (m.type !== 'user') return;
  const text = m.message.content.map(part => part.text ?? '').join('').trim().split('\\n').at(-1);
  const uuid = 'entry-' + text.replace(/\\W+/g, '-');
  fs.appendFileSync('claude.jsonl', JSON.stringify({resume: flag('--resume'), at: flag('--resume-session-at'), fork: args.includes('--fork-session'), session, text, uuid}) + '\\n');
  send({type:'system',subtype:'init',session_id:session});
  send({type:'assistant',parent_tool_use_id:null,session_id:session,uuid,message:{id:uuid,type:'message',role:'assistant',model:'fixture',content:[{type:'text',text:'reply to ' + text}],stop_reason:null,stop_sequence:null,usage:{}}});
  send({type:'result',subtype:'success',result:'done',is_error:false,session_id:session,duration_ms:1,duration_api_ms:0,num_turns:1,total_cost_usd:0,usage:{},modelUsage:{},permission_denials:[]});
});
lines.on('close', () => process.exit(0));
`;

// Hermes Agent, a CLI irori cannot continue from a point of its session.
const hermesFixture = `#!/usr/bin/env node
const fs = require('node:fs');
let prompt = '';
process.stdin.on('data', chunk => (prompt += chunk));
process.stdin.on('end', () => {
  fs.appendFileSync('hermes.jsonl', JSON.stringify({prompt}) + '\\n');
  const said = prompt.trim().split('\\n').at(-1);
  const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
  send({type:'system',subtype:'init',session_id:'hermes-session'});
  send({type:'text',text:'reply to ' + said});
  send({type:'result',session_id:'hermes-session',exit_code:0});
});
`;

async function setup(t: TestContext) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori rewind fork '));
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
  await writeFile(path.join(bin, 'claude'), claudeFixture, { mode: 0o700 });
  await writeFile(path.join(bin, 'hermes'), hermesFixture, { mode: 0o700 });
  process.env.PATH = bin + path.delimiter + previous;
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const space = await files.register(root, 'KB', 'personal');
  const ended = new Map<string, () => void>();
  const service = new AgentService(files, (event: AgentEvent) => {
    if (event.type === 'done') ended.get(event.runId)?.();
  });
  t.after(() => service.cancel());
  /** One instruction in the conversation, until its run ends. */
  async function say(agent: AgentId, conversationId: string, prompt: string) {
    await new Promise<void>((resolve) => {
      ended.set(service.start({ scopeId: space.scopeId, agent, conversationId, prompt }), resolve);
    });
  }
  const shown = async (agent: AgentId, id: string) =>
    (await service.conversation(space.scopeId, agent, id)).events;
  const said = async (agent: AgentId, id: string) =>
    (await shown(agent, id))
      .filter((event) => event.role === 'user' || event.type === 'text')
      .map((event) => event.text);
  const log = async (file: string) =>
    (await readFile(path.join(root, file), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
  return { root, files, space, service, say, shown, said, log };
}

test(
  'Codex: an edited message goes on from the turn before it, and a copy from the run it ends at',
  { skip: process.platform === 'win32' && 'POSIX protocol fixture executable', timeout: 30000 },
  async (t) => {
    const { files, space, service, say, shown, said, log } = await setup(t);
    const id = service.createConversation(space.scopeId, 'codex');
    for (const word of ['first', 'second', 'third']) await say('codex', id, word);
    const before = await shown('codex', id);
    const third = before.find((event) => event.role === 'user' && event.text === 'third')!;
    const back = await service.rewind(space.scopeId, id, third.id!);
    assert.equal(back.prompt, 'third');
    // The view leaves out the set-aside run; the file keeps it, marked.
    assert.deepEqual(await said('codex', id), [
      'first',
      'reply to first',
      'second',
      'reply to second',
    ]);
    const conversation = await service.conversation(space.scopeId, 'codex', id);
    const stored = await readFile(
      path.join(files.dataDir, 'conversations', id, 'events.jsonl'),
      'utf8',
    );
    assert.equal(stored.match(/"aside":/g)?.length, 3);
    assert.equal(conversation.earlier, 0);
    await say('codex', id, 'third, edited');
    const calls = await log('codex.jsonl');
    const turns = calls.filter((call) => call.method === 'turn/start');
    const fork = calls.find((call) => call.method === 'thread/fork');
    // A new thread from the original through the second turn, which the edit goes to.
    assert.equal(fork.threadId, turns[0].threadId);
    assert.equal(fork.lastTurnId, turns[1].turn);
    assert.equal(fork.approvalPolicy, 'on-request');
    assert.equal(turns[3].threadId, `fork-of-${fork.threadId}-at-${fork.lastTurnId}`);
    assert.doesNotMatch(turns[3].text, /Earlier in this conversation/);
    assert.deepEqual((await said('codex', id)).slice(-2), [
      'third, edited',
      'reply to third, edited',
    ]);
    // Rewinding the edit again keeps the earlier set-aside run out of the way.
    const edited = (await shown('codex', id)).find((event) => event.text === 'third, edited')!;
    await service.rewind(space.scopeId, id, edited.id!);
    assert.equal((await said('codex', id)).length, 4);

    // A copy through the first run: the original is unchanged.
    const firstEnd = before.find((event) => event.type === 'done')!;
    const copy = await service.fork(space.scopeId, id, firstEnd.id!);
    assert.notEqual(copy, id);
    // The copy keeps the conversation's access.
    assert.equal((await service.conversation(space.scopeId, 'codex', copy)).access, 'default');
    assert.deepEqual(await said('codex', copy), ['first', 'reply to first']);
    assert.equal((await said('codex', id)).length, 4);
    const rows = await service.conversationList(space.scopeId);
    const row = rows.find((item) => 'id' in item && item.id === copy) as { title: string };
    assert.match(row.title, /first（分岐）|first \(branch\)/);
    await say('codex', copy, 'in the copy');
    const again = await log('codex.jsonl');
    const copyFork = again.filter((call) => call.method === 'thread/fork').at(-1);
    assert.equal(copyFork.threadId, turns[0].threadId);
    assert.equal(copyFork.lastTurnId, turns[0].turn);
    // Rewinding a conversation's first message leaves nothing to go on from.
    const firstMessage = (await shown('codex', copy)).find((event) => event.role === 'user')!;
    await service.rewind(space.scopeId, copy, firstMessage.id!);
    assert.deepEqual(await said('codex', copy), []);
    await say('codex', copy, 'from the start');
    assert.equal((await log('codex.jsonl')).at(-2).method, 'thread/start');
    // Only a message that started a run can be edited, and only the owner's.
    const reply = (await shown('codex', id)).find((event) => event.type === 'text')!;
    await assert.rejects(
      service.rewind(space.scopeId, id, reply.id!),
      /やり直せません|cannot be edited/,
    );
  },
);

test(
  'Claude Code: an edited message resumes the session at the entry before it, as a fork',
  { skip: process.platform === 'win32' && 'POSIX protocol fixture executable', timeout: 30000 },
  async (t) => {
    const { space, service, say, shown, said, log } = await setup(t);
    const id = service.createConversation(space.scopeId, 'claude');
    await say('claude', id, 'one');
    await say('claude', id, 'two');
    const two = (await shown('claude', id)).find((event) => event.text === 'two')!;
    await service.rewind(space.scopeId, id, two.id!);
    await say('claude', id, 'two, edited');
    const calls = await log('claude.jsonl');
    assert.equal(calls[1].resume, calls[0].session);
    const edited = calls[2];
    assert.equal(edited.resume, calls[0].session);
    assert.equal(edited.at, 'entry-one');
    assert.equal(edited.fork, true);
    assert.deepEqual(await said('claude', id), [
      'one',
      'reply to one',
      'two, edited',
      'reply to two, edited',
    ]);
    // The next turn goes on in the forked session, as an ordinary resume.
    await say('claude', id, 'three');
    const next = (await log('claude.jsonl')).at(-1);
    assert.equal(next.resume, edited.session);
    assert.equal(next.fork, false);
    // A copy goes on from the end of the run it was made at.
    const done = (await shown('claude', id)).find((event) => event.type === 'done')!;
    const copy = await service.fork(space.scopeId, id, done.id!);
    await say('claude', copy, 'copied on');
    const copied = (await log('claude.jsonl')).at(-1);
    assert.equal(copied.resume, calls[0].session);
    assert.equal(copied.at, 'entry-one');
    assert.equal(copied.fork, true);
  },
);

test(
  'A CLI that cannot fork its session hears the conversation so far in a new one',
  { skip: process.platform === 'win32' && 'POSIX protocol fixture executable', timeout: 30000 },
  async (t) => {
    const { space, service, say, shown, log } = await setup(t);
    const id = service.createConversation(space.scopeId, 'hermes');
    await say('hermes', id, 'alpha');
    await say('hermes', id, 'beta');
    // The second turn continued the session without the conversation retold.
    assert.doesNotMatch((await log('hermes.jsonl'))[1].prompt, /Earlier in this conversation/);
    const beta = (await shown('hermes', id)).find((event) => event.text === 'beta')!;
    await service.rewind(space.scopeId, id, beta.id!);
    await say('hermes', id, 'gamma');
    const retold = (await log('hermes.jsonl'))[2].prompt as string;
    assert.match(retold, /Earlier in this conversation/);
    assert.match(retold, /User: alpha\n\nAgent: reply to alpha/);
    assert.doesNotMatch(retold, /beta/);
    assert.match(retold, /gamma$/);
    const shownNow = await shown('hermes', id);
    assert.ok(shownNow.some((event) => /これまでの会話|conversation so far/.test(event.text)));
    // A copy, too, retells what it holds.
    const done = shownNow.find((event) => event.type === 'done')!;
    const copy = await service.fork(space.scopeId, id, done.id!);
    await say('hermes', copy, 'delta');
    const copied = (await log('hermes.jsonl')).at(-1).prompt as string;
    assert.match(copied, /User: alpha/);
    assert.doesNotMatch(copied, /gamma/);
  },
);

test('The conversation so far keeps its newest messages within the budget', () => {
  const said = [
    { role: 'person' as const, text: 'old question' },
    { role: 'agent' as const, text: 'old answer' },
    { role: 'person' as const, text: 'new question' },
  ];
  const whole = earlierConversation(said)!;
  assert.match(whole, /User: old question\n\nAgent: old answer\n\nUser: new question/);
  assert.doesNotMatch(whole, /left out/);
  const cut = earlierConversation(said, 30)!;
  assert.match(cut, /left out/);
  assert.match(cut, /User: new question/);
  assert.doesNotMatch(cut, /old question/);
  assert.equal(earlierConversation([]), undefined);
});
