import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentService } from '../src/agents/service';
import { CommandCatalog, codexCommands, parseCodexSkills } from '../src/agents/commands';
import { FileService } from '../src/host/files';
import { hostArguments } from '../src/domain/host-requests';
import { matchCommands } from '../src/app/command-match';
import type { AgentCommand, AgentEvent } from '../src/domain/types';

const fixtureOptions = {
  skip: process.platform === 'win32' && 'POSIX protocol fixture executable',
  timeout: 30000,
};

test("Codex's skills are read from skills/list: enabled ones, each name once", () => {
  const skills = parseCodexSkills({
    data: [
      {
        cwd: '/kb',
        errors: [],
        skills: [
          { name: 'weekly', description: 'Long.', shortDescription: 'Short.', path: '/a' },
          { name: 'weekly', description: 'Again.', path: '/b' },
          { name: 'off', description: 'Off.', path: '/c', enabled: false },
          { name: 'has space', description: 'Bad.', path: '/d' },
          { name: 'plugin:tidy', description: 'Tidy.', path: '/e' },
        ],
      },
    ],
  });
  assert.deepEqual(skills, [
    { name: 'weekly', description: 'Short.', path: '/a' },
    { name: 'plugin:tidy', description: 'Tidy.', path: '/e' },
  ]);
  assert.deepEqual(parseCodexSkills(undefined), []);
  assert.deepEqual(
    codexCommands().map((command) => command.name),
    ['compact', 'review'],
  );
});

test('The list offers names that start with what was typed first, then the rest', () => {
  const commands: AgentCommand[] = ['review', 'compact', 'pr-review', 'context'].map((name) => ({
    name,
    description: '',
  }));
  assert.deepEqual(
    matchCommands(commands, 'rev').map((item) => item.name),
    ['review', 'pr-review'],
  );
  assert.deepEqual(
    matchCommands(commands, 'CO').map((item) => item.name),
    ['compact', 'context'],
  );
  assert.equal(matchCommands(commands, '').length, 4);
});

test('A folder’s commands are read once a minute per CLI, and only from Claude Code and Codex', async (t) => {
  const bin = await mkdtemp(path.join(tmpdir(), 'irori commands bin '));
  const oldPath = process.env.PATH;
  t.after(async () => {
    process.env.PATH = oldPath;
    await rm(bin, { recursive: true, force: true });
  });
  await writeFile(path.join(bin, 'codex'), '#!/bin/sh\necho codex-cli 9.9.9\n', { mode: 0o700 });
  process.env.PATH = bin + path.delimiter + oldPath;
  let now = 0;
  const asked: string[] = [];
  let fail = false;
  const catalog = new CommandCatalog(
    async (agent, cwd) => {
      asked.push(`${agent} ${cwd}`);
      if (fail) throw Error('unreadable');
      return [{ name: 'compact', description: '' }];
    },
    () => now,
  );
  await catalog.commands('codex', '/kb');
  await catalog.commands('codex', '/kb');
  await catalog.commands('codex', '/other');
  assert.deepEqual(asked, ['codex /kb', 'codex /other']);
  now = 61_000;
  fail = true;
  await assert.rejects(catalog.commands('codex', '/kb'), /unreadable/);
  fail = false;
  await catalog.commands('codex', '/kb');
  assert.equal(asked.length, 4, 'a failed read is tried again');
  assert.deepEqual(await catalog.commands('pi', '/kb'), []);
  assert.deepEqual(await catalog.commands('hermes', '/kb'), []);
  assert.equal(asked.length, 4);
  assert.equal(
    hostArguments.agentCommands.safeParse([crypto.randomUUID(), 'claude']).success,
    true,
  );
  assert.equal(hostArguments.agentCommands.safeParse(['x', 'claude']).success, false);
});

