import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';

/**
 * The Git AI Standard v3 authorship log: attestation lines, a `---` divider
 * and JSON metadata, attached to a commit as a note under `refs/notes/ai`.
 * Read and written the way git-ai's own implementation does, so that a note
 * either tool writes is one the other reads.
 */
export const notesRef = 'refs/notes/ai';
export const schemaVersion = 'authorship/3.0.0';

export interface NoteEntry {
  key: string;
  /** Kept as written: another tool's ranges are re-emitted, never reformatted. */
  ranges: string;
}
export interface NoteFile {
  path: string;
  entries: NoteEntry[];
}
export interface Note {
  files: NoteFile[];
  metadata: Record<string, unknown>;
}

const rangePattern = /^\d{1,9}(?:-\d{1,9})?(?:,\d{1,9}(?:-\d{1,9})?)*$/;
const agentRecord = z.object({ agent_id: z.object({ tool: z.string().min(1).max(64) }) });

export function parseNote(text: string): Note | undefined {
  const lines = text.split('\n');
  const divider = lines.indexOf('---');
  if (divider < 0) return;
  let metadata: unknown;
  try {
    metadata = JSON.parse(lines.slice(divider + 1).join('\n'));
  } catch {
    return;
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return;
  const files: NoteFile[] = [];
  for (const raw of lines.slice(0, divider)) {
    const line = raw.trimEnd();
    if (!line) continue;
    if (line.startsWith('  ')) {
      const entry = line.slice(2),
        space = entry.indexOf(' '),
        file = files[files.length - 1];
      if (space < 1 || !file || !rangePattern.test(entry.slice(space + 1))) return;
      file.entries.push({ key: entry.slice(0, space), ranges: entry.slice(space + 1) });
    } else {
      const quoted = line.length > 1 && line.startsWith('"') && line.endsWith('"');
      files.push({ path: quoted ? line.slice(1, -1) : line, entries: [] });
    }
  }
  return {
    files: files.filter((file) => file.entries.length),
    metadata: metadata as Record<string, unknown>,
  };
}

export function formatNote(note: Note): string {
  let out = '';
  for (const file of note.files) {
    if (!file.entries.length) continue;
    out += (/[ \t\n]/.test(file.path) ? `"${file.path}"` : file.path) + '\n';
    for (const entry of file.entries) out += `  ${entry.key} ${entry.ranges}\n`;
  }
  return out + '---\n' + JSON.stringify(note.metadata, null, 2) + '\n';
}

/**
 * The 1-indexed lines a range specification names, within a file of `count`
 * lines, each once and in order. A note arrives from other people's pushes, so
 * overlapping ranges are merged first: the work stays within the file's length
 * however many times a range repeats.
 */
export function rangeLines(ranges: string, count: number): number[] {
  const out: number[] = [];
  if (ranges.length > 16384 || !rangePattern.test(ranges)) return out;
  const spans = ranges
    .split(',')
    .map((part) => part.split('-').map(Number))
    .map(([start, end = start]) => [Math.max(start, 1), Math.min(end, count)])
    .sort((a, b) => a[0] - b[0]);
  for (const [start, end] of spans)
    for (let n = Math.max(start, (out.at(-1) ?? 0) + 1); n <= end; n++) out.push(n);
  return out;
}

/**
 * The tool an attestation key's AI session names. A human key (`h_`) and a key
 * the metadata does not describe give nothing, as they do in git-ai's reader.
 */
export function noteTool(note: Note, key: string): string | undefined {
  if (key.startsWith('h_')) return;
  const records = note.metadata[key.startsWith('s_') ? 'sessions' : 'prompts'];
  const record = agentRecord.safeParse(
    (records as Record<string, unknown> | undefined)?.[key.split('::')[0]],
  );
  return record.success ? record.data.agent_id.tool : undefined;
}

/** `s_` + SHA-256(`tool:id`)[0..14], the standard's derivation of a session id. */
export const sessionId = (tool: string, id: string) =>
  's_' + createHash('sha256').update(`${tool}:${id}`).digest('hex').slice(0, 14);
/** Unique per note written, as the standard asks of a checkpoint's trace id. */
export const traceId = () => 't_' + randomBytes(7).toString('hex');
