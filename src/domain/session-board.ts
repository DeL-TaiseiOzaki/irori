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

/** The tools that start a CLI's own sub-agent, by the name each CLI reports. */
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
/** Codex reports a sub-agent as a collaboration item whose tool spawns it. */
const codexCollab = 'collabAgentToolCall';

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

/** The sub-agent a tool call starts, or undefined for any other call. */
export function subAgentStart(event: AgentEvent): Omit<SubAgent, 'state'> | undefined {
  // A hand-off's steps, shown in the irori agent's log, belong to the vault's own conversation.
  if (event.type !== 'tool' || event.result || !event.call || event.delegate) return undefined;
  const input = inputOf(event.details);
  if (event.text === codexCollab) {
    if (input.tool !== 'spawnAgent') return undefined;
  } else if (!subAgentTools.has(event.text)) return undefined;
  const kind =
    firstLine(input.subagent_type) ?? firstLine(input.agent_type) ?? firstLine(input.agent);
  const label =
    firstLine(input.description) ??
    firstLine(input.prompt) ??
    firstLine(input.task) ??
    firstLine(input.goal) ??
    kind ??
    '';
  return { call: event.call, label, ...(kind && { kind }) };
}

/** Whether a tool's result reports a failure: Codex's item status, or an error flag. */
function failed(details?: string) {
  const input = inputOf(details);
  return input.status === 'failed' || input.is_error === true;
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
    const started = subAgentStart(event);
    if (started)
      return {
        ...running,
        step: started.label || event.text,
        subAgents: [...running.subAgents, { ...started, state: 'working' }],
      };
    if (event.result && event.call) {
      const at = running.subAgents.findIndex((agent) => agent.call === event.call);
      if (at >= 0) {
        const subAgents = running.subAgents.slice();
        subAgents[at] = { ...subAgents[at], state: failed(event.details) ? 'failed' : 'done' };
        return { ...running, subAgents };
      }
      return running;
    }
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
