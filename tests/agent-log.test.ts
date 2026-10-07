import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  endedRequests,
  eventTarget,
  logItems,
  requestEnded,
  runTasks,
} from '../src/domain/agent-log';
import type { AgentEvent } from '../src/domain/types';

let count = 0;
const event = (overrides: Partial<AgentEvent>): AgentEvent => ({
  id: `id-${count++}`,
  runId: 'run',
  type: 'status',
  text: `text ${count}`,
  ...overrides,
});

test('a request is over for the same reasons as before, found in one pass', () => {
  const events = [
    event({ type: 'permission', requestId: 'p1' }),
    event({ type: 'permission', requestId: 'p2' }),
    event({ type: 'question', requestId: 'q1', runId: 'other' }),
    event({ type: 'status', resolved: 'p1' }),
    // Another run's answer says nothing about this run's request.
    event({ type: 'status', resolved: 'p2', runId: 'other' }),
    event({ type: 'done', runId: 'other' }),
    event({ type: 'permission', requestId: 'p3' }),
    event({ type: 'permission', requestId: 'p4', runId: 'later' }),
    event({ type: 'done', runId: 'later' }),
  ];
  const ended = endedRequests(events);
  for (const [index, item] of events.entries())
    if (item.type === 'permission' || item.type === 'question')
      assert.equal(ended.has(item), requestEnded(events, index), item.requestId);
  assert.deepEqual(
    events.filter((item) => ended.has(item)).map((item) => item.requestId),
    ['p1', 'q1', 'p4'],
  );
});

test('the log keys items by their events, so a sliding window keeps them', () => {
  const user = event({ role: 'user', text: 'Please' });
  const tool = event({ type: 'tool', call: 'c1', text: 'Read' });
  const result = event({ type: 'tool', call: 'c1', result: true, details: 'done' });
  const reply = event({ type: 'text', text: 'Reply' });
  const request = event({ type: 'permission', requestId: 'p1' });
  const done = event({ type: 'done', outcome: 'completed' });
  const events = [user, tool, result, reply, request, done];
  const items = logItems(events, 'run');
  assert.deepEqual(
    items.map((item) => item.kind),
    ['user', 'label', 'steps', 'message', 'request', 'message'],
  );
  const steps = items[2];
  assert.equal(steps.kind, 'steps');
  if (steps.kind !== 'steps') return;
  // The call's result joins its step rather than making one of its own.
  assert.equal(steps.steps.length, 1);
  assert.equal(steps.steps[0].result, result);
  assert.equal(steps.key, `steps-${steps.steps[0].key}`);
  const requestItem = items[4];
  assert.equal(requestItem.kind, 'request');
  if (requestItem.kind === 'request') assert.equal(requestItem.ended, true);

  // Without the oldest event the remaining items keep their keys.
  const slid = logItems(events.slice(1), 'run');
  assert.deepEqual(
    slid.map((item) => item.key),
    items.slice(1).map((item) => item.key),
  );
  // Closed or open, a group of steps keeps its key: the same whether more events follow.
  const open = logItems([user, tool, result], 'run');
  assert.equal(open.at(-1)!.key, steps.key);
});

test('a resolved event shows nowhere, and a repeated id still gets a key of its own', () => {
  const twin = { id: 'same', runId: 'run', type: 'status' as const, text: 'a' };
  const items = logItems([
    twin,
    { ...twin, text: 'b' },
    event({ type: 'status', resolved: 'p1', text: '' }),
  ]);
  assert.equal(items.length, 2);
  assert.notEqual(items[0].key, items[1].key);
});

test("a run's hand-offs are listed once with their state", () => {
  const started = event({
    text: 'Summarise',
    delegate: { scopeId: 'brain-a', task: 'task-1', state: 'started' },
  });
  const asking = event({
    type: 'permission',
    requestId: 'p1',
    delegate: { scopeId: 'brain-a', task: 'task-1', state: 'working' },
  });
  const events = [event({ role: 'user' }), started, asking];
  const items = logItems(events, 'run');
  const tasks = items.find((item) => item.kind === 'tasks');
  assert.ok(tasks && tasks.kind === 'tasks');
  assert.deepEqual(tasks.tasks, [
    { id: 'task-1', scopeId: 'brain-a', label: 'Summarise', state: 'waiting' },
  ]);
  assert.equal(items.filter((item) => item.kind === 'tasks').length, 1);
  // Once the run is over, work still open is stopped.
  assert.equal(runTasks(events, 'run', false)[0].state, 'stopped');
  const reported = [
    ...events,
    event({ delegate: { scopeId: 'brain-a', task: 'task-1', state: 'reported' } }),
  ];
  assert.equal(runTasks(reported, 'run', true)[0].state, 'reported');
});

test('the target of a step is read from its details', () => {
  assert.equal(eventTarget(JSON.stringify({ input: { file_path: 'notes/a.md' } })), 'notes/a.md');
  assert.equal(eventTarget(JSON.stringify({ command: 'ls' })), 'ls');
  assert.equal(eventTarget('not json'), '');
  assert.equal(eventTarget(undefined), '');
});
