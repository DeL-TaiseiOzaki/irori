import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

const version = 1;
// Trigrams narrow a query of three or more characters to candidate files; the
// line matcher decides the hits, so positions (detail=full) would be paid for
// and never read. Nothing ranks, so column sizes are not kept either.
const schema = `CREATE VIRTUAL TABLE notes USING fts5(
  path UNINDEXED, size UNINDEXED, mtime UNINDEXED, text,
  tokenize='trigram', detail=none, columnsize=0)`;

export interface IndexedFile {
  id: number;
  path: string;
  size: number;
  mtime: number;
  /** Rejected by the reading guards at this size and modification time. */
  unreadable: boolean;
}

/**
 * The FTS5 query that finds every file holding `query` as a substring, ignoring
 * case, as the line matcher does: an AND of the query's trigrams. FTS5 folds case
 * with Unicode 6.1 tables while the matcher uses the current ones, so each
 * non-ASCII letter is written in every case it takes.
 */
export function trigramQuery(query: string) {
  const chars = Array.from(query);
  const terms = new Set<string>();
  for (let start = 0; start + 3 <= chars.length; start++) {
    let forms = [''];
    for (const char of chars.slice(start, start + 3)) {
      const cases =
        char < '\x80'
          ? [char]
          : [...new Set([char, char.toLowerCase(), char.toUpperCase()])].filter(
              (form) => Array.from(form).length === 1,
            );
      forms = forms.flatMap((form) => cases.map((letter) => form + letter));
    }
    terms.add(`(${forms.map((form) => `"${form.replaceAll('"', '""')}"`).join(' OR ')})`);
  }
  return [...terms].join(' AND ');
}

/**
 * One SQLite database per knowledge base under the device's data directory,
 * holding the text of each eligible file with the size and modification time it
 * was read at. It is a cache: a file that is not a database, or one from another
 * schema version, is thrown away and rebuilt, and removing it loses nothing. The
 * walk in `SearchService` decides which rows still describe the file on disk.
 *
 * Writes are buffered and flushed in short synchronous transactions, never
 * across an await, so a request superseded mid-way cannot hold the write lock
 * against its successor, and a superseded request's buffer is simply dropped.
 */
export class SearchIndex {
  private readonly db: DatabaseSync;
  private nextId: number;
  private pending = { removed: [] as number[], added: [] as unknown[][], bytes: 0 };

  static async open(dataDir: string, scopeId: string) {
    z.uuid().parse(scopeId);
    const file = path.join(dataDir, 'search-index', `${scopeId}.sqlite`);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    try {
      return new SearchIndex(file);
    } catch {
      await SearchIndex.remove(file);
      return new SearchIndex(file);
    }
  }

  private static async remove(file: string) {
    for (const suffix of ['', '-wal', '-shm']) await rm(file + suffix, { force: true });
  }

  private constructor(private readonly file: string) {
    this.db = new DatabaseSync(file);
    try {
      const { user_version } = this.db.prepare('PRAGMA user_version').get() as {
        user_version: number;
      };
      // Creating the table fails when one from another version is there, which
      // sends the caller through the rebuild path.
      if (user_version !== version)
        this.db.exec(`PRAGMA journal_mode = WAL; ${schema}; PRAGMA user_version = ${version}`);
      this.db.exec('PRAGMA synchronous = NORMAL');
      const { max } = this.db.prepare('SELECT max(rowid) AS max FROM notes').get() as {
        max: number | null;
      };
      this.nextId = (max ?? 0) + 1;
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  /** Every indexed file by path. */
  files() {
    const rows = this.db
      .prepare('SELECT rowid AS id, path, size, mtime, text IS NULL AS unreadable FROM notes')
      .all() as (Omit<IndexedFile, 'unreadable'> & { unreadable: number })[];
    return new Map(rows.map((row) => [row.path, { ...row, unreadable: row.unreadable === 1 }]));
  }

  /** Records a file's text, or that it was unreadable, and returns its row id. */
  put(file: string, size: number, mtime: number, text: string | null) {
    const id = this.nextId++;
    this.pending.added.push([id, file, size, mtime, text]);
    this.pending.bytes += text?.length ?? 0;
    if (this.pending.added.length >= 64 || this.pending.bytes >= 1024 * 1024) this.flush();
    return id;
  }

  remove(id: number) {
    this.pending.removed.push(id);
    if (this.pending.removed.length >= 64) this.flush();
  }

  /** Writes the buffered changes in one transaction. */
  flush() {
    const { removed, added } = this.pending;
    if (!removed.length && !added.length) return;
    this.pending = { removed: [], added: [], bytes: 0 };
    this.db.exec('BEGIN');
    try {
      const drop = this.db.prepare('DELETE FROM notes WHERE rowid = ?');
      for (const id of removed) drop.run(id);
      const insert = this.db.prepare(
        'INSERT INTO notes(rowid, path, size, mtime, text) VALUES (?, ?, ?, ?, ?)',
      );
      for (const row of added) insert.run(...(row as [number, string, number, number, string]));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** Row ids of the files whose text can hold the query; a superset, never a miss. */
  matching(query: string) {
    const rows = this.db.prepare('SELECT rowid AS id FROM notes WHERE notes MATCH ?').all(query);
    return new Set(rows.map((row) => (row as { id: number }).id));
  }

  text(id: number) {
    const row = this.db.prepare('SELECT text FROM notes WHERE rowid = ?').get(id);
    return (row as { text: string | null } | undefined)?.text ?? null;
  }

  close() {
    if (this.db.isOpen) this.db.close();
  }

  /** Closes and deletes the database; the next request builds it again. */
  async discard() {
    this.close();
    await SearchIndex.remove(this.file);
  }
}
