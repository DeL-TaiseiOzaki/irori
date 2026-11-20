import type { AgentEvent, AgentId, RunOutcome } from './types';
import type { ConversationSummary } from './conversation';
import { eventTarget } from './agent-log';

/**
 * The session board (ADR 069): every conversation of the workspace that runs,
 * waits, has just ended or is open in a column, as a small card in a lane, with
 * the work it handed on as cards of their own beneath it.
 */

/** A sub-agent a CLI started inside a run with its own tool, as the run's log tells it. */
export interface SubAgent {
  /** The tool call that started it. */
  call: string;
  /** What it was asked, in one line. */
  label: string;
  /** The kind of agent, as the CLI names it (`Explore`, `worker`). */
  kind?: string;
  state: 'working' | 'done' | 'failed' | 'stopped';
}

/** What this device has seen of one conversation's runs, from their events. */
export interface SessionLive {
  /** The run in progress; absent once it ended. */
  runId?: string;
  /** Requests the run waits on: permissions and questions, by id. */
  requests: string[];
  /** The person's instruction that started the run, in one line. */
  prompt?: string;
  /** The step the run took last: a tool and what it is about, or a status. */
  step?: string;
  /** The end of the newest reply. */
  reply?: string;
  replyId?: string;
  /** The latest request's words, while one is open. */
  ask?: string;
  /** How the last run ended; absent while one runs or before any ended. */
  outcome?: RunOutcome;
  /** When its lane last changed: a run began or ended, a request opened or closed. */
  changedAt: number;
  subAgents: SubAgent[];
}

/**
 * The tools that start a CLI's own sub-agent and return when it finished, by the
 * name each CLI reports. The call's result ends the sub-agent.
 */
const subAgentTools = new Set([
  // Claude Code
  'Task',
  'Agent',
  // OpenCode
  'task',
  // Pi's sub-agent extension
  'subagent',
  // Hermes Agent
  'delegate_task',
]);
/**
 * Codex reports a sub-agent it started as a `subAgentActivity` item (0.166):
 * `started`, then `completed` or `interrupted` as an item of its own, both for
 * the sub-agent's thread. An earlier protocol reports a `collabAgentToolCall`
 * whose `spawnAgent` returns once the sub-agent began; its result names the
 * thread, and a later call's `agentsStates` says when that thread ended.
 */
const codexActivity = 'subAgentActivity';
const codexCollab = 'collabAgentToolCall';
const codexThread = (thread: string) => `codex:${thread}`;
const codexEnd: Record<string, SubAgent['state'] | undefined> = {
  completed: 'done',
  shutdown: 'done',
  interrupted: 'stopped',
  notFound: 'stopped',
  errored: 'failed',
};
/**
 * Antigravity's `invoke_subagent` step names the sub-agents it launches
 * (`subagents`: `type_name`, `role`, `initial_prompt`) and is done once they
 * were launched (1.5.12): what they report comes back later as a message of the
 * conversation, naming none of them. They are working until their run ends.
 */
const antigravityTool = 'invoke_subagent';

function firstLine(value: unknown, limit = 120) {
  if (typeof value !== 'string') return undefined;
  const line = value
    .split('\n')
    .map((part) => part.trim())
    .find(Boolean);
  return line ? line.slice(0, limit) : undefined;
}
function inputOf(details?: string): Record<string, unknown> {
  if (!details) return {};
  try {
    const value = JSON.parse(details) as unknown;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      // Claude Code's call is its input; others wrap it as `input` or, as Pi does, `args`.
      for (const key of ['input', 'args'])
        if (record[key] && typeof record[key] === 'object' && !Array.isArray(record[key]))
          return record[key] as Record<string, unknown>;
      return record;
    }
  } catch {
    // Details that are not JSON say nothing about the sub-agent.
  }
  return {};
}
const objects = (value: unknown) =>
  Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          !!item && typeof item === 'object' && !Array.isArray(item),
      )
    : [];

