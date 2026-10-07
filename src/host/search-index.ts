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
 * against its successor. Concurrent scans share the connection and row ids;
 * a superseded request still flushes the files it finished checking. Replaced
 * rows stay readable until the scans holding them finish with their snapshots.
 */
export class SearchIndex {
  private static opened = new Map<string, { index: SearchIndex; users: number }>();
  private static opening = new Map<string, Promise<SearchIndex>>();
  private static removing = new Map<string, Promise<void>>();
  private readonly db: DatabaseSync;
  private nextId: number;
  private rows = new Map<string, IndexedFile>();
  private paths = new Map<number, string>();
  private retired = new Set<number>();
  private readers = new Map<number, number>();
  private damaged = false;
  private pending = { removed: [] as number[], added: [] as unknown[][], bytes: 0 };

  static async open(dataDir: string, scopeId: string) {
    z.uuid().parse(scopeId);
    const file = path.join(dataDir, 'search-index', `${scopeId}.sqlite`);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await SearchIndex.removing.get(file);
    const existing = SearchIndex.opened.get(file);
    if (existing) {
      existing.index.check();
      existing.users++;
      return existing.index;
    }
    let opening = SearchIndex.opening.get(file);
    if (!opening) {
      opening = (async () => {
        let index: SearchIndex;
        try {
          index = new SearchIndex(file);
        } catch {
          await SearchIndex.remove(file);
          index = new SearchIndex(file);
        }
        SearchIndex.opened.set(file, { index, users: 0 });
        return index;
      })().finally(() => SearchIndex.opening.delete(file));
      SearchIndex.opening.set(file, opening);
    }
    const index = await opening;
    SearchIndex.opened.get(file)!.users++;
    return index;
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
      const candidates = this.db
        .prepare("SELECT name FROM sqlite_master WHERE name = 'link_candidates'")
        .get();
      if (!candidates) {
        // Every destination linksTo accepts contains ]( or ]:, irrespective of
        // relative paths, escaping, percent encoding, Unicode or case folding.
        this.db.exec(`CREATE TABLE link_candidates (id INTEGER PRIMARY KEY);
          INSERT INTO link_candidates SELECT rowid FROM notes
          WHERE instr(text, '](') > 0 OR instr(text, ']:') > 0`);
      }
      const { max } = this.db.prepare('SELECT max(rowid) AS max FROM notes').get() as {
        max: number | null;
      };
      this.nextId = (max ?? 0) + 1;
      const rows = this.db
        .prepare('SELECT rowid AS id, path, size, mtime, text IS NULL AS unreadable FROM notes')
        .all() as (Omit<IndexedFile, 'unreadable'> & { unreadable: number })[];
      this.rows = new Map(
        rows.map((row) => [row.path, { ...row, unreadable: row.unreadable === 1 }]),
      );
      this.paths = new Map([...this.rows.values()].map((row) => [row.id, row.path]));
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  /** Every indexed file by path. */
  files() {
    this.check();
    this.flush();
    return new Map(this.rows);
  }

  retain(id: number) {
    this.readers.set(id, (this.readers.get(id) ?? 0) + 1);
  }

  /** Retire only rows no scan still needs, even while other requests keep arriving. */
  release(ids: Set<number>) {
    for (const id of ids) {
      const readers = (this.readers.get(id) ?? 1) - 1;
      if (readers) this.readers.set(id, readers);
      else this.readers.delete(id);
    }
    const removed = new Set<number>();
    for (const id of this.retired) {
      if (this.readers.has(id)) continue;
      removed.add(id);
      this.retired.delete(id);
      this.paths.delete(id);
      this.pending.removed.push(id);
    }
    this.pending.added = this.pending.added.filter((row) => !removed.has(row[0] as number));
  }

  /** Records a file's text, or that it was unreadable, and returns its row id. */
  put(file: string, size: number, mtime: number, text: string | null, previous?: number) {
    this.check();
    const current = this.rows.get(file);
    if (
      current &&
      current.size === size &&
      current.mtime === mtime &&
      current.unreadable === (text === null)
    )
      return current.id;
    const id = this.nextId++;
    // A read started against an older row must not replace a newer scan's
    // observation. It can still match its own checked text through this row.
    if (current?.id === previous) {
      if (current) this.remove(current.id);
      this.rows.set(file, { id, path: file, size, mtime, unreadable: text === null });
    } else this.retired.add(id);
    this.paths.set(id, file);
    this.pending.added.push([id, file, size, mtime, text]);
    this.pending.bytes += text?.length ?? 0;
    if (this.pending.added.length >= 64 || this.pending.bytes >= 1024 * 1024) this.flush();
    return id;
  }

  remove(id: number) {
    this.check();
    const file = this.paths.get(id);
    if (file && this.rows.get(file)?.id === id) this.rows.delete(file);
    this.retired.add(id);
  }

  /** Writes the buffered changes in one transaction. */
  flush() {
    if (!this.db.isOpen || this.damaged) return;
    const { removed, added } = this.pending;
    if (!removed.length && !added.length) return;
    this.pending = { removed: [], added: [], bytes: 0 };
    this.db.exec('BEGIN');
    try {
      const drop = this.db.prepare('DELETE FROM notes WHERE rowid = ?');
      const dropCandidate = this.db.prepare('DELETE FROM link_candidates WHERE id = ?');
      for (const id of removed) {
        drop.run(id);
        dropCandidate.run(id);
      }
      const insert = this.db.prepare(
        'INSERT INTO notes(rowid, path, size, mtime, text) VALUES (?, ?, ?, ?, ?)',
      );
      const candidate = this.db.prepare('INSERT OR IGNORE INTO link_candidates(id) VALUES (?)');
      for (const row of added) {
        insert.run(...(row as [number, string, number, number, string]));
        const text = row[4] as string | null;
        if (text?.includes('](') || text?.includes(']:')) candidate.run(row[0] as number);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** Row ids of the files whose text can hold the query; a superset, never a miss. */
  matching(query: string) {
    this.check();
    const rows = this.db.prepare('SELECT rowid AS id FROM notes WHERE notes MATCH ?').all(query);
    return new Set(rows.map((row) => (row as { id: number }).id));
  }

  /** A syntax-only superset of backlink candidates; the link matcher decides the hits. */
  linking() {
    this.check();
    return new Set(
      this.db
        .prepare('SELECT id FROM link_candidates')
        .all()
        .map((row) => row.id as number),
    );
  }

  text(id: number) {
    this.check();
    const row = this.db.prepare('SELECT text FROM notes WHERE rowid = ?').get(id);
    return (row as { text: string | null } | undefined)?.text ?? null;
  }

  close() {
    const shared = SearchIndex.opened.get(this.file);
    if (shared?.index !== this || --shared.users > 0) return;
    SearchIndex.opened.delete(this.file);
    try {
      if (!this.damaged) {
        this.pending.removed.push(...this.retired);
        this.pending.added = this.pending.added.filter(
          (row) => !this.retired.has(row[0] as number),
        );
        this.flush();
      }
    } finally {
      if (this.db.isOpen) this.db.close();
      if (this.damaged) {
        const removing = SearchIndex.remove(this.file).finally(() =>
          SearchIndex.removing.delete(this.file),
        );
        SearchIndex.removing.set(this.file, removing);
        void removing.catch(() => {});
      }
    }
  }

  private check() {
    if (this.damaged)
      throw Object.assign(Error('The search cache must be rebuilt'), { code: 'ERR_SQLITE_ERROR' });
  }

  /** The last overlapping reader closes and deletes this damaged cache. */
  async discard() {
    this.damaged = true;
  }
}
