import { z } from 'zod';
import { sourceRef } from './knowledge';
import { skillName } from './skills';
import { agentIds, agentAccessModes, type AgentEvent } from './types';

export const messageInput = z.object({
  prompt: z
    .string()
    .min(1)
    .max(32000)
    .refine((value) => !!value.trim()),
  notePath: z.string().max(4096).optional(),
  newSession: z.boolean().optional(),
  access: z.enum(agentAccessModes).optional(),
  sources: z.array(sourceRef).max(20).optional(),
  skill: skillName.optional(),
  /** Tell the agent which lines of the note the person wrote or revised. */
  personLines: z.boolean().optional(),
  /** Brains handed to your AI; refused for a brain's own AI. */
  brains: z.array(z.uuid()).max(50).optional(),
});
export const startInput = messageInput.extend({ scopeId: z.uuid(), agent: z.enum(agentIds) });
export const queuedMessage = messageInput.extend({ id: z.uuid() });
export type QueuedMessage = z.infer<typeof queuedMessage>;
export interface Conversation {
  events: AgentEvent[];
  queued: QueuedMessage[];
  truncated: boolean;
  activeRunId?: string;
  /** Permissions and questions the active run is waiting on now. */
  requests?: AgentEvent[];
}

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

export function appendConversationEvent(events: AgentEvent[], event: AgentEvent) {
  const last = events.at(-1);
  return event.type === 'text' && last?.type === 'text' && last.runId === event.runId
    ? [...events.slice(0, -1), { ...last, text: last.text + event.text }]
    : [...events, event];
}
