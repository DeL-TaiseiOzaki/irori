import { useEffect, useState } from 'react';
import type { AgentEvent, AgentId } from '../domain/types';
import {
  appendConversationEvent,
  lastIndex,
  withRequests,
  type QueuedMessage,
} from '../domain/conversation';
import { requestEnded } from './AgentLog';
import { errorText } from './ErrorMessage';

const host = window.irori;

export interface BrainAi {
  events: AgentEvent[];
  queued: QueuedMessage[];
  running: boolean;
  ready: boolean;
  error: string;
}

/**
 * One brain's AI as the Overview sees it: its conversation with the live
 * requests, its queue, and whether a run is in progress. Events stream in; a
 * run's start or end reads the queue again, since it changes then.
 */
export function useBrainAi(scopeId: string, agent: AgentId, refresh = 0): BrainAi {
  const [state, setState] = useState<BrainAi>({
    events: [],
    queued: [],
    running: false,
    ready: false,
    error: '',
  });
  const [reread, setReread] = useState(0);
  useEffect(() => {
    let current = true;
    void host
      .agentConversation(scopeId, agent)
      .then(
        (value) =>
          current &&
          setState({
            events: withRequests(value).slice(-120),
            queued: value.queued,
            running: !!value.activeRunId,
            ready: true,
            error: '',
          }),
      )
      .catch(
        (error) => current && setState((previous) => ({ ...previous, error: errorText(error) })),
      );
    const stop = host.onEvent((event) => {
      if (event.type !== 'agent') return;
      const incoming = event.event;
      if (incoming.scopeId !== scopeId || incoming.agent !== agent) return;
      if (incoming.type === 'done' || incoming.role === 'user') setReread((value) => value + 1);
      else
        setState((previous) => ({
          ...previous,
          running: true,
          events: appendConversationEvent(previous.events, incoming).slice(-120),
        }));
    });
    return () => {
      current = false;
      stop();
    };
  }, [scopeId, agent, refresh, reread]);
  return state;
}

/** The request a waiting run asks the person to answer, if any. */
export function openRequest(ai: BrainAi) {
  if (!ai.running) return undefined;
  for (let index = ai.events.length - 1; index >= 0; index--) {
    const event = ai.events[index];
    if (
      (event.type === 'permission' || event.type === 'question') &&
      !requestEnded(ai.events, index)
    )
      return event;
  }
  return undefined;
}

/** The person's latest instruction and how the run it started went. */
export function lastRun(ai: BrainAi) {
  const request = ai.events[lastIndex(ai.events, (event) => event.role === 'user')];
  const done = request && ai.events[lastIndex(ai.events, (event) => event.runId === request.runId)];
  return {
    request: request?.text,
    outcome: done?.type === 'done' ? done.outcome : undefined,
  };
}

/** What a running AI is doing now: its latest step or words. */
export function currentStep(ai: BrainAi) {
  return ai.events[
    lastIndex(
      ai.events,
      (event) => event.role !== 'user' && (event.type === 'tool' || event.type === 'text'),
    )
  ];
}
