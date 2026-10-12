import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventHub } from '../src/domain/event-hub';
import type { HostEvent } from '../src/domain/types';

function bridge() {
  const callbacks = new Set<(event: HostEvent) => void>();
  return {
    subscriptions: () => callbacks.size,
    send: (event: HostEvent) => [...callbacks].forEach((callback) => callback(event)),
    onEvent(callback: (event: HostEvent) => void) {
      callbacks.add(callback);
      return () => {
        callbacks.delete(callback);
      };
    },
  };
}
const files = (scopeId: string) => ({ type: 'files', scopeId }) as HostEvent;

test('listeners share one bridge subscription, held only while one listens', () => {
  const source = bridge();
  const hub = eventHub(source);
  assert.equal(source.subscriptions(), 0);
  const seen: string[] = [];
  const stopA = hub.onEvent(() => seen.push('a'));
  const stopB = hub.onEvent(() => seen.push('b'));
  assert.equal(source.subscriptions(), 1);
  source.send(files('one'));
  assert.deepEqual(seen, ['a', 'b']);
  stopA();
  stopA();
  source.send(files('two'));
  assert.deepEqual(seen, ['a', 'b', 'b']);
  stopB();
  assert.equal(source.subscriptions(), 0);
  hub.onEvent(() => seen.push('c'));
  source.send(files('three'));
  assert.deepEqual(seen, ['a', 'b', 'b', 'c']);
});

test('an event goes to the listeners present when it arrived, in subscription order', () => {
  const source = bridge();
  const hub = eventHub(source);
  const seen: string[] = [];
  let stopB = () => {};
  hub.onEvent(() => {
    seen.push('a');
    // Leaving or joining during an event changes who hears the next one, not this one.
    stopB();
    hub.onEvent(() => seen.push('late'));
  });
  stopB = hub.onEvent(() => seen.push('b'));
  source.send(files('one'));
  assert.deepEqual(seen, ['a', 'b']);
});

test('a listener that throws is reported and the others still hear the event', () => {
  const source = bridge();
  const reported: unknown[] = [];
  const hub = eventHub(source, (error) => reported.push(error));
  const seen: string[] = [];
  hub.onEvent(() => {
    throw Error('broken listener');
  });
  hub.onEvent((event) => seen.push(event.type));
  source.send(files('one'));
  assert.deepEqual(seen, ['files']);
  assert.equal((reported[0] as Error).message, 'broken listener');
});
