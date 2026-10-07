import { z } from 'zod';
import { sourceRef } from './knowledge';
import { skillName } from './skills';
import {
  agentIds,
  agentAccessModes,
  type AgentEvent,
  type AgentId,
  type AgentSession,
} from './types';

/** A model name as a CLI takes it: never an option, never shell syntax. */
export const agentModel = z.string().regex(/^\w[\w./:@[\]-]{0,199}$/);
/** The CLI your AI runs on and the model chosen for each CLI, kept on the device. */
export const yourAiChoice = z.object({
  agent: z.enum(agentIds),
  models: z.partialRecord(z.enum(agentIds), agentModel),
});
/** The longest instruction a person can send to an agent. */
export const promptLimit = 32000;
export const messageInput = z.object({
  prompt: z
    .string()
    .min(1)
    .max(promptLimit)
    .refine((value) => !!value.trim()),
  notePath: z.string().max(4096).optional(),
  access: z.enum(agentAccessModes).optional(),
  model: agentModel.optional(),
  sources: z.array(sourceRef).max(20).optional(),
  skill: skillName.optional(),
  /** Tell the agent which lines of the note the person wrote or revised. */
  personLines: z.boolean().optional(),
  /** Brains handed to your AI; refused for a brain's own AI. */
  brains: z.array(z.uuid()).max(50).optional(),
  /** The workspace an irori agent request was sent in; refused for a brain's own AI. */
  workspace: z.uuid().optional(),
});
export const startInput = messageInput.extend({
  scopeId: z.uuid(),
  agent: z.enum(agentIds),
  /** The conversation to continue; its owner's latest one for this CLI when absent. */
  conversationId: z.uuid().optional(),
});
export const queuedMessage = messageInput.extend({
  id: z.uuid(),
  /** When it was accepted: the owner's queue runs oldest first, whatever the conversation. */
  queuedAt: z.iso.datetime(),
});
export type QueuedMessage = z.infer<typeof queuedMessage>;

/**
 * One conversation's metadata (ADR 017 D2), beside its `events.jsonl`. Keys a later
 * version adds are kept, not refused, so an older irori still lists the conversation.
 */
export const conversationMeta = z.looseObject({
  schemaVersion: z.literal(1),
  id: z.uuid(),
  owner: z.object({
    kind: z.enum(['hibachi', 'irori-agent']),
    id: z.uuid(),
    /** The owner's name when the conversation began. */
    name: z.string().max(200),
  }),
  agent: z.enum(agentIds),
  model: agentModel.nullable(),
  title: z.string().min(1).max(200),
  titleSource: z.enum(['first-message', 'person', 'migration', 'routine']),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  /** The note selected when the conversation began, relative to the owner's root. */
  linkedNote: z.string().max(4096).nullable(),
  /** For the irori agent: the hibachis its hand-offs reached. */
  hibachis: z.array(z.uuid()).max(1000),
  pinned: z.boolean(),
  archived: z.boolean(),
  forkedFrom: z.object({ conversationId: z.uuid(), eventId: z.uuid() }).nullable(),
  /** A routine's agent step (ADR 016): the routine's run and the step's index. */
  routine: z.object({ runId: z.uuid(), step: z.number().int().min(0) }).optional(),
  /** Work the irori agent handed to this hibachi from one of its conversations. */
  handedBy: z.object({ conversationId: z.uuid() }).optional(),
  /** The native session per device: a handle, its access mode and the checkout's digest. */
  native: z.record(
    z.uuid(),
    z.object({
      handle: z.string().min(1).max(4096),
      access: z.enum(agentAccessModes),
      root: z.string().regex(/^[0-9a-f]{64}$/),
      /** The digest of the shared Schema the session last heard in full (ADR 027). */
      shared: z
        .string()
        .regex(/^[0-9a-f]{64}$/)
        .optional(),
    }),
  ),
});
export type ConversationMeta = z.infer<typeof conversationMeta>;
export type ConversationOwner = ConversationMeta['owner'];

/** One row of an owner's history list. */
export interface ConversationSummary {
  id: string;
  agent: AgentId;
  model: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
  linkedNote: string | null;
  pinned: boolean;
  archived: boolean;
  /** A routine's agent step or the irori agent's hand-off. */
  origin?: 'routine' | 'hand-off';
  running: boolean;
  queued: number;
}
/** A conversation whose metadata could not be read: it can only be deleted. */
export interface DamagedConversation {
  id: string;
  damaged: string;
}
export type ConversationRow = ConversationSummary | DamagedConversation;
export const isDamaged = (row: ConversationRow): row is DamagedConversation => 'damaged' in row;

export interface Conversation {
  /** The conversation on show; absent when its owner has none for this CLI yet. */
  id?: string;
  /** Absent for a conversation that has not begun (no instruction yet). */
  summary?: ConversationSummary;
  events: AgentEvent[];
  queued: QueuedMessage[];
  /** Instructions waiting across all the owner's conversations, this one included. */
  pending: number;
  /** Earlier events kept in the conversation but not sent to the view. */
  earlier: number;
  /** Lines of `events.jsonl` that could not be read. */
  damaged: number;
  activeRunId?: string;
  /** Permissions and questions the active run is waiting on now. */
  requests?: AgentEvent[];
  /** This device's native session for the conversation. */
  session: AgentSession;
}

