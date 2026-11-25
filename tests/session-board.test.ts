import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  boardCards,
  foldSession,
  liveFromConversation,
  sessionBoard,
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

const subs = (events: AgentEvent[]) =>
  fold(events).subAgents.map((agent) => [agent.call, agent.label, agent.kind, agent.state]);

test('Each CLI’s own sub-agent tool starts a sub-agent; other calls do not', () => {
  // Claude Code 2.1.316 (`Agent`; `Task` before): the call's result ends it.
  assert.deepEqual(
    subs([
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
    ]),
    [['toolu_1', 'Survey the notes', 'Explore', 'working']],
  );
  const agent = event({
    type: 'tool',
    text: 'Agent',
    call: 'toolu_2',
    details: JSON.stringify({ description: 'Read note.md answer', prompt: 'Read the file' }),
  });
  // Its own steps show in the parent's log, as the parent's steps.
  const step = event({
    type: 'tool',
    text: 'Read',
    call: 'toolu_3',
    details: '{"file_path":"n.md"}',
  });
  const back = event({
    type: 'tool',
    text: 'Agent の結果',
    call: 'toolu_2',
    result: true,
    details: '[]',
  });
  assert.deepEqual(subs([agent, step]), [['toolu_2', 'Read note.md answer', undefined, 'working']]);
  assert.deepEqual(subs([agent, step, back]), [
    ['toolu_2', 'Read note.md answer', undefined, 'done'],
  ]);
  // Other calls start none, nor does a result or a hand-off's step in the irori agent's log.
  assert.deepEqual(subs([event({ type: 'tool', text: 'Read', call: 'r' })]), []);
  assert.deepEqual(subs([event({ type: 'tool', text: 'Task', call: 't', result: true })]), []);
  assert.deepEqual(
    subs([
      event({
        type: 'tool',
        text: 'Task',
        call: 'toolu_4',
        delegate: { scopeId: 'v', task: 't', state: 'working' },
      }),
    ]),
    [],
  );
});

test('Codex’s sub-agent works from its started activity until its completed one', () => {
  // As codex 0.166 reports it: each activity is an item complete as it starts.
  const activity = (id: string, kind: string, result = false) =>
    event({
      type: 'tool',
      text: result ? 'subAgentActivity の結果' : 'subAgentActivity',
      call: id,
      result: result || undefined,
      details: JSON.stringify({
        type: 'subAgentActivity',
        id,
        kind,
        agentThreadId: 'thread-1',
        agentPath: '/root/read_note',
      }),
    });
  const wait = (result: boolean) =>
    event({
      type: 'tool',
      text: result ? 'collabAgentToolCall の結果' : 'collabAgentToolCall',
      call: 'wait-1',
      result: result || undefined,
      details: JSON.stringify({ type: 'collabAgentToolCall', tool: 'wait', agentsStates: {} }),
    });
  const started = [activity('call-1', 'started'), activity('call-1', 'started', true), wait(false)];
  assert.deepEqual(subs(started), [['codex:thread-1', 'read note', undefined, 'working']]);
  const done = [
    ...started,
    activity('done-1', 'completed'),
    activity('done-1', 'completed', true),
    wait(true),
  ];
  assert.deepEqual(subs(done), [['codex:thread-1', 'read note', undefined, 'done']]);
  assert.deepEqual(subs([...started, activity('stop-1', 'interrupted')]), [
    ['codex:thread-1', 'read note', undefined, 'stopped'],
  ]);

  // The earlier protocol: `spawnAgent` returns once the thread began, and a later
  // call's states say it ended. A spawn and its activity are one sub-agent.
  const collab = (call: string, value: Record<string, unknown>, result = false) =>
    event({
      type: 'tool',
      text: 'collabAgentToolCall',
      call,
      result: result || undefined,
      details: JSON.stringify({ type: 'collabAgentToolCall', ...value }),
    });
  const spawned = [
    collab('spawn-1', { tool: 'spawnAgent', prompt: 'Check links', model: 'gpt-mini' }),
    collab(
      'spawn-1',
      { tool: 'spawnAgent', status: 'completed', receiverThreadIds: ['thread-1'] },
      true,
    ),
    activity('call-1', 'started'),
  ];
  assert.deepEqual(subs(spawned), [['codex:thread-1', 'Check links', 'gpt-mini', 'working']]);
  assert.deepEqual(
    subs([
      ...spawned,
      collab('wait-2', { tool: 'wait', agentsStates: { 'thread-1': { status: 'errored' } } }, true),
    ]),
    [['codex:thread-1', 'Check links', 'gpt-mini', 'failed']],
  );
  assert.deepEqual(subs([collab('wait-3', { tool: 'wait' })]), []);
});

