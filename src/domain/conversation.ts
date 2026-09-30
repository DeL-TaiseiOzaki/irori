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
export const messageInput = z.object({
  prompt: z
    .string()
    .min(1)
    .max(32000)
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
  const last = events.at(-1);
  return event.type === 'text' &&
    last?.type === 'text' &&
    last.runId === event.runId &&
    last.id === event.id
    ? [...events.slice(0, -1), { ...last, text: last.text + event.text }]
    : [...events, event];
}
