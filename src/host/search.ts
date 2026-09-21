import { lstat, open } from 'node:fs/promises';
import path from 'node:path';
import { linksTo, samePath } from '../domain/note-links';
import { classify } from '../domain/scopes';
import { searchQuery, type KnowledgeSearch } from '../domain/search';
import type { Space } from '../domain/types';
import { FileService, textFilePattern } from './files';
import { foldsCase } from './links';

export const searchLimits = {
  files: 2000,
  entries: 10000,
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
    return this.scan(scopeId, query, textFilePattern, () => (line) => match.exec(line));
  }

  /** Lines of the other Markdown notes in this KB whose links resolve to `target`. */
  async backlinks(scopeId: string, target: string): Promise<KnowledgeSearch> {
    const foldCase = await foldsCase(this.files, scopeId, target);
    return this.scan(scopeId, target, /\.md$/i, (from) =>
      samePath(from, target, foldCase) ? () => null : linksTo(from, target, foldCase),
    );
  }

  private async scan(
    scopeId: string,
    query: string,
    include: RegExp,
    matcher: (path: string) => (line: string) => RegExpExecArray | null,
  ): Promise<KnowledgeSearch> {
    const space = this.files.get(scopeId);
    const generation = ++this.generation;
    const deadline = performance.now() + this.limits.milliseconds;
    const result: KnowledgeSearch = {
      scopeId,
      query,
      hits: [],
      scannedFiles: 0,
      skippedFiles: 0,
      incomplete: false,
    };
    const directories = [''];
    let visited = 0;
    let bytes = 0;
    const current = () => {
      if (generation !== this.generation) throw Error('新しい検索に切り替わりました。');
      if (performance.now() >= deadline) {
        result.incomplete = true;
        return false;
      }
      return true;
    };

    scan: for (let index = 0; index < directories.length; index++) {
      if (!current()) break;
      const directory = directories[index];
      let entries;
      try {
        entries = await this.files.entries(scopeId, directory);
      } catch (error) {
        if (!directory) throw error;
        result.incomplete = true;
        continue;
      }
      for (const entry of entries) {
        if (!current()) break scan;
        if (++visited > this.limits.entries) {
          result.incomplete = true;
          break scan;
        }
        if (entry.blocked || !searchable(space, entry.path)) continue;
        if (entry.directory) {
          directories.push(entry.path);
          continue;
        }
        if (!include.test(entry.path)) continue;
        if (result.scannedFiles >= this.limits.files) {
          result.incomplete = true;
          break scan;
        }

        let text: string;
        try {
          const filename = await this.files.resolve(scopeId, entry.path);
          const actualRelative = path.relative(space.root, filename).split(path.sep).join('/');
          if (!searchable(space, actualRelative)) continue;
          // A link or special file replaced after listing is not a text search target.
          if (!(await lstat(path.join(space.root, entry.path))).isFile()) {
            result.incomplete = true;
            continue;
          }
          const file = await open(filename, 'r');
          try {
            const before = await file.stat();
            if (!before.isFile() || before.size > this.limits.fileBytes)
              throw Error('File is outside the text search limit');
            if (bytes + before.size > this.limits.bytes) {
              result.incomplete = true;
              break scan;
            }
            // Read at most the observed size plus one byte, even if an external writer grows it.
            const buffer = Buffer.alloc(before.size + 1);
            let length = 0;
            while (length < buffer.length) {
              const read = await file.read(buffer, length, buffer.length - length, length);
              if (!read.bytesRead) break;
              length += read.bytesRead;
            }
            bytes += length;
            const after = await file.stat();
            if (
              length !== before.size ||
              after.size !== before.size ||
              after.mtimeMs !== before.mtimeMs ||
              (await this.files.resolve(scopeId, entry.path)) !== filename
            )
              throw Error('File changed during search');
            text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length));
            if (text.includes('\0')) throw Error('File is binary');
          } finally {
            await file.close();
          }
        } catch {
          result.skippedFiles++;
          result.incomplete = true;
          continue;
        }
        if (!current()) break scan;
        result.scannedFiles++;
        const lines = text.split(/\r\n|\n|\r/);
        const match = matcher(entry.path);
        for (let line = 0; line < lines.length; line++) {
          if (!current()) break scan;
          const found = match(lines[line]);
          if (!found) continue;
          const start = Math.max(0, found.index - 60);
          const end = Math.min(lines[line].length, found.index + found[0].length + 120);
          const label = found.groups?.label;
          result.hits.push({
            path: entry.path,
            line: line + 1,
            preview: `${start ? '…' : ''}${lines[line].slice(start, end)}${end < lines[line].length ? '…' : ''}`,
            ...(label !== undefined && { label, column: found.index }),
          });
          if (result.hits.length >= this.limits.hits) {
            result.incomplete = true;
            break scan;
          }
        }
      }
    }
    return result;
  }
}
