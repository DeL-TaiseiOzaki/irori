import { setImmediate } from 'node:timers/promises';
import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parse as parseYaml } from 'yaml';
import {
  buildGraphIndex,
  bundlePage,
  bundleRoot,
  declaredGraphIndex,
  entityColumns,
  frontmatterBlock,
  graphIndexFiles,
  graphIndexFolder,
  graphIndexLimits,
  pageFacts,
  relationColumns,
  renderGraphIndex,
  tableDelta,
  type GraphIndexStatus,
  type GraphIndexTables,
  type GraphIndexUpdate,
  type PageFacts,
} from '../domain/graph-index';
import { textFileByteLimit, type FileService } from './files';
import { knowledgePath, readDeclaration } from './ontology';
import type { SearchService } from './search';

/** A page's facts at the size and modification time they were read. */
interface Remembered {
  size: number;
  mtime: number;
  facts?: PageFacts;
}

interface Built {
  tables: GraphIndexTables;
  texts: ReturnType<typeof renderGraphIndex>;
  pages: number;
  unreadable: number;
}

/**
 * Generates the graph index the knowledge base carries from its pages, says
 * whether the module on disk still matches them, and writes it when asked.
 * The walk is search's, so the layer rules, exclusions and limits are the
 * ones a reader already knows. YAML stays on this side of the boundary.
 *
 * Parsing costs a fraction of a millisecond per page, in the main process, so
 * the walk yields every so many pages, and a page's facts are remembered by
 * size and modification time so that a repeated check reads only what changed.
 */
export class GraphIndexService {
  private readonly remembered = new Map<string, Map<string, Remembered>>();
  constructor(
    private readonly files: FileService,
    private readonly search: SearchService,
  ) {}

  /** Whether the module matches the pages now, and what an update would change. Writes nothing. */
  async status(scopeId: string): Promise<GraphIndexStatus> {
    if ((await readDeclaration(this.files, scopeId)) !== null) return declaredGraphIndex;
    return this.compare(scopeId, await this.build(scopeId));
  }

  /** Generates the module and writes the files whose bytes change; refused while a declaration exists. */
  async update(scopeId: string): Promise<GraphIndexUpdate> {
    if ((await readDeclaration(this.files, scopeId)) !== null)
      throw Error(
        'この KB は .irori/ontology.json で表示設定を宣言しているため、グラフ索引は生成しません。',
      );
    const built = await this.build(scopeId);
    const written: string[] = [];
    const keys = ['entities', 'relations', 'index'] as const;
    const previous = await Promise.all(
      keys.map((key) => moduleFile(this.files, scopeId, graphIndexFiles[key])),
    );
    for (const [index, key] of keys.entries()) {
      const relative = graphIndexFiles[key];
      const existing = previous[index];
      if (existing?.text === built.texts[key]) continue;
      await this.files.writeGenerated(scopeId, relative, built.texts[key], existing?.hash ?? null);
      written.push(relative);
    }
    return { ...(await this.compare(scopeId, built)), written };
  }

  private async compare(scopeId: string, built: Built): Promise<GraphIndexStatus> {
    const [entities, relations] = await Promise.all(
      [graphIndexFiles.entities, graphIndexFiles.relations].map((relative) =>
        moduleFile(this.files, scopeId, relative),
      ),
    );
    return {
      declared: false,
      present: entities !== undefined,
      current: entities?.text === built.texts.entities && relations?.text === built.texts.relations,
      pages: built.pages,
      unreadable: built.unreadable,
      excluded: built.tables.excluded,
      entities: tableDelta(entityColumns, built.tables.entities, entities?.text),
      relations: tableDelta(relationColumns, built.tables.relations, relations?.text),
    };
  }