test('Antigravity’s launched sub-agents work until their run ends', () => {
  // As agy 1.5.12 reports `invoke_subagent`: done once launched.
  const launch = (result: boolean) =>
    event({
      type: 'tool',
      text: 'invoke_subagent',
      call: 'step-2',
      result: result || undefined,
      details: JSON.stringify({
        subagents: [
          { type_name: 'research', role: 'Note Reader', initial_prompt: 'Read note.md' },
          { type_name: 'general', initial_prompt: 'Check the links\nand report' },
        ],
      }),
    });
  const launched = [launch(false), launch(true)];
  assert.deepEqual(subs(launched), [
    ['antigravity:step-2#0', 'Note Reader', 'research', 'working'],
    ['antigravity:step-2#1', 'Check the links', 'general', 'working'],
  ]);
  assert.deepEqual(
    subs([...launched, event({ type: 'done', text: '完了', outcome: 'completed' })]).map(
      (s) => s[3],
    ),
    ['done', 'done'],
  );
});

test('A run’s events give its request, its asks, its sub-agents and its end', () => {
  let live = fold([
    event({ role: 'user', text: '  Tidy the notes\nplease  ' }),
    event({ type: 'tool', text: 'Read', details: JSON.stringify({ file_path: 'a.md' }) }),
  ]);
  assert.equal(live.runId, 'run');
  // The request is kept whole, for the card's panel; when it began, as seen here.
  assert.equal(live.prompt, 'Tidy the notes\nplease');
  assert.equal(live.startedAt, 1);
  live = fold(
    [
      event({ type: 'tool', text: 'Task', call: 'c1', details: '{"description":"One"}' }),
      event({ type: 'tool', text: 'Task', call: 'c2', details: '{"description":"Two"}' }),
      event({ type: 'tool', text: 'Task result', call: 'c1', result: true, details: 'ok' }),
      event({
        type: 'permission',
        text: 'Allow Bash?',
        details: JSON.stringify({ command: 'ls -la', description: 'List' }),
        requestId: 'r1',
      }),
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
  // A permission's ask carries what it would do; a question's, what it asks.
  assert.equal(live.ask, 'Allow Bash?\nls -la');
  assert.equal(live.changedAt, 2);
  assert.equal(
    foldSession(
      live,
      event({
        type: 'question',
        text: 'Codex asks',
        requestId: 'q1',
        questions: [{ id: 'a', title: 'Which folder?' }],
      }),
      2,
    ).ask,
    'Codex asks\nWhich folder?',
  );
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
  // Saved events carry no times: the read is not when the run began.
  assert.equal(running.startedAt, undefined);
  assert.equal(running.prompt, 'Now');
});

test('The board puts each conversation in its lane and a hand-off under its maker', () => {
  const live: Record<string, SessionLive> = {
    asking: fold([
      event({ runId: 'a', role: 'user', text: 'Tidy up' }),
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
    handed: fold([event({ runId: 'h', role: 'user', text: 'irori: the irori agent handed you' })]),
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
  // A card carries what its panel shows: the ask while it waits, the model.
  const asking = lanes.attention.find((item) => item.id === 'asking')!;
  assert.equal(asking.ask, 'May I?');
  assert.equal(asking.model, null);
  assert.equal(asking.request, 'Tidy up');
  // A hand-off's card names its task, not irori's words to the vault agent.
  assert.equal(maker.children[0].request, 'handed');
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

test('A conversation closed on the board shows in no lane, whatever its state', () => {
  const live: Record<string, SessionLive> = {
    stopping: fold([event({ runId: 's', role: 'user', text: 'Long job' })]),
    ended: fold([
      event({ runId: 'e', role: 'user', text: 'x' }),
      event({ runId: 'e', type: 'done', text: '', outcome: 'cancelled' }),
    ]),
  };
  const lanes = sessionBoard({
    rows: [
      row('stopping', { running: true }),
      row('ended'),
      row('tab'),
      row('maker', { scopeId: 'you' }),
      row('handed', { running: true, origin: 'hand-off', handedBy: 'maker' }),
      row('kept', { queued: 1 }),
    ],
    live,
    open: new Set(['tab', 'maker']),
    seen: {},
    closed: new Set(['stopping', 'ended', 'tab', 'maker', 'kept']),
  });
  // A hand-off still at work stands on its own once the conversation that made it is closed.
  assert.deepEqual(
    boardCards(lanes).map((item) => item.id),
    ['handed'],
  );
  assert.deepEqual(
    lanes.working.map((item) => [item.id, item.children.length]),
    [['handed', 0]],
  );
});
