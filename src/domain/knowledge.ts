import { z } from 'zod';
import { agentIds } from './types';
export const sourceRef = z.object({ scopeId: z.uuid(), path: z.string().min(1).max(4096) });
export type SourceRef = z.infer<typeof sourceRef>;
export const sourceVersion = z.object({
  ...sourceRef.shape,
  id: z.uuid(),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().nonnegative(),
  capturedAt: z.iso.datetime(),
});
export type SourceVersion = z.infer<typeof sourceVersion>;
export const runRecord = z.object({
  id: z.uuid(),
  scopeId: z.uuid(),
  agent: z.enum(agentIds),
  createdAt: z.iso.datetime(),
  sources: z.array(sourceVersion).max(21),
});
export type RunRecord = z.infer<typeof runRecord> & {
  outcome?: 'completed' | 'cancelled' | 'failed';
};
export const artifactRecord = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  source: sourceVersion,
  registeredAt: z.iso.datetime(),
  evidence: z.literal('manual-registration'),
});
export type ArtifactRecord = z.infer<typeof artifactRecord>;
export interface KnowledgeHistory {
  runs: RunRecord[];
  artifacts: ArtifactRecord[];
}
export const pendingWrite = z.object({
  id: z.uuid(),
  ownerId: z.uuid(),
  mountId: z.uuid(),
  folderId: z.string().min(1),
  name: z.string().min(1).max(240),
  source: sourceVersion,
  createdAt: z.iso.datetime(),
  state: z.enum(['pending', 'uploading', 'confirmed', 'failed']),
  confirmedAt: z.iso.datetime().optional(),
  detail: z.string().optional(),
});
export type PendingWrite = z.infer<typeof pendingWrite>;