const graphemes =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : undefined;
/** The first line of the first instruction, cut at 50 characters (ADR 017 D5). */
export function conversationTitle(prompt: string) {
  const line =
    prompt
      .split('\n')
      .map((value) => value.trim())
      .find(Boolean) ?? '';
  const characters = graphemes
    ? Array.from(graphemes.segment(line), (part) => part.segment)
    : Array.from(line);
  return characters.slice(0, 50).join('') || '…';
}
/** A title the person typed: one line, 1 to 200 characters. */
export const conversationName = z
  .string()
  .transform((value) => value.replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(1).max(200));

/** The last index whose item matches, or -1. */
export function lastIndex<T>(items: T[], match: (item: T) => boolean) {
  for (let index = items.length - 1; index >= 0; index--) if (match(items[index])) return index;
  return -1;
}

/**
 * The saved history with the live requests in place of their status lines, so
 * a waiting run can be answered from any view that opens it.
 */
export function withRequests(conversation: Conversation) {
  let events = conversation.events;
  for (const request of conversation.requests ?? []) {
    const index = lastIndex(
      events,
      (event) =>
        event.runId === request.runId && event.type === 'status' && event.text === request.text,
    );
    events =
      index < 0
        ? [...events, request]
        : [...events.slice(0, index), request, ...events.slice(index + 1)];
  }
  return events;
}

/** Streamed text joins the reply it continues: the same event id, or the same run for older records. */
export function appendConversationEvent(events: AgentEvent[], event: AgentEvent) {
  return appendConversationEvents(events, [event]);
}

/** Appends a batch of events as `appendConversationEvent` would one by one, copying the list once. */
export function appendConversationEvents(events: AgentEvent[], incoming: AgentEvent[]) {
  if (!incoming.length) return events;
  const next = events.slice();
  for (const event of incoming) {
    const last = next.at(-1);
    if (
      event.type === 'text' &&
      last?.type === 'text' &&
      last.runId === event.runId &&
      last.id === event.id
    )
      next[next.length - 1] = { ...last, text: last.text + event.text };
    else next.push(event);
  }
  return next;
}

/**
 * Joins events that arrived while the host's snapshot was being read onto that
 * snapshot, leaving out what it already holds: an event of the same id, and of a
 * reply still arriving the fragments the snapshot's text already ends with. The
 * host reads the history and then its native record before replying, so events
 * published in between are in neither; nothing is lost and nothing shown twice.
 */
export function mergeHeldEvents(snapshot: AgentEvent[], held: AgentEvent[]) {
  if (!held.length) return snapshot;
  const known = new Set<string>();
  for (const event of snapshot) if (event.id) known.add(event.id);
  const last = snapshot.at(-1);
  const fresh: AgentEvent[] = [];
  for (const event of held) {
    if (!event.id || !known.has(event.id)) {
      fresh.push(event);
      continue;
    }
    // Fragments continue only the newest reply; a reply another event followed is whole.
    if (event.type !== 'text' || last?.type !== 'text' || last.id !== event.id) continue;
    const included = coveredLength(last.text, event.text);
    if (included < event.text.length) fresh.push({ ...event, text: event.text.slice(included) });
  }
  return appendConversationEvents(snapshot, fresh);
}

/** The longest prefix of `fragments` that `text` ends with: the fragments the text already took. */
function coveredLength(text: string, fragments: string) {
  const limit = Math.min(text.length, fragments.length);
  if (!limit) return 0;
  // The fragments' border table, run over the text's tail: linear in both, however long.
  const pattern = fragments.slice(0, limit);
  const border = new Int32Array(pattern.length);
  for (let index = 1, length = 0; index < pattern.length; index++) {
    while (length > 0 && pattern[index] !== pattern[length]) length = border[length - 1];
    if (pattern[index] === pattern[length]) length++;
    border[index] = length;
  }
  let matched = 0;
  for (let index = text.length - limit; index < text.length; index++) {
    while (matched > 0 && (matched === pattern.length || pattern[matched] !== text[index]))
      matched = border[matched - 1];
    if (pattern[matched] === text[index]) matched++;
  }
  return matched;
}

/** The events a column keeps on show once a conversation grows; older ones are counted, not shown. */
export const viewWindow = 400;
/** The most of the newest reply a column keeps; a longer one keeps its end. */
export const viewTextLimit = 200000;

/**
 * Keeps the newest events and the end of the newest reply. A list within both
 * limits is returned as it is, so nothing re-renders for a trim that did nothing.
 */
export function trimConversation(
  events: AgentEvent[],
  limit = viewWindow,
  textLimit = viewTextLimit,
): { events: AgentEvent[]; dropped: number } {
  const dropped = Math.max(0, events.length - limit);
  let next = dropped ? events.slice(dropped) : events;
  const last = next.at(-1);
  if (last && last.text.length > textLimit)
    next = [...next.slice(0, -1), { ...last, text: last.text.slice(-textLimit) }];
  return { events: next, dropped };
}

/**
 * What identifies an event in a view while the window slides: its id, which a
 * streamed reply keeps across its fragments. A record without one is named by
 * its place, which an older record alone lacks.
 */
export function eventKey(event: AgentEvent, index: number) {
  return event.id ? `${event.runId}:${event.id}` : `${event.runId}-${index}`;
}
