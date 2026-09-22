import type { Stats } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { linksTo, samePath } from '../domain/note-links';
import { classify } from '../domain/scopes';
import { searchQuery, type KnowledgeSearch } from '../domain/search';
import type { Entry, Space } from '../domain/types';
import { FileService, textFilePattern } from './files';
import { foldsCase } from './links';
import { SearchIndex, trigramQuery } from './search-index';

export const searchLimits = {
  files: 50000,
  entries: 100000,
  bytes: 32 * 1024 * 1024,
  fileBytes: 2 * 1024 * 1024,
  hits: 200,
  milliseconds: 5000,
};

function searchable(space: Space, relative: string) {
  return (
    classify(space, relative) === 'Knowledge_Base' &&
    relative.split('/').every((part) => !part.startsWith('.') && part !== 'node_modules')
  );
}

/** Search saved local text through the same scope boundaries as the explorer. */
export class SearchService {
  private generation = 0;
  constructor(
    private readonly files: FileService,
    private readonly limits = searchLimits,
  ) {}

  async search(scopeId: string, input: string): Promise<KnowledgeSearch> {
    const query = searchQuery.parse(input);
    // Escaping makes the query a literal string, including regex punctuation.
    const match = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu');
    // Trigrams need three characters; a shorter query reads every indexed text.
    const narrow = Array.from(query).length >= 3 ? trigramQuery(query) : undefined;
    return this.scan(scopeId, query, textFilePattern, () => (line) => match.exec(line), narrow);
  }

  /** Lines of the other Markdown notes in this KB whose links resolve to `target`. */
  async backlinks(scopeId: string, target: string): Promise<KnowledgeSearch> {
    const foldCase = await foldsCase(this.files, scopeId, target);
    return this.scan(scopeId, target, /\.md$/i, (from) =>
      samePath(from, target, foldCase) ? () => null : linksTo(from, target, foldCase),
    );
  }

  /**
   * Walks the layer to check the index against the files on disk — reading only
   * those added or changed since they were indexed, forgetting those gone — then
   * runs the matcher over the checked text in walk order, as the scan did when
   * it read every file.
   */
  private async scan(
    scopeId: string,
    query: string,
    include: RegExp,
    matcher: (path: string) => (line: string) => RegExpExecArray | null,
    narrow?: string,
  ): Promise<KnowledgeSearch> {
    const space = this.files.get(scopeId);
    const generation = ++this.generation;
    let deadline = performance.now() + this.limits.milliseconds;
    const result: KnowledgeSearch = {
      scopeId,
      query,
      hits: [],
      scannedFiles: 0,
      skippedFiles: 0,
      incomplete: false,
    };
    const current = () => {
      if (generation !== this.generation) throw Error('新しい検索に切り替わりました。');
      if (performance.now() >= deadline) {
        result.incomplete = true;
        return false;
      }
      return true;
    };
    const index = await SearchIndex.open(this.files.dataDir, scopeId);
    try {
      const known = index.files();
      const seen: { id: number; path: string }[] = [];
      const directories = [''];
      let position = 0;
      let visited = 0;
      let bytes = 0;

      scan: for (; position < directories.length; position++) {
        if (!current()) break;
        const directory = directories[position];
        let entries;
        try {
          entries = await this.files.entries(scopeId, directory);
        } catch (error) {
          if (!directory) throw error;
          result.incomplete = true;
          continue;
        }
        const pending: Entry[] = [];
        let more = true;
        for (const entry of entries) {
          if (++visited > this.limits.entries) {
            result.incomplete = true;
            more = false;
            break;
          }
          if (entry.blocked || !searchable(space, entry.path)) continue;
          if (entry.directory) directories.push(entry.path);
          else if (include.test(entry.path)) pending.push(entry);
        }
        // One directory's files are stat'ed together: a checked file costs a stat,
        // not a read, and the stats overlap instead of taking turns.
        const stats = await Promise.all(
          pending.map((entry) => lstat(path.join(space.root, entry.path)).catch(() => undefined)),
        );
        for (const [slot, entry] of pending.entries()) {
          if (!current()) break scan;
          if (result.scannedFiles >= this.limits.files) {
            result.incomplete = true;
            break scan;
          }
          const stat = stats[slot];
          if (!stat) {
            result.skippedFiles++;
            result.incomplete = true;
            continue;
          }
          // A link or special file replaced after listing is not a text search target.
          if (!stat.isFile()) {
            result.incomplete = true;
            continue;
          }
          const row = known.get(entry.path);
          known.delete(entry.path);
          if (row && row.size === stat.size && row.mtime === stat.mtimeMs) {
            if (row.unreadable) {
              result.skippedFiles++;
              result.incomplete = true;
            } else {
              result.scannedFiles++;
              seen.push(row);
            }
            continue;
          }
          let text: string | null = null;
          if (stat.size <= this.limits.fileBytes) {
            if (bytes + stat.size > this.limits.bytes) {
              result.incomplete = true;
              break scan;
            }
            bytes += stat.size;
            text = await this.read(space, scopeId, entry.path, stat).catch(() => null);
          }
          if (!current()) break scan;
          if (row) index.remove(row.id);
          const id = index.put(entry.path, stat.size, stat.mtimeMs, text);
          if (text === null) {
            result.skippedFiles++;
            result.incomplete = true;
          } else {
            result.scannedFiles++;
            seen.push({ id, path: entry.path });
          }
        }
        if (!more) break;
      }
      // Rows the walk did not meet are files gone, renamed or excluded since
      // they were indexed — known only when the walk reached the end.
      if (position === directories.length) {
        let removed = 0;
        for (const row of known.values()) {
          if (!include.test(row.path)) continue;
          index.remove(row.id);
          if (++removed % 64 === 0) {
            await setImmediate();
            if (!current()) break;
          }
        }
      }
      index.flush();

      // Reading had the budget; matching over the checked text gets its own.
      deadline = performance.now() + this.limits.milliseconds;
      const candidates = narrow === undefined ? undefined : index.matching(narrow);
      matching: for (const { id, path: file } of seen) {
        if (candidates && !candidates.has(id)) continue;
        await setImmediate();
        if (!current()) break;
        const text = index.text(id);
        if (text === null) continue;
        const lines = text.split(/\r\n|\n|\r/);
        const match = matcher(file);
        for (let line = 0; line < lines.length; line++) {
          if (!current()) break matching;
          const found = match(lines[line]);
          if (!found) continue;
          const start = Math.max(0, found.index - 60);
          const end = Math.min(lines[line].length, found.index + found[0].length + 120);
          const label = found.groups?.label;
          result.hits.push({
            path: file,
            line: line + 1,
            preview: `${start ? '…' : ''}${lines[line].slice(start, end)}${end < lines[line].length ? '…' : ''}`,
            ...(label !== undefined && { label, column: found.index }),
          });
          if (result.hits.length >= this.limits.hits) {
            result.incomplete = true;
            break matching;
          }
        }
      }
    } catch (error) {
      // A damaged database is a lost cache, not a lost answer: the next request rebuilds it.
      if ((error as { code?: unknown }).code === 'ERR_SQLITE_ERROR') await index.discard();
      throw error;
    } finally {
      index.close();
    }
    return result;
  }

