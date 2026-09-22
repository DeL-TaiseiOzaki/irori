import { createHash } from 'node:crypto';

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
 * `h_` + SHA-256(`Name <email>`)[0..14], the standard's key for a human author,
 * derived from the identity Git records for the commit. The key is all irori
 * writes: an agent's lines are left unattested rather than claimed.
 */
export const humanId = (identity: string) =>
  'h_' + createHash('sha256').update(identity).digest('hex').slice(0, 14);
/** A key naming a person; session (`s_`) and legacy prompt keys name an agent. */
export const isHuman = (key: string) => /^h_[0-9a-f]{14}$/.test(key);
