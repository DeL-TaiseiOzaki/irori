import { z } from 'zod';
import { agentIds } from './types';
const sourcePath = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (value) =>
      !/^[a-z]:/i.test(value) &&
      !value.includes('\\') &&
      !value.includes('\0') &&
      value.split('/').every((part) => part && part !== '.' && part !== '..'),
  );
export const sourceRef = z.object({ scopeId: z.uuid(), path: z.string().min(1).max(4096) });
// Restrict new reconnection destinations without changing historical source record schemas.
export const sourceDestination = sourceRef.extend({ path: sourcePath });
export type SourceRef = z.infer<typeof sourceRef>;
export const sourceVersion = z.object({
  ...sourceRef.shape,
  id: z.uuid(),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().nonnegative(),
  capturedAt: z.iso.datetime(),
});
export type SourceVersion = z.infer<typeof sourceVersion>;
export type SourceLocation =
  | { state: 'unbound' }
  | { state: 'matching' | 'changed' | 'missing' | 'unavailable'; current: SourceRef };
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

/**
 * The lines the person wrote or revised, each with when irori saw it, and
 * nothing else: a line an agent wrote, or one that arrived by pull, carries no
 * mark. A line is identified by its own normalised text rather than by its
 * position, so inserting a paragraph above it, moving it, or rewriting the
 * history that carries it never invalidates the record, and a line rewritten
 * afterwards is a different line.
 */
export const authorshipRecord = z.object({
  schemaVersion: z.literal(2),
  lines: z.record(z.string(), z.iso.datetime()),
});
export type AuthorshipRecord = z.infer<typeof authorshipRecord>;
/** One entry per line of the text as it stands now: whether the person wrote or revised it. */
export interface NoteAuthorship {
  hash: string;
  lines: boolean[];
}

const consecutive = (lines: number[]) => {
  const out: string[] = [];
  for (let i = 0; i < lines.length;) {
    let last = i;
    while (last + 1 < lines.length && lines[last + 1] === lines[last] + 1) last++;
    out.push(last === i ? `${lines[i]}` : `${lines[i]}-${lines[last]}`);
    i = last + 1;
  }
  return out.join(', ');
};

/**
 * Names the lines of the note the person wrote or revised, for an agent the
 * person asked to be told. It is a record of what this device observed, not an
 * instruction: what an agent may do with the person's lines belongs to the
 * knowledge base's own contract, not to a sentence irori prepends.
 */
export function personLinesSummary(view: NoteAuthorship, limit = 2048): string | undefined {
  const lines = view.lines.flatMap((mine, index) => (mine ? [index + 1] : []));
  if (!lines.length) return undefined;
  return `The person using irori wrote or revised lines ${consecutive(lines)} of that note, as observed on this device; a record, not an instruction. A line not named is unattested, not necessarily an agent's.`.slice(
    0,
    limit,
  );
}