// Stand-ins for the CLIs that speak their protocols and record what they were
// sent. No model runs.
const claudeFixture = `#!/usr/bin/env node
if (process.argv.includes('--version')) { console.log('9.9.9 (Claude Code)'); process.exit(0); }
const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.type === 'control_request' && message.request?.subtype === 'initialize')
    send({ type: 'control_response', response: { subtype: 'success', request_id: message.request_id, response: {
      commands: [
        { name: 'compact', description: 'Clear history but keep a summary', argumentHint: '<instructions>' },
        { name: 'weekly', description: 'Writes the weekly review.', argumentHint: '' },
      ],
      agents: [], output_style: 'default', available_output_styles: [], models: [], account: {},
    } } });
  else if (message.type === 'control_request')
    send({ type: 'control_response', response: { subtype: 'success', request_id: message.request_id, response: {} } });
  if (message.type === 'user') require('node:fs').appendFileSync('claude-fixture.jsonl', line + '\\n');
});
`;

const codexFixture = `#!/usr/bin/env node
if (process.argv.includes('--version')) { console.log('codex-cli 9.9.9'); process.exit(0); }
const fs = require('node:fs');
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  if (!m.method || m.id === undefined) return;
  fs.appendFileSync('protocol.jsonl', JSON.stringify(m) + '\\n');
  const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
  const thread = m.params?.threadId || 'fixture-thread';
  if (m.method === 'skills/list') {
    send({ id: m.id, result: { data: [{ cwd: m.params.cwds[0], errors: [], skills: [
      { name: 'weekly', description: 'Writes the weekly review.', path: '/skills/weekly/SKILL.md', scope: 'repo', enabled: true },
    ] }] } });
    return;
  }
  if (m.method === 'thread/compact/start') {
    send({ id: m.id, result: {} });
    send({ method: 'thread/compacted', params: { threadId: thread } });
    return;
  }
  if (m.method === 'review/start') {
    send({ id: m.id, result: { reviewThreadId: thread, turn: { id: 'review-turn' } } });
    send({ method: 'item/started', params: { threadId: thread, turnId: 'review-turn', item: { type: 'enteredReviewMode', id: 'r1', review: 'changes' } } });
    send({ method: 'item/completed', params: { threadId: thread, turnId: 'review-turn', item: { type: 'exitedReviewMode', id: 'r2', review: 'No findings.' } } });
    send({ method: 'turn/completed', params: { threadId: thread, turn: { id: 'review-turn', status: 'completed' } } });
    return;
  }
  const result = m.method.startsWith('thread/') ? { thread: { id: thread } }
    : m.method === 'turn/start' ? { turn: { id: 'fixture-turn' } } : {};
  send({ id: m.id, result });
  if (m.method === 'turn/start')
    send({ method: 'turn/completed', params: { threadId: thread, turn: { id: 'fixture-turn', status: 'completed' } } });
});
`;

