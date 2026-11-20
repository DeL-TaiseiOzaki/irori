import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  boardCards,
  foldSession,
  liveFromConversation,
  sessionBoard,
  subAgentStart,
  type SessionLive,
  type SessionRow,
} from '../src/domain/session-board';
import type { AgentEvent } from '../src/domain/types';

let count = 0;
const event = (overrides: Partial<AgentEvent>): AgentEvent => ({
  id: `id-${count++}`,
  runId: 'run',
  type: 'status',
  text: `text ${count}`,
  ...overrides,
});
const fold = (events: AgentEvent[], start?: SessionLive, now = 1) =>
  events.reduce<SessionLive | undefined>((live, item) => foldSession(live, item, now), start)!;
const row = (id: string, overrides: Partial<SessionRow> = {}): SessionRow => ({
  id,
  scopeId: 'vault',
  agent: 'claude',
  model: null,
  title: id,
  createdAt: '2026-11-20T00:00:00.000Z',
  updatedAt: '2026-11-20T00:00:00.000Z',
  linkedNote: null,
  pinned: false,
  archived: false,
  running: false,
  queued: 0,
  ...overrides,
});

test('Each CLI’s own sub-agent tool starts a sub-agent; other calls do not', () => {
  const claude = subAgentStart(
    event({
      type: 'tool',
      text: 'Task',
      call: 'toolu_1',
      details: JSON.stringify({
        description: 'Survey the notes',
        prompt: 'Read every note\nand list them',
        subagent_type: 'Explore',
      }),
    }),
  );
  assert.deepEqual(claude, { call: 'toolu_1', label: 'Survey the notes', kind: 'Explore' });
  const codex = subAgentStart(
    event({
      type: 'tool',
      text: 'collabAgentToolCall',
      call: 'spawn-1',
      details: JSON.stringify({
        type: 'collabAgentToolCall',
        tool: 'spawnAgent',
        prompt: 'Check links',
      }),
    }),
  );
  assert.deepEqual(codex, { call: 'spawn-1', label: 'Check links' });
  // Codex's other collaboration calls wait for or talk to a sub-agent; they start none.
  assert.equal(
    subAgentStart(
      event({
        type: 'tool',
        text: 'collabAgentToolCall',
        call: 'wait-1',
        details: JSON.stringify({ tool: 'wait' }),
      }),
    ),
    undefined,
  );
  assert.equal(subAgentStart(event({ type: 'tool', text: 'Read', call: 'r' })), undefined);
  // A result, or a hand-off's step followed in the irori agent's log, is not a start.
  assert.equal(
    subAgentStart(event({ type: 'tool', text: 'Task', call: 'toolu_1', result: true })),
    undefined,
  );
  assert.equal(
    subAgentStart(
      event({
        type: 'tool',
        text: 'Task',
        call: 'toolu_2',
        delegate: { scopeId: 'v', task: 't', state: 'working' },
      }),
    ),
    undefined,
  );
});

test('A run’s events give its step, its requests, its sub-agents and its end', () => {
  let live = fold([
    event({ role: 'user', text: 'Tidy the notes\nplease' }),
    event({ type: 'tool', text: 'Read', details: JSON.stringify({ file_path: 'a.md' }) }),
  ]);
  assert.equal(live.runId, 'run');
  assert.equal(live.prompt, 'Tidy the notes');
  assert.equal(live.step, 'Read · a.md');
  live = fold(
    [
      event({ type: 'tool', text: 'Task', call: 'c1', details: '{"description":"One"}' }),
      event({ type: 'tool', text: 'Task', call: 'c2', details: '{"description":"Two"}' }),
      event({ type: 'tool', text: 'Task result', call: 'c1', result: true, details: 'ok' }),
      event({ type: 'permission', text: 'Allow Bash?', requestId: 'r1' }),
    ],
    live,
    2,
  );
  assert.deepEqual(
    live.subAgents.map((agent) => [agent.label, agent.state]),
    [
      ['One', 'done'],
      ['Two', 'working'],
    ],
  );
  assert.deepEqual(live.requests, ['r1']);
  assert.equal(live.ask, 'Allow Bash?');
  assert.equal(live.changedAt, 2);
  live = foldSession(live, event({ type: 'status', text: '', resolved: 'r1' }), 3);
  assert.deepEqual(live.requests, []);
  assert.equal(live.ask, undefined);
  live = fold(
    [
      event({ type: 'text', id: 'reply', text: 'All ' }),
      event({ type: 'text', id: 'reply', text: 'tidy.' }),
      event({ type: 'done', text: '', outcome: 'completed' }),
    ],
    live,
    4,
  );
  assert.equal(live.reply, 'All tidy.');
  assert.equal(live.runId, undefined);
  assert.equal(live.outcome, 'completed');
  assert.equal(live.changedAt, 4);
  // A sub-agent still working when its run ends ended with it.
  assert.equal(live.subAgents[1].state, 'done');
  // The next run starts afresh.
  live = foldSession(live, event({ runId: 'next', role: 'user', text: 'Again' }), 5);
  assert.deepEqual(live.subAgents, []);
  assert.equal(live.outcome, undefined);
  assert.equal(live.runId, 'next');
});