  /**
   * Walks the knowledge layer as the scan does — the same layer rules,
   * exclusions and entry and file limits — entering the directories `descend`
   * accepts, and hands each regular file `include` accepts to `visit` with its
   * stats and a reader under the scan's guards. Says whether a limit or an
   * unreadable directory cut the walk short.
   */
  async walk(
    scopeId: string,
    include: (path: string) => boolean,
    descend: (path: string) => boolean,
    visit: (file: { path: string; stat: Stats; read: () => Promise<string> }) => Promise<void>,
  ): Promise<{ incomplete: boolean }> {
    const space = this.files.get(scopeId);
    const directories = [''];
    let visited = 0;
    let files = 0;
    let incomplete = false;
    for (let position = 0; position < directories.length; position++) {
      const directory = directories[position];
      let entries;
      try {
        entries = await this.files.entries(scopeId, directory);
      } catch (error) {
        if (!directory) throw error;
        incomplete = true;
        continue;
      }
      const pending: Entry[] = [];
      for (const entry of entries) {
        if (++visited > this.limits.entries) return { incomplete: true };
        if (entry.blocked || !searchable(space, entry.path)) continue;
        if (entry.directory) {
          if (descend(entry.path)) directories.push(entry.path);
        } else if (include(entry.path)) pending.push(entry);
      }
      const stats = await Promise.all(
        pending.map((entry) => lstat(path.join(space.root, entry.path)).catch(() => undefined)),
      );
      for (const [slot, entry] of pending.entries()) {
        if (++files > this.limits.files) return { incomplete: true };
        const stat = stats[slot];
        if (!stat?.isFile()) {
          incomplete = true;
          continue;
        }
        await visit({
          path: entry.path,
          stat,
          read: () =>
            stat.size > this.limits.fileBytes
              ? Promise.reject(Error('File exceeds the text limit'))
              : this.read(space, scopeId, entry.path, stat),
        });
      }
    }
    return { incomplete };
  }

  /**
   * One regular file's text, read as the scan always has: at most the observed
   * size plus one byte, rejected when it changes underneath, is not UTF-8 or
   * holds a NUL.
   */
  private async read(space: Space, scopeId: string, relative: string, observed: Stats) {
    const filename = await this.files.resolve(scopeId, relative);
    const actualRelative = path.relative(space.root, filename).split(path.sep).join('/');
    if (!searchable(space, actualRelative)) throw Error('Outside the searched layer');
    const file = await open(filename, 'r');
    try {
      const before = await file.stat();
      if (!before.isFile()) throw Error('Not a regular file');
      // Read at most the observed size plus one byte, even if an external writer grows it.
      const buffer = Buffer.alloc(observed.size + 1);
      let length = 0;
      while (length < buffer.length) {
        const read = await file.read(buffer, length, buffer.length - length, length);
        if (!read.bytesRead) break;
        length += read.bytesRead;
      }
      const after = await file.stat();
      if (
        length !== observed.size ||
        [before, after].some(
          (stat) => stat.size !== observed.size || stat.mtimeMs !== observed.mtimeMs,
        ) ||
        (await this.files.resolve(scopeId, relative)) !== filename
      )
        throw Error('File changed during search');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length));
      if (text.includes('\0')) throw Error('File is binary');
      return text;
    } finally {
      await file.close();
    }
  }
}
