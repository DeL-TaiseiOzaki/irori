import { z } from 'zod';
import { sourceRef } from './knowledge';
import { skillName } from './skills';
import { agentIds, type AgentEvent } from './types';

export const messageInput = z.object({
  prompt: z
    .string()
    .min(1)
    .max(32000)
    .refine((value) => !!value.trim()),
  notePath: z.string().max(4096).optional(),
  newSession: z.boolean().optional(),
  sources: z.array(sourceRef).max(20).optional(),
  skill: skillName.optional(),
  /** Tell the agent which lines of the note the person wrote or revised. */
  personLines: z.boolean().optional(),
});
export const startInput = messageInput.extend({ scopeId: z.uuid(), agent: z.enum(agentIds) });
export const queuedMessage = messageInput.extend({ id: z.uuid() });
export type QueuedMessage = z.infer<typeof queuedMessage>;
export interface Conversation {
  events: AgentEvent[];
  queued: QueuedMessage[];
  truncated: boolean;
  activeRunId?: string;
}

export function appendConversationEvent(events: AgentEvent[], event: AgentEvent) {
  const last = events.at(-1);
  return event.type === 'text' && last?.type === 'text' && last.runId === event.runId
    ? [...events.slice(0, -1), { ...last, text: last.text + event.text }]
    : [...events, event];
}