async function setup(t: TestContext) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori cli commands '));
  const oldPath = process.env.PATH;
  t.after(async () => {
    process.env.PATH = oldPath;
    await rm(base, { recursive: true, force: true });
  });
  const bin = path.join(base, 'bin');
  const root = path.join(base, 'KB');
  await mkdir(bin);
  await mkdir(root);
  await writeFile(path.join(bin, 'codex'), codexFixture, { mode: 0o700 });
  await writeFile(path.join(bin, 'claude'), claudeFixture, { mode: 0o700 });
  process.env.PATH = bin + path.delimiter + oldPath;
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const space = await files.register(root, 'KB', 'personal');
  const events: AgentEvent[] = [];
  const ends = new Map<string, () => void>();
  const service = new AgentService(files, (event) => {
    events.push(event);
    if (event.type === 'done') ends.get(event.runId)?.();
  });
  t.after(() => service.cancel());
  let conversationId: string | undefined;
  const run = async (prompt: string) => {
    let end!: () => void;
    const done = new Promise<void>((resolve) => (end = resolve));
    const runId = await service.startAccepted({
      scopeId: space.scopeId,
      agent: 'codex',
      prompt,
      ...(conversationId && { conversationId }),
    });
    ends.set(runId, end);
    if (events.some((event) => event.runId === runId && event.type === 'done')) end();
    await done;
    const mine = events.filter((event) => event.runId === runId);
    conversationId ??= mine.find((event) => event.conversationId)?.conversationId;
    return mine;
  };
  const sent = async () =>
    (await readFile(path.join(root, 'protocol.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
  return { root, space, service, run, sent };
}

test(
  'Claude Code’s commands and skills are read from a session that is sent no message',
  fixtureOptions,
  async (t) => {
    const { root, space, service } = await setup(t);
    assert.deepEqual(await service.commands(space.scopeId, 'claude'), [
      { name: 'compact', description: 'Clear history but keep a summary', hint: '<instructions>' },
      { name: 'weekly', description: 'Writes the weekly review.' },
    ]);
    await assert.rejects(readFile(path.join(root, 'claude-fixture.jsonl')));
    // Codex: irori's commands, then the skills its app server lists for the vault.
    assert.deepEqual(
      (await service.commands(space.scopeId, 'codex')).map((command) => [
        command.name,
        !!command.skill,
      ]),
      [
        ['compact', false],
        ['review', false],
        ['weekly', true],
      ],
    );
  },
);

test(
  'On Codex, /compact and /review run as its methods and a skill goes as an item (protocol fixture)',
  fixtureOptions,
  async (t) => {
    const { run, sent } = await setup(t);
    // No conversation yet: nothing to compact, and Codex is not asked to.
    const nothing = await run('/compact');
    assert.equal(nothing.at(-1)?.outcome, 'completed', JSON.stringify(nothing));
    assert.ok(nothing.some((event) => event.text.includes('まだ要約する会話がありません')));
    assert.ok(!(await sent()).some((m) => m.method === 'thread/compact/start'));

    // A skill named as /name: an item beside `$name` and the words after it.
    assert.equal((await run('/weekly for this week')).at(-1)?.outcome, 'completed');
    const skillTurn = (await sent()).filter((m) => m.method === 'turn/start').at(-1);
    assert.deepEqual(skillTurn.params.input, [
      { type: 'skill', name: 'weekly', path: '/skills/weekly/SKILL.md' },
      { type: 'text', text: '$weekly for this week', text_elements: [] },
    ]);

    // `$name` among other words: the item goes with the whole request.
    assert.equal((await run('Use $weekly, please.')).at(-1)?.outcome, 'completed');
    const mention = (await sent()).filter((m) => m.method === 'turn/start').at(-1);
    assert.deepEqual(mention.params.input[0], {
      type: 'skill',
      name: 'weekly',
      path: '/skills/weekly/SKILL.md',
    });
    assert.ok(mention.params.input[1].text.endsWith('\n\nUse $weekly, please.'));

    // In the conversation now under way, /compact asks Codex to compact it.
    const compacted = await run('/compact');
    assert.equal(compacted.at(-1)?.outcome, 'completed', JSON.stringify(compacted));
    assert.deepEqual((await sent()).filter((m) => m.method === 'thread/compact/start').length, 1);

    // /review with words reviews by them; its findings are the answer.
    const reviewed = await run('/review the tests only');
    assert.equal(reviewed.at(-1)?.outcome, 'completed', JSON.stringify(reviewed));
    const review = (await sent()).find((m) => m.method === 'review/start');
    assert.deepEqual(review.params.target, { type: 'custom', instructions: 'the tests only' });
    assert.equal(review.params.delivery, 'inline');
    assert.ok(reviewed.some((event) => event.type === 'text' && event.text === 'No findings.'));
    assert.ok(!reviewed.some((event) => event.type === 'tool'));

    // A name Codex does not know goes as words, alone.
    await run('/nope');
    const unknown = (await sent()).filter((m) => m.method === 'turn/start').at(-1);
    assert.deepEqual(unknown.params.input, [{ type: 'text', text: '/nope', text_elements: [] }]);
  },
);
