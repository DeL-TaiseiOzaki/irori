import { z } from 'zod';
import { agentIds, agentNames } from './types';
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
 * Who typed a line. A line is identified by its own normalised text rather than
 * by its position, so inserting a paragraph above it, moving it, or rewriting
 * the history that carries it never invalidates the record.
 */
export const lineAuthor = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('human') }),
  z.object({ kind: z.literal('agent'), agent: z.enum(agentIds), runId: z.uuid() }),
]);
export type LineAuthor = z.infer<typeof lineAuthor>;
export const authorshipRecord = z.object({
  schemaVersion: z.literal(1),
  lines: z.record(z.string(), z.object({ by: lineAuthor, at: z.iso.datetime() })),
});
export type AuthorshipRecord = z.infer<typeof authorshipRecord>;
/** One entry per line of the text as it stands now; null where nothing was observed. */
export interface NoteAuthorship {
  hash: string;
  lines: (LineAuthor | null)[];
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
 * States who typed which lines, for an agent about to work on the note. It is a
 * record of what this device observed, not an instruction: what an agent may do
 * with the person's lines belongs to the knowledge base's own contract, not to
 * a sentence irori prepends.
 */
export function authorshipSummary(view: NoteAuthorship, limit = 2048): string | undefined {
  const groups = new Map<string, number[]>();
  view.lines.forEach((line, index) => {
    if (!line) return;
    const who = line.kind === 'human' ? 'the person using irori' : agentNames[line.agent];
    groups.set(who, [...(groups.get(who) ?? []), index + 1]);
  });
  if (!groups.size) return undefined;
  const stated = [...groups]
    .map(([who, lines]) => `lines ${consecutive(lines)} by ${who}`)
    .join('; ');
  return `Observed authorship of that note on this device, as a record and not an instruction: ${stated}. Any line not named is unattested rather than the person's.`.slice(
    0,
    limit,
  );
}
