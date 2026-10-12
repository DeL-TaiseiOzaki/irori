import type { HostAPI, HostEvent } from './types';

type EventSource = Pick<HostAPI, 'onEvent'>;

/**
 * One subscription to the host's events, shared by the renderer's listeners. Each
 * subscription across the bridge copies every event again, so many listeners
 * (columns, the Overview's agents, terminals) multiplied the copying of a stream.
 * Listeners here are called as separate subscriptions were: in the order they
 * subscribed, each event going to those subscribed when it arrived. One that
 * throws is reported and does not keep the event from the others.
 */
export function eventHub(
  source: EventSource,
  report: (error: unknown) => void = (error) => console.error(error),
): EventSource {
  let listeners: { callback: (event: HostEvent) => void }[] = [];
  let stop: (() => void) | undefined;
  const dispatch = (event: HostEvent) => {
    // The list is replaced, never changed, on a (un)subscription: this is the one of the event.
    for (const { callback } of listeners)
      try {
        callback(event);
      } catch (error) {
        report(error);
      }
  };
  return {
    onEvent(callback) {
      const entry = { callback };
      listeners = [...listeners, entry];
      stop ??= source.onEvent(dispatch);
      return () => {
        if (!listeners.includes(entry)) return;
        listeners = listeners.filter((other) => other !== entry);
        if (listeners.length) return;
        stop?.();
        stop = undefined;
      };
    },
  };
}