test('A conversation read from the host counts only a run in progress', () => {
  const events = [
    event({ role: 'user', text: 'Old' }),
    event({ type: 'tool', text: 'Task', call: 'c', details: '{"description":"Sub"}' }),
    event({ type: 'done', text: '', outcome: 'failed' }),
  ];
  const ended = liveFromConversation({ events }, 9);
  assert.equal(ended.outcome, undefined);
  assert.equal(ended.runId, undefined);
  assert.deepEqual(ended.subAgents, []);
  const running = liveFromConversation(
    {
      events: [
        event({ runId: 'r2', role: 'user', text: 'Now' }),
        event({
          runId: 'r2',
          type: 'tool',
          text: 'Agent',
          call: 'c2',
          details: '{"prompt":"Look"}',
        }),
      ],
      activeRunId: 'r2',
      requests: [event({ runId: 'r2', type: 'question', text: 'Which?', requestId: 'q' })],
    },
    9,
  );
  assert.equal(running.runId, 'r2');
  assert.deepEqual(running.requests, ['q']);
  assert.equal(running.subAgents[0].label, 'Look');
});

test('The board puts each conversation in its lane and a hand-off under its maker', () => {
  const live: Record<string, SessionLive> = {
    asking: fold([
      event({ runId: 'a', role: 'user', text: 'x' }),
      event({ runId: 'a', type: 'permission', text: 'May I?', requestId: 'p' }),
    ]),
    finished: fold(
      [
        event({ runId: 'f', role: 'user', text: 'x' }),
        event({ runId: 'f', type: 'done', text: '', outcome: 'completed' }),
      ],
      undefined,
      50,
    ),
    broke: fold(
      [
        event({ runId: 'b', role: 'user', text: 'x' }),
        event({ runId: 'b', type: 'done', text: '', outcome: 'failed' }),
      ],
      undefined,
      60,
    ),
    looked: fold(
      [
        event({ runId: 'l', role: 'user', text: 'x' }),
        event({ runId: 'l', type: 'done', text: '', outcome: 'completed' }),
      ],
      undefined,
      10,
    ),
  };
  const lanes = sessionBoard({
    rows: [
      row('asking'),
      row('maker', { scopeId: 'you', running: true }),
      row('handed', { running: true, origin: 'hand-off', handedBy: 'maker' }),
      row('queued', { queued: 2 }),
      row('finished'),
      row('broke'),
      row('looked'),
      row('tab'),
      row('history'),
      // A hand-off whose maker is not listed stands on its own.
      row('orphan', { running: true, origin: 'hand-off', handedBy: 'elsewhere' }),
    ],
    live,
    open: new Set(['tab']),
    seen: { looked: 20 },
  });
  const ids = (lane: keyof typeof lanes) => lanes[lane].map((item) => item.id).sort();
  assert.deepEqual(ids('attention'), ['asking', 'broke']);
  assert.deepEqual(ids('working'), ['maker', 'orphan', 'queued']);
  assert.deepEqual(ids('done'), ['finished']);
  // Looked at after it ended, it is only open; one never opened is left out.
  assert.deepEqual(ids('open'), ['tab']);
  const maker = lanes.working.find((item) => item.id === 'maker')!;
  assert.deepEqual(
    maker.children.map((item) => [item.id, item.state, item.handOff]),
    [['handed', 'running', true]],
  );
  assert.equal(lanes.attention.find((item) => item.id === 'asking')!.line, 'May I?');
  assert.equal(boardCards(lanes).length, 8);
  assert.ok(!boardCards(lanes).some((item) => item.id === 'history' || item.id === 'looked'));
});

test('A hand-off that waits brings the conversation that made it, even when idle', () => {
  const lanes = sessionBoard({
    rows: [
      row('maker', { scopeId: 'you' }),
      row('handed', { queued: 1, origin: 'hand-off', handedBy: 'maker' }),
    ],
    live: {},
    open: new Set(),
    seen: {},
  });
  assert.deepEqual(
    lanes.open.map((item) => item.id),
    ['maker'],
  );
  assert.equal(lanes.open[0].children[0].state, 'queued');
});
