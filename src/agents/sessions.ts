import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AgentId } from '../domain/types';
import { agentIds, agentAccessModes } from '../domain/types';

/** A run's space, CLI and exact checkout. */
export type SessionBinding = { scopeId: string; agent: AgentId; root: string };
/** The file name irori gave a binding's records before ADR 017. */
export function sessionKey(binding: SessionBinding) {
  return createHash('sha256')
    .update(JSON.stringify([binding.scopeId, binding.agent, binding.root]))
    .digest('hex');
}
/**
 * A native session handle as `agent-sessions/` kept it before ADR 017. Handles now
 * live in each conversation's metadata; these records are only read to migrate them.
 */
export const legacySession = z
  .object({
    schemaVersion: z.literal(1),
    scopeId: z.uuid(),
    agent: z.enum(agentIds),
    root: z.string().min(1),
    handle: z.string().min(1).max(4096),
    access: z.enum(agentAccessModes).default('default'),
    updatedAt: z.iso.datetime(),
  })
  .strict();
