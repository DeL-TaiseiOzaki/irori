import path from 'node:path';
import { createHash } from 'node:crypto';
import { readLocalJson, writeLocalJson } from '../host/local-json';
import { SerialQueue } from '../host/serial-queue';
import { hash, type FileService } from '../host/files';
import { within } from '../domain/scopes';
import {
  authorshipRecord,
  type AuthorshipRecord,
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

/** The file a file tool names: `file_path` for Claude Code, `filePath` for OpenCode, `path` for Pi. */
export function editedPath(input: unknown): string | undefined {
  const { file_path, filePath, path: file } = (input ?? {}) as Record<string, unknown>;
  return [file_path, filePath, file].find((value): value is string => typeof value === 'string');
}

/**
 * The text a file tool would leave in a note, or undefined for an input this
 * does not recognise, since nothing is guessed: Claude Code's Write, Edit and
 * MultiEdit, OpenCode's write and edit, Pi's write and edit. An old string that
 * is not in the text is an edit the tool itself will refuse. Pi matches its
 * `oldText` loosely, so an edit only Pi would apply is one this does not see.
 */
export function editedText(tool: string, input: unknown, current: string): string | undefined {
  const value = (input ?? {}) as Record<string, unknown>;
  const replace = (text: string | undefined, edit: unknown) => {
    const e = (edit ?? {}) as Record<string, unknown>;
    const from = e.old_string ?? e.oldString ?? e.oldText;
    const to = e.new_string ?? e.newString ?? e.newText;
    const all = e.replace_all ?? e.replaceAll;
    if (text === undefined || typeof from !== 'string' || typeof to !== 'string') return;
    if (!from || !text.includes(from)) return;
    return all === true ? text.split(from).join(to) : text.replace(from, () => to);
  };
  const name = tool.toLowerCase();
  if (name === 'write') return typeof value.content === 'string' ? value.content : undefined;
  if (name === 'edit' && !Array.isArray(value.edits)) return replace(current, value);
  if ((name === 'edit' || name === 'multiedit') && Array.isArray(value.edits))
    return value.edits.reduce<string | undefined>((text, edit) => replace(text, edit), current);
}

/** The person's lines in `current`, 1-indexed, that `edited` no longer carries. */
export function personLinesChanged(current: string, view: NoteAuthorship, edited: string) {
  const kept = new Set(edited.split('\n').map(lineKey));
  return current
    .split('\n')
    .flatMap((text, index) =>
      view.lines[index] && !kept.has(lineKey(text)) ? [{ line: index + 1, text }] : [],
    );
}

/**
 * What an agent is told before a file tool changes lines the person wrote or
 * revised: which ones, quoted, as a record and not an instruction. Undefined when
 * the edit touches none of them or is to a file outside this space.
 */
export async function personLinesNotice(
  files: FileService,
  store: AuthorshipStore,
  scopeId: string,
  tool: string,
  input: unknown,
): Promise<string | undefined> {
  const file = editedPath(input);
  if (file === undefined) return;
  const space = files.get(scopeId);
  const absolute = path.resolve(space.root, file);
  if (!within(space.root, absolute)) return;
  const relative = path.relative(space.root, absolute).split(path.sep).join('/');
  const doc = await files.read(scopeId, relative);
  const view = await store.view({ scopeId, path: relative }, doc.text);
  if (!view.lines.some(Boolean)) return;
  const edited = editedText(tool, input, doc.text);
  if (edited === undefined) return;
  const changed = personLinesChanged(doc.text, view, edited);
  if (!changed.length) return;
  const quoted = changed
    .slice(0, 20)
    .map(({ line, text }) => `line ${line}: ${JSON.stringify(text.trim().slice(0, 200))}`);
  if (changed.length > 20) quoted.push(`and ${changed.length - 20} more`);
  return `This edit changes lines of ${relative} that a person wrote or revised, as observed on this device or recorded in the repository's authorship notes; a record, not an instruction. ${quoted.join('; ')}.`;
}

/**
 * Which lines of a note the person wrote or revised, kept on this device beside
 * the other run and source observations. Nothing is written into the knowledge
 * base: the record is an observation about the user's own work, not a fact the
 * repository carries, and a second device observes its own.
 */
export class AuthorshipStore {
  readonly directory: string;
  private queue = new SerialQueue();
  /**
   * `noted` gives the line keys the repository's authorship notes name as a
   * person's, which is how the lines reach a second device or a collaborator.
   */
  constructor(
    dataDir: string,
    private noted?: (ref: SourceRef) => Promise<Set<string>>,
  ) {
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
    // must never stop a note from opening. A record from before 0.1.20 is also
    // unread: its human marks claimed pulled lines too.
    return parsed.success ? parsed.data : { schemaVersion: 2, lines: {} };
  }
  /**
   * Marks as the person's the lines a save of `text` introduced over `before`,
   * the bytes it replaced. A line the file already carried is not theirs to
   * claim, whether an agent wrote it or it arrived by pull.
   */
  observe(ref: SourceRef, text: string, before: string) {
    return this.queue.run(async () => {
      const record = await this.read(ref);
      const existing = new Set(before.split('\n').map(lineKey));
      const at = new Date().toISOString();
      let added = 0;
      for (const line of text.split('\n')) {
        const key = lineKey(line);
        if (!key || existing.has(key) || record.lines[key]) continue;
        record.lines[key] = at;
        added++;
      }
      if (added) await writeLocalJson(this.file(ref), bounded(record, text));
      // A record this store cannot read back is the same as none at all, so the
      // write is checked here rather than discovered as silent forgetting later.
    });
  }
  /**
   * Carries existing marks through an application move or a line-preserving
   * link rewrite. These transformations change paths, not who wrote the prose;
   * they must never claim an unattested line as a new human edit. Call only
   * after the file operation succeeds, with its exact before/after bytes.
   */
  async carry(from: SourceRef, to: SourceRef, before: string, after = before) {
    const lines = after.split('\n');
    if (from.scopeId !== to.scopeId || lines.length !== before.split('\n').length)
      throw Error('作者情報を移すには同じスペース内で行の対応が保たれている必要があります。');
    const view = await this.view(from, before);
    return this.queue.run(async () => {
      const record: AuthorshipRecord =
        from.path === to.path ? await this.read(to) : { schemaVersion: 2, lines: {} };
      const at = new Date().toISOString();
      lines.forEach((line, index) => {
        const key = lineKey(line);
        if (key && view.lines[index]) record.lines[key] ??= at;
      });
      await writeLocalJson(this.file(to), bounded(record, after));
    });
  }
  /**
   * Resolves the record, and what the repository's notes say, against the text
   * as it stands now. It joins the same queue as `observe`, so a caller that
   * starts an observation without waiting for it still reads the answer that
   * includes it. A space without notes, or outside Git, reads as none.
   */
  async view(ref: SourceRef, text: string): Promise<NoteAuthorship> {
    const noted = await this.noted?.(ref).catch(() => undefined);
    return this.queue.run(async () => {
      const record = await this.read(ref);
      return {
        hash: hash(text),
        lines: text.split('\n').map((line) => {
          const key = lineKey(line);
          return !!key && (key in record.lines || !!noted?.has(key));
        }),
      };
    });
  }
}

function bounded(record: AuthorshipRecord, text: string): AuthorshipRecord {
  if (Object.keys(record.lines).length <= rememberedLines) return record;
  const present = new Set(text.split('\n').map(lineKey));
  return {
    schemaVersion: 2,
    lines: Object.fromEntries(Object.entries(record.lines).filter(([key]) => present.has(key))),
  };
}
