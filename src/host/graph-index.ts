import { setImmediate } from 'node:timers/promises';
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
import type { FileService } from './files';
import { knowledgeFile, readDeclaration } from './ontology';
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
    for (const key of ['entities', 'relations', 'index'] as const) {
      const relative = graphIndexFiles[key];
      const existing = await knowledgeFile(this.files, scopeId, relative);
      if (existing?.text === built.texts[key]) continue;
      await this.files.writeGenerated(scopeId, relative, built.texts[key], existing?.hash ?? null);
      written.push(relative);
    }
    return { ...(await this.compare(scopeId, built)), written };
  }

  private async compare(scopeId: string, built: Built): Promise<GraphIndexStatus> {
    const [entities, relations] = await Promise.all(
      [graphIndexFiles.entities, graphIndexFiles.relations].map((relative) =>
        knowledgeFile(this.files, scopeId, relative),
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
    return { tables, texts: renderGraphIndex(tables), pages: pages.length, unreadable };
  }
}

/** The parsed leading frontmatter, `{}` when the page has none; throws when it cannot be read. */
function frontmatter(text: string): unknown {
  const block = frontmatterBlock(text);
  if (block === undefined) return {};
  return parseYaml(block, { schema: 'failsafe', logLevel: 'error', stringKeys: true });
}