  private async build(scopeId: string): Promise<Built> {
    const previous = this.remembered.get(scopeId) ?? new Map<string, Remembered>();
    const next = new Map<string, Remembered>();
    const pages: PageFacts[] = [];
    let unreadable = 0;
    const walk = await this.search.walk(
      scopeId,
      bundlePage,
      (directory) =>
        (directory === bundleRoot || directory.startsWith(`${bundleRoot}/`)) &&
        directory !== graphIndexFolder,
      async ({ path, stat, read }) => {
        const known = previous.get(path);
        let entry: Remembered;
        if (known && known.size === stat.size && known.mtime === stat.mtimeMs) entry = known;
        else {
          entry = { size: stat.size, mtime: stat.mtimeMs };
          try {
            entry.facts = pageFacts(path, frontmatter(await read()));
          } catch {
            /* the page keeps its place with no facts */
          }
        }
        next.set(path, entry);
        pages.push(entry.facts ?? pageFacts(path, undefined));
        if (!entry.facts) unreadable++;
        if (pages.length % 64 === 0) await setImmediate();
      },
    );
    this.remembered.set(scopeId, next);
    if (walk.incomplete)
      throw Error('ナレッジ層を最後まで読めなかったため、グラフ索引を確認できません。');
    const tables = buildGraphIndex(pages);
    if (
      tables.entities.length > graphIndexLimits.entities ||
      tables.relations.length > graphIndexLimits.relations
    )
      throw Error(
        `グラフ索引は ${graphIndexLimits.entities.toLocaleString('en-US')} エンティティ・${graphIndexLimits.relations.toLocaleString('en-US')} 関係までです（今は ${tables.entities.length.toLocaleString('en-US')} エンティティ・${tables.relations.length.toLocaleString('en-US')} 関係）。書き込まずに終了しました。`,
      );
    const texts = renderGraphIndex(tables);
    // Validate every output before publishing the first: long paths repeated in
    // edge rows can exceed the byte limit even when both row counts fit.
    for (const [key, text] of Object.entries(texts)) {
      if (Buffer.byteLength(text, 'utf8') > textFileByteLimit)
        throw Error(
          `${graphIndexFiles[key as keyof typeof texts]} が 2 MiB を超えるため、グラフ索引は書き込まれませんでした。`,
        );
      if (text.includes('\0'))
        throw Error('生成するグラフ索引に NUL があるため、書き込まれませんでした。');
    }
    return { tables, texts, pages: pages.length, unreadable };
  }
}

/**
 * A generated file may be unreadable as text after a bad merge or an older
 * generator. Keep its guarded byte hash so an explicit regeneration can repair
 * it; retain text only within the ordinary reader's limit.
 */
async function moduleFile(files: FileService, scopeId: string, relative: string) {
  try {
    await knowledgePath(files, scopeId, relative);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  const filename = await files.resolve(scopeId, relative);
  const file = await open(filename, 'r');
  try {
    const before = await file.stat();
    if (!before.isFile()) throw Error('生成先が通常のファイルではありません。');
    const digest = createHash('sha256');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of file.createReadStream({ autoClose: false, end: before.size })) {
      digest.update(chunk);
      size += chunk.length;
      if (size <= textFileByteLimit) chunks.push(chunk);
      else chunks.length = 0;
    }
    const after = await file.stat();
    if (size !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs)
      throw Error('CONFLICT: グラフ索引の読み取り中にファイルが変更されました。');
    await knowledgePath(files, scopeId, relative);
    let text: string | undefined;
    if (size <= textFileByteLimit)
      try {
        text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
          Buffer.concat(chunks),
        );
        if (text.includes('\0')) text = undefined;
      } catch {
        /* Regeneration can replace invalid UTF-8 too. */
      }
    return { hash: digest.digest('hex'), text };
  } finally {
    await file.close();
  }
}

/** The parsed leading frontmatter, `{}` when the page has none; throws when it cannot be read. */
function frontmatter(text: string): unknown {
  const block = frontmatterBlock(text);
  if (block === undefined) return {};
  return parseYaml(block, { schema: 'failsafe', logLevel: 'error', stringKeys: true });
}