/** Adds a sub-agent unless one with its call is there already. */
function add(agents: SubAgent[], agent: Omit<SubAgent, 'state'>): SubAgent[] {
  return agents.some((item) => item.call === agent.call)
    ? agents
    : [...agents, { ...agent, state: 'working' }];
}
/** Ends a working sub-agent. */
function end(agents: SubAgent[], call: string, state: SubAgent['state']): SubAgent[] {
  return agents.some((agent) => agent.call === call && agent.state === 'working')
    ? agents.map((agent) =>
        agent.call === call && agent.state === 'working' ? { ...agent, state } : agent,
      )
    : agents;
}

/**
 * A run's sub-agents after one more of its tool events, or undefined when the
 * event says nothing of a sub-agent and is an ordinary step.
 */
export function foldSubAgents(agents: SubAgent[], event: AgentEvent): SubAgent[] | undefined {
  // A hand-off's steps, shown in the irori agent's log, belong to the vault's own conversation.
  if (event.type !== 'tool' || event.delegate) return undefined;
  const input = inputOf(event.details);
  if (input.type === codexActivity) {
    const thread = typeof input.agentThreadId === 'string' ? input.agentThreadId : undefined;
    // An activity item is complete as it starts; its result says nothing more.
    if (!thread || event.result) return agents;
    const call = codexThread(thread);
    if (input.kind === 'started') {
      const name = typeof input.agentPath === 'string' ? input.agentPath.split('/').pop() : '';
      return add(agents, { call, label: (name ?? '').replace(/_/g, ' ') });
    }
    const state = codexEnd[String(input.kind)];
    return state ? end(agents, call, state) : agents;
  }
  if (input.type === codexCollab) {
    if (!event.result) {
      if (input.tool !== 'spawnAgent' || !event.call) return agents;
      return add(agents, {
        call: event.call,
        label: firstLine(input.prompt) ?? '',
        ...(firstLine(input.model) && { kind: firstLine(input.model) }),
      });
    }
    let next = agents;
    if (input.tool === 'spawnAgent' && event.call) {
      const thread = (Array.isArray(input.receiverThreadIds) ? input.receiverThreadIds : []).find(
        (id): id is string => typeof id === 'string',
      );
      if (input.status === 'failed') next = end(next, event.call, 'failed');
      else if (thread)
        next = next.some((agent) => agent.call === codexThread(thread))
          ? next.filter((agent) => agent.call !== event.call)
          : next.map((agent) =>
              agent.call === event.call ? { ...agent, call: codexThread(thread) } : agent,
            );
    }
    const states = input.agentsStates;
    if (states && typeof states === 'object')
      for (const [thread, value] of Object.entries(states)) {
        const state = codexEnd[String((value as { status?: unknown } | null)?.status)];
        if (state) next = end(next, codexThread(thread), state);
      }
    return next;
  }
  if (event.text === antigravityTool) {
    if (event.result || !event.call) return agents;
    let next = agents;
    objects(input.subagents).forEach((agent, index) => {
      const kind = firstLine(agent.type_name);
      next = add(next, {
        call: `antigravity:${event.call}#${index}`,
        label: firstLine(agent.role) ?? firstLine(agent.initial_prompt) ?? kind ?? '',
        ...(kind && { kind }),
      });
    });
    return next;
  }
  if (event.result) {
    if (!event.call || !agents.some((agent) => agent.call === event.call)) return undefined;
    return end(
      agents,
      event.call,
      input.status === 'failed' || input.is_error === true ? 'failed' : 'done',
    );
  }
  if (!event.call || !subAgentTools.has(event.text)) return undefined;
  const kind =
    firstLine(input.subagent_type) ?? firstLine(input.agent_type) ?? firstLine(input.agent);
  const label =
    firstLine(input.description) ??
    firstLine(input.prompt) ??
    firstLine(input.task) ??
    firstLine(input.goal) ??
    kind ??
    '';
  return add(agents, { call: event.call, label, ...(kind && { kind }) });
}

const replyLimit = 240;

