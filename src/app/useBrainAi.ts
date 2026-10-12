import { useEffect, useState } from 'react';
import type { AgentEvent, AgentId } from '../domain/types';
import {
  appendConversationEvents,
  lastIndex,
  withRequests,
  type QueuedMessage,
} from '../domain/conversation';
import { requestEnded, runTasks } from '../domain/agent-log';
import { errorText } from './ErrorMessage';
import { hostEvents } from './host-events';

const host = window.irori;

export interface BrainAi {
  /** The conversation read: the one asked for, or the owner's on show. */
  id?: string;
  /** The CLI of that conversation, once it has begun. */
  agent?: AgentId;
  events: AgentEvent[];
  queued: QueuedMessage[];
  /** Instructions waiting across the owner's conversations. */
  pending: number;
  running: boolean;
  ready: boolean;
  error: string;
}

/**
 * One owner's agent as the Overview sees it: a conversation with the live
 * requests, its queue, and whether a run is in progress. Without a conversation
 * id it follows the owner's conversation on show, the one running first. Events
 * stream in; a run's start or end reads the conversation again, since the queue
 * and the conversation on show change then.
 */
export function useBrainAi(
  scopeId: string,
  agent: AgentId,
  refresh = 0,
  conversationId?: string,
  /** The workspace whose irori agent conversation is on show when none is named. */
  workspaceId?: string,
): BrainAi {
  const [state, setState] = useState<BrainAi>({
    events: [],
    queued: [],
    pending: 0,
    running: false,
    ready: false,
    error: '',
  });
  const [reread, setReread] = useState(0);
  useEffect(() => {
    let current = true;
    let shown = conversationId;
    let controlRevision = 0;
    // Streamed events join the state once per frame; a window without frames (hidden
    // or throttled) takes them within a moment, and on its return.
    let pending: AgentEvent[] = [];
    let frame: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      clearTimeout(timer);
      frame = timer = undefined;
      if (!pending.length) return;
      const batch = pending;
      pending = [];
      setState((previous) => ({
        ...previous,
        running: true,
        events: appendConversationEvents(previous.events, batch).slice(-120),
      }));
    };
    const schedule = () => {
      if (frame !== undefined || timer !== undefined) return;
      if (!document.hidden) frame = requestAnimationFrame(flush);
      timer = setTimeout(flush, 250);
    };
    const onVisible = () => {
      if (!document.hidden) flush();
    };
    document.addEventListener('visibilitychange', onVisible);
    void (async () => {
      while (current) {
        const before = controlRevision;
        const value = await host.agentConversation(scopeId, agent, conversationId, workspaceId);
        if (!current) return;
        // Request/run controls can race the host snapshot. Reread for them;
        // ordinary fragments must not restart a full-history read indefinitely.
        if (before !== controlRevision) continue;
        shown = value.id;
        // Events taken in while it was read land first and give way to it, as they did one by one.
        flush();
        setState({
          id: value.id,
          agent: value.summary?.agent,
          events: withRequests(value).slice(-120),
          queued: value.queued,
          pending: value.pending,
          running: !!value.activeRunId,
          ready: true,
          error: '',
        });
        return;
      }
    })().catch(
      (error) => current && setState((previous) => ({ ...previous, error: errorText(error) })),
    );
    const stop = hostEvents.onEvent((event) => {
      if (event.type !== 'agent') return;
      const incoming = event.event;
      if (incoming.scopeId !== scopeId) return;
      if (conversationId && incoming.conversationId !== conversationId) return;
      // A run of another conversation shows here only when it is the owner's on show.
      if (incoming.type === 'done' || incoming.role === 'user') {
        controlRevision++;
        // What arrived before it lands first, in the order it came.
        flush();
        setReread((value) => value + 1);
      } else if (!conversationId && shown && incoming.conversationId !== shown) return;
      else {
        if (incoming.type === 'permission' || incoming.type === 'question' || incoming.resolved)
          controlRevision++;
        pending.push(incoming);
        schedule();
      }
    });
    return () => {
      // Events taken in before the next read still land, as they did one by one.
      flush();
      current = false;
      stop();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [scopeId, agent, refresh, reread, conversationId, workspaceId]);
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

/** The latest run of a conversation, and whether it is still going. */
export function latestRun(ai: BrainAi) {
  const last = ai.events.at(-1);
  return last ? { runId: last.runId, active: ai.running } : undefined;
}

/** The irori agent's hand-offs still under way in a conversation, for the map's lines. */
export function openTasks(ai: BrainAi) {
  const run = latestRun(ai);
  return run && run.active
    ? runTasks(ai.events, run.runId, true).filter(
        (task) => task.state === 'working' || task.state === 'waiting',
      )
    : [];
}
