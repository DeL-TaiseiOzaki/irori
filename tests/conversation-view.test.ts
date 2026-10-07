import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appendConversationEvent,
  appendConversationEvents,
  eventKey,
  mergeHeldEvents,
  trimConversation,
  viewTextLimit,
  viewWindow,
} from '../src/domain/conversation';
import type { AgentEvent } from '../src/domain/types';

const event = (overrides: Partial<AgentEvent> & { id: string }): AgentEvent => ({
  runId: 'run',
  type: 'status',
  text: overrides.id,
  ...overrides,
});
const fragment = (id: string, text: string, runId = 'run'): AgentEvent => ({
  id,
  runId,
  type: 'text',
  text,
});

test('a batch of events appends as the events would one by one', () => {
  const start = [event({ id: 'a', role: 'user' })];
  const incoming = [
    fragment('t', 'Hel'),
    fragment('t', 'lo'),
    event({ id: 'tool', type: 'tool' }),
    fragment('u', 'Next'),
    fragment('t', ' late', 'other'),
  ];
  const batched = appendConversationEvents(start, incoming);
  const stepwise = incoming.reduce(appendConversationEvent, start);
  assert.deepEqual(batched, stepwise);
  assert.deepEqual(
    batched.map((item) => item.text),
    ['a', 'Hello', 'tool', 'Next', ' late'],
  );
  // The list given is left as it was, and an empty batch returns it as it is.
  assert.equal(start.length, 1);
  assert.equal(appendConversationEvents(start, []), start);
});

test('a reply continues only its own fragments', () => {
  const first = fragment('t', 'one');
  const events = appendConversationEvents(
    [],
    [first, fragment('t', ' two'), fragment('v', 'three')],
  );
  assert.deepEqual(
    events.map((item) => item.text),
    ['one two', 'three'],
  );
  // The merged reply is a new record; the fragment it began from is untouched.
  assert.equal(first.text, 'one');
  assert.deepEqual(
    appendConversationEvents([fragment('t', 'a')], [fragment('t', 'b', 'other-run')]).map(
      (item) => item.text,
    ),
    ['a', 'b'],
  );
});

test('trimming keeps the newest events and the end of the newest reply', () => {
  const events = Array.from({ length: viewWindow + 25 }, (_, index) => event({ id: `e${index}` }));
  const trimmed = trimConversation(events);
  assert.equal(trimmed.dropped, 25);
  assert.equal(trimmed.events.length, viewWindow);
  assert.equal(trimmed.events[0].id, 'e25');
  assert.equal(trimmed.events.at(-1)!.id, `e${viewWindow + 24}`);

  const long = [event({ id: 'a' }), fragment('t', 'x'.repeat(viewTextLimit + 10) + 'END')];
  const cut = trimConversation(long);
  assert.equal(cut.dropped, 0);
  assert.equal(cut.events[1].text.length, viewTextLimit);
  assert.ok(cut.events[1].text.endsWith('END'));
  // Only the newest reply is cut; an earlier long one stays whole.
  const earlier = [fragment('t', 'y'.repeat(viewTextLimit + 5)), event({ id: 'z' })];
  assert.equal(trimConversation(earlier).events[0].text.length, viewTextLimit + 5);
});

test('a list within the limits is returned as it is', () => {
  const events = [event({ id: 'a' }), fragment('t', 'short')];
  const trimmed = trimConversation(events);
  assert.equal(trimmed.events, events);
  assert.equal(trimmed.dropped, 0);
  // The limits can be lowered for a smaller view.
  assert.deepEqual(
    trimConversation(events, 1).events.map((item) => item.id),
    ['t'],
  );
});

test('events held while the snapshot was read join it once', () => {
  const user = event({ id: 'u', role: 'user' });
  const snapshot = [user, event({ id: 'tool', type: 'tool' }), fragment('t', 'Hello, wor')];
  // Fragments the snapshot already read, the fragment it did not, and events after its history.
  const held = [
    event({ id: 'tool', type: 'tool' }),
    fragment('t', 'wor'),
    fragment('t', 'ld'),
    event({ id: 'done', type: 'done', outcome: 'completed' }),
  ];
  const merged = mergeHeldEvents(snapshot, appendConversationEvents([], held));
  assert.deepEqual(
    merged.map((item) => item.text),
    ['u', 'tool', 'Hello, world', 'done'],
  );
  assert.equal(merged.length, 4);
  // Nothing held: the snapshot as it is. Everything held already read: the snapshot's text alone.
  assert.equal(mergeHeldEvents(snapshot, []), snapshot);
  assert.deepEqual(
    mergeHeldEvents(snapshot, [fragment('t', 'Hello, wor')]).map((item) => item.text),
    ['u', 'tool', 'Hello, wor'],
  );
  // A reply the snapshot has not seen at all, and one that ended before the read, are whole/left out.
  assert.deepEqual(
    mergeHeldEvents(snapshot, [fragment('v', 'New')]).map((item) => item.text),
    ['u', 'tool', 'Hello, wor', 'New'],
  );
  const closed = [fragment('t', 'Hello'), event({ id: 'done', type: 'done' })];
  assert.equal(mergeHeldEvents(closed, [fragment('t', 'llo')]).length, 2);
  // The fragments of the same reply arriving in one batch count as one.
  assert.deepEqual(
    mergeHeldEvents([fragment('t', 'ab')], [fragment('t', 'b'), fragment('t', 'c')]).map(
      (item) => item.text,
    ),
    ['abc'],
  );
});

test('an event keeps its key while the window slides', () => {
  const streamed = fragment('t', 'a');
  const events = [event({ id: 'a' }), event({ id: 'b' }), streamed];
  const before = eventKey(events[2], 2);
  const after = eventKey(trimConversation(events, 2).events[1], 1);
  assert.equal(before, after);
  assert.equal(before, 'run:t');
  // A record without an id is named by its place, which an older record alone lacks.
  assert.equal(eventKey({ runId: 'r', type: 'status', text: '' }, 4), 'r-4');
});