/** One conversation's state after one more of its events. */
export function foldSession(
  live: SessionLive | undefined,
  event: AgentEvent,
  now: number,
): SessionLive {
  const base: SessionLive = live ?? { requests: [], changedAt: now, subAgents: [] };
  // A person's message begins a run: what the last run showed is over.
  if (event.role === 'user')
    return {
      runId: event.runId,
      requests: [],
      prompt: firstLine(event.text, 200),
      changedAt: now,
      subAgents: [],
    };
  if (event.resolved) {
    if (!base.requests.includes(event.resolved)) return base;
    const requests = base.requests.filter((id) => id !== event.resolved);
    return { ...base, requests, ...(!requests.length && { ask: undefined }), changedAt: now };
  }
  if (event.type === 'done') {
    const end: SubAgent['state'] = event.outcome === 'completed' ? 'done' : 'stopped';
    return {
      ...base,
      runId: undefined,
      requests: [],
      ask: undefined,
      outcome: event.outcome ?? 'completed',
      changedAt: now,
      subAgents: base.subAgents.map((agent) =>
        agent.state === 'working' ? { ...agent, state: end } : agent,
      ),
    };
  }
  // Any other event of a run says it runs; one that ended no longer does.
  const running: SessionLive =
    base.runId === event.runId
      ? base
      : { ...base, runId: event.runId, outcome: undefined, changedAt: now };
  if (event.type === 'permission' || event.type === 'question') {
    const id = event.requestId ?? `${event.runId}:${event.text}`;
    if (running.requests.includes(id)) return running;
    return {
      ...running,
      requests: [...running.requests, id],
      ask: firstLine(event.text, 200),
      changedAt: now,
    };
  }
  // The irori agent's log follows a hand-off's steps; the vault's own card shows them.
  if (event.delegate) return running;
  if (event.type === 'tool') {
    const subAgents = foldSubAgents(running.subAgents, event);
    if (subAgents) {
      if (subAgents === running.subAgents) return running;
      // A sub-agent that began is the run's step; the newest one names it.
      const started = subAgents.filter(
        (agent) => !running.subAgents.some((item) => item.call === agent.call),
      );
      const last = started[started.length - 1];
      return { ...running, subAgents, ...(last && { step: last.label || event.text }) };
    }
    if (event.result) return running;
    const target = eventTarget(event.details);
    return { ...running, step: target ? `${event.text} · ${target}` : event.text };
  }
  if (event.type === 'text') {
    const reply =
      (running.replyId === event.id && event.id ? (running.reply ?? '') : '') + event.text;
    return { ...running, reply: reply.slice(-replyLimit), replyId: event.id };
  }
  if ((event.type === 'status' || event.type === 'error') && event.text.trim())
    return { ...running, step: firstLine(event.text, 200) };
  return running;
}

/**
 * A conversation's state as read from the host: its saved events with the
 * requests its run waits on now. Only a run in progress counts; a run that ended
 * before this read is no news.
 */
export function liveFromConversation(
  conversation: {
    events: AgentEvent[];
    requests?: AgentEvent[];
    activeRunId?: string;
  },
  now: number,
): SessionLive {
  let live: SessionLive = { requests: [], changedAt: now, subAgents: [] };
  for (const event of conversation.events) live = foldSession(live, event, now);
  if (!conversation.activeRunId)
    return {
      ...live,
      runId: undefined,
      requests: [],
      ask: undefined,
      outcome: undefined,
      subAgents: [],
    };
  live = { ...live, runId: conversation.activeRunId, requests: [], ask: undefined };
  for (const request of conversation.requests ?? []) live = foldSession(live, request, now);
  return live;
}

/** The lanes of the board, in the order they show. */
export const sessionLanes = ['attention', 'working', 'done', 'open'] as const;
export type SessionLane = (typeof sessionLanes)[number];

/** What a card's dot says. */
export type SessionState =
  'waiting' | 'failed' | 'running' | 'queued' | 'done' | 'stopped' | 'idle';

/** A conversation as the board lists it: its row, with whose it is. */
export type SessionRow = ConversationSummary & { scopeId: string };

export interface SessionCard {
  id: string;
  scopeId: string;
  agent: AgentId;
  title: string;
  state: SessionState;
  lane: SessionLane;
  queued: number;
  /** The line under the title: the request it waits on, its step, its last reply. */
  line?: string;
  /** What the person asked for in the run on show. */
  prompt?: string;
  /** Work the irori agent handed to a vault from it. */
  handOff: boolean;
  /** When its lane last changed, for ordering. */
  changedAt: number;
  /** Hand-offs this conversation made, as cards of their own. */
  children: SessionCard[];
  subAgents: SubAgent[];
}

