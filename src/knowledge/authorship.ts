import path from 'node:path';
import { createHash } from 'node:crypto';
import { readLocalJson, writeLocalJson } from '../host/local-json';
import { SerialQueue } from '../host/serial-queue';
import { hash } from '../host/files';
import {
  authorshipRecord,
  lineAuthor,
  type AuthorshipRecord,
  type LineAuthor,
  type NoteAuthorship,
  type SourceRef,
} from '../domain/knowledge';

/**
 * A line with less than this much prose in it says nothing about who wrote it.
 * A blank line, a rule, a bare bullet or a lone brace appears in every note, so
 * attributing one to whoever typed the first of them would be worse than
 * leaving it unmarked. Punctuation and symbols do not count towards it.
 */
const leastSignificantCharacters = 3;
const decoration = /[\s\p{P}\p{S}]/gu;
/** Above this the record keeps only the lines the note still carries. */
const rememberedLines = 6000;

/**
 * The key is the line's meaning rather than its bytes. Rich editing renormalises
 * spacing and bullet markers on save without the reader having touched the line,
 * and a note is reflowed far more often than it is rewritten.
 */
export function lineKey(line: string): string | null {
  const normalised = line
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^[*+] /, '- ')
    .replace(/\\$/, '')
    .trim();
  if (normalised.replace(decoration, '').length < leastSignificantCharacters) return null;
  return createHash('sha256').update(normalised).digest('hex').slice(0, 16);
}

/**
 * Who typed each line of a note, kept on this device beside the other run and
 * source observations. Nothing is written into the knowledge base: the record
 * is an observation about the user's own work, not a fact the repository
 * carries, and a second device observes its own.
 */
export class AuthorshipStore {
  readonly directory: string;
  private queue = new SerialQueue();
  constructor(dataDir: string) {
    this.directory = path.join(dataDir, 'knowledge', 'authorship');
  }
  private file(ref: SourceRef) {
    if (!/^[0-9a-f-]{36}$/.test(ref.scopeId)) throw Error('Invalid scope');
    return path.join(this.directory, ref.scopeId, `${hash(ref.path)}.json`);
  }
  private async read(ref: SourceRef): Promise<AuthorshipRecord> {
    const stored = await readLocalJson(this.file(ref), null).catch(() => null);
    const parsed = authorshipRecord.safeParse(stored);
    // An unreadable record is an absent one: authorship is an aid, and losing it
    // must never stop a note from opening.
    return parsed.success ? parsed.data : { schemaVersion: 1, lines: {} };
  }
  /** Attributes the lines this text carries that were not observed before. */
  observe(ref: SourceRef, text: string, by: LineAuthor) {
    lineAuthor.parse(by);
    return this.queue.run(async () => {
      const record = await this.read(ref);
      const at = new Date().toISOString();
      let added = 0;
      for (const line of text.split('\n')) {
        const key = lineKey(line);
        if (!key || record.lines[key]) continue;
        record.lines[key] = { by, at };
        added++;
      }
      if (added) await writeLocalJson(this.file(ref), bounded(record, text));
      // A record this store cannot read back is the same as none at all, so the
      // write is checked here rather than discovered as silent forgetting later.
    });
  }
  /**
   * Resolves the record against the text as it stands now. It joins the same
   * queue as `observe`, so a caller that starts an observation without waiting
   * for it still reads the answer that includes it.
   */
  view(ref: SourceRef, text: string): Promise<NoteAuthorship> {
    return this.queue.run(async () => {
      const record = await this.read(ref);
      return {
        hash: hash(text),
        lines: text.split('\n').map((line) => {
          const key = lineKey(line);
          return key ? (record.lines[key]?.by ?? null) : null;
        }),
      };
    });
  }
}

function bounded(record: AuthorshipRecord, text: string): AuthorshipRecord {
  if (Object.keys(record.lines).length <= rememberedLines) return record;
  const present = new Set(text.split('\n').map(lineKey));
  return {
    schemaVersion: 1,
    lines: Object.fromEntries(Object.entries(record.lines).filter(([key]) => present.has(key))),
  };
}