export interface BoardInput {
  rows: SessionRow[];
  live: Record<string, SessionLive>;
  /** Conversations open as a tab or on show in a column. */
  open: ReadonlySet<string>;
  /** When the person last looked at each conversation: an ended run after that is news. */
  seen: Record<string, number>;
}

function stateOf(row: SessionRow, live: SessionLive | undefined, seen: number | undefined) {
  if (live?.requests.length) return 'waiting';
  // The host's row may be read before this device saw the run begin or end.
  const running = live ? !!live.runId : row.running;
  if (running) return 'running';
  if (row.queued) return 'queued';
  const news = !!live?.outcome && (seen === undefined || seen < live.changedAt);
  if (news && live.outcome === 'failed') return 'failed';
  if (news) return live.outcome === 'completed' ? 'done' : 'stopped';
  return 'idle';
}
const laneOf: Record<SessionState, SessionLane> = {
  waiting: 'attention',
  failed: 'attention',
  running: 'working',
  queued: 'working',
  done: 'done',
  stopped: 'done',
  idle: 'open',
};

function card(row: SessionRow, input: BoardInput): SessionCard {
  const live = input.live[row.id];
  const state = stateOf(row, live, input.seen[row.id]);
  const line =
    state === 'waiting'
      ? live?.ask
      : state === 'running'
        ? (live?.step ?? live?.reply)
        : (firstLine(live?.reply?.split('\n').filter(Boolean).at(-1)) ?? live?.step);
  return {
    id: row.id,
    scopeId: row.scopeId,
    agent: row.agent,
    title: row.title,
    state,
    lane: laneOf[state],
    queued: row.queued,
    ...(line && { line }),
    ...(live?.prompt && { prompt: live.prompt }),
    handOff: row.origin === 'hand-off',
    changedAt: Math.max(live?.changedAt ?? 0, Date.parse(row.updatedAt) || 0),
    children: [],
    subAgents: live?.subAgents ?? [],
  };
}

/**
 * The board's lanes: each card once, a hand-off under the conversation that
 * made it, newest change first. A conversation shows while it runs, waits, has
 * a queue, ended since the person last looked at it, or is open in a column; a
 * hand-off that shows brings the conversation that made it.
 */
export function sessionBoard(input: BoardInput): Record<SessionLane, SessionCard[]> {
  const cards = new Map(input.rows.map((row) => [row.id, card(row, input)]));
  const parentOf = new Map<string, string>();
  for (const row of input.rows)
    if (row.handedBy && row.handedBy !== row.id && cards.has(row.handedBy))
      parentOf.set(row.id, row.handedBy);
  const shows = (item: SessionCard) => item.state !== 'idle' || input.open.has(item.id);
  const shown = new Set<string>();
  for (const item of cards.values()) {
    if (!shows(item)) continue;
    shown.add(item.id);
    const parent = parentOf.get(item.id);
    if (parent) shown.add(parent);
  }
  const lanes = Object.fromEntries(sessionLanes.map((lane) => [lane, []])) as unknown as Record<
    SessionLane,
    SessionCard[]
  >;
  const newest = (a: SessionCard, b: SessionCard) => b.changedAt - a.changedAt;
  for (const id of shown) {
    const item = cards.get(id)!;
    const parent = parentOf.get(id);
    if (parent) cards.get(parent)!.children.push(item);
    else lanes[item.lane].push(item);
  }
  for (const item of cards.values()) item.children.sort(newest);
  for (const lane of sessionLanes) lanes[lane].sort(newest);
  return lanes;
}

/** Every card of the board, hand-offs included, as one list. */
export function boardCards(lanes: Record<SessionLane, SessionCard[]>) {
  const all: SessionCard[] = [];
  const walk = (items: SessionCard[]) => {
    for (const item of items) {
      all.push(item);
      walk(item.children);
    }
  };
  for (const lane of sessionLanes) walk(lanes[lane]);
  return all;
}
