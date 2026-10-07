import { setImmediate } from 'node:timers/promises';
import { parse as parseYaml } from 'yaml';
import {
  buildGraphIndex,
  bundlePage,
  declaredGraphIndex,
  entityColumns,
  frontmatterBlock,
  graphIndexAt,
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
import { utf8Text, type FileService } from './files';
import { isMissing, stableHash } from './local-json';
import { textFileByteLimit } from '../domain/viewers';
import { knowledgePath, readDeclaration } from './ontology';
import type { SearchService } from './search';
import { t } from '../domain/i18n';
import { knowledgeFolder } from '../domain/layers';

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
  private readonly statuses = new Map<string, Promise<GraphIndexStatus>>();
  private readonly building = new Map<string, Promise<Built>>();
  constructor(
    private readonly files: FileService,
    private readonly search: SearchService,
  ) {}

  /** Whether the module matches the pages now, and what an update would change. Writes nothing. */
  status(scopeId: string): Promise<GraphIndexStatus> {
    const pending = this.statuses.get(scopeId);
    if (pending) return pending;
    const next = this.readStatus(scopeId).finally(() => this.statuses.delete(scopeId));
    this.statuses.set(scopeId, next);
    return next;
  }
  private async readStatus(scopeId: string): Promise<GraphIndexStatus> {
    if ((await readDeclaration(this.files, scopeId)) !== null) return declaredGraphIndex;
    return this.compare(scopeId, await this.build(scopeId));
  }

  /** Generates the module and writes the files whose bytes change; refused while a declaration exists. */
  async update(scopeId: string): Promise<GraphIndexUpdate> {
    if ((await readDeclaration(this.files, scopeId)) !== null)
      throw Error(
        t(
          'この KB は .irori/ontology.json で表示設定を宣言しているため、グラフ索引は生成しません。',
          'This KB declares its view in .irori/ontology.json, so no graph index is generated.',
        ),
      );
    const built = await this.build(scopeId, true);
    const graphIndexFiles = this.at(scopeId).files;
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

  /** The module in this hibachi's knowledge folder. */
  private at(scopeId: string) {
    return graphIndexAt(knowledgeFolder(this.files.get(scopeId)));
  }

  private async compare(scopeId: string, built: Built): Promise<GraphIndexStatus> {
    const graphIndexFiles = this.at(scopeId).files;
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

  private build(scopeId: string, fresh = false): Promise<Built> {
    const pending = this.building.get(scopeId);
    if (pending) {
      if (!fresh) return pending;
      // An explicit update must include edits made since the older walk began.
      return pending.catch(() => {}).then(() => this.build(scopeId, true));
    }
    const next = this.readPages(scopeId).finally(() => this.building.delete(scopeId));
    this.building.set(scopeId, next);
    return next;
  }
  private async readPages(scopeId: string): Promise<Built> {
    const previous = this.remembered.get(scopeId) ?? new Map<string, Remembered>();
    const next = new Map<string, Remembered>();
    const pages: PageFacts[] = [];
    let unreadable = 0;
    const root = knowledgeFolder(this.files.get(scopeId));
    const { folder, files: graphIndexFiles } = graphIndexAt(root);
    const walk = await this.search.walk(
      scopeId,
      (path) => bundlePage(path, root),
      (directory) =>
        (directory === root || directory.startsWith(`${root}/`)) && directory !== folder,
      async ({ path, stat, read }) => {
        const known = previous.get(path);
        let entry: Remembered;
        if (known?.facts && known.size === stat.size && known.mtime === stat.mtimeMs) entry = known;
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
      throw Error(
        t(
          'ナレッジ層を最後まで読めなかったため、グラフ索引を確認できません。',
          'The Knowledge layer could not be read completely, so the graph index cannot be checked.',
        ),
      );
    const tables = buildGraphIndex(pages, root);
    if (
      tables.entities.length > graphIndexLimits.entities ||
      tables.relations.length > graphIndexLimits.relations
    )
      throw Error(
        t(
          `グラフ索引は ${graphIndexLimits.entities.toLocaleString('en-US')} エンティティ・${graphIndexLimits.relations.toLocaleString('en-US')} 関係までです（今は ${tables.entities.length.toLocaleString('en-US')} エンティティ・${tables.relations.length.toLocaleString('en-US')} 関係）。書き込まずに終了しました。`,
          `The graph index holds up to ${graphIndexLimits.entities.toLocaleString('en-US')} entities and ${graphIndexLimits.relations.toLocaleString('en-US')} relations (now ${tables.entities.length.toLocaleString('en-US')} entities and ${tables.relations.length.toLocaleString('en-US')} relations). Stopped without writing.`,
        ),
      );
    const texts = renderGraphIndex(tables, root);
    // Validate every output before publishing the first: long paths repeated in
    // edge rows can exceed the byte limit even when both row counts fit.
    for (const [key, text] of Object.entries(texts)) {
      if (Buffer.byteLength(text, 'utf8') > textFileByteLimit)
        throw Error(
          t(
            `${graphIndexFiles[key as keyof typeof texts]} が 2 MiB を超えるため、グラフ索引は書き込まれませんでした。`,
            `${graphIndexFiles[key as keyof typeof texts]} exceeds 2 MiB, so the graph index was not written.`,
          ),
        );
      if (text.includes('\0'))
        throw Error(
          t(
            '生成するグラフ索引に NUL があるため、書き込まれませんでした。',
            'The generated graph index contains NUL, so it was not written.',
          ),
        );
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
    if (isMissing(error)) return undefined;
    throw error;
  }
  const filename = await files.resolve(scopeId, relative);
  const chunks: Buffer[] = [];
  const { hash, size } = await stableHash(
    filename,
    () =>
      Error(
        t(
          'CONFLICT: グラフ索引の読み取り中にファイルが変更されました。',
          'CONFLICT: A file changed while the graph index was being read.',
        ),
      ),
    (chunk, size) => {
      if (size <= textFileByteLimit) chunks.push(chunk);
      else chunks.length = 0;
    },
  );
  await knowledgePath(files, scopeId, relative);
  // Regeneration can replace invalid UTF-8 too.
  return { hash, text: size <= textFileByteLimit ? utf8Text(Buffer.concat(chunks)) : undefined };
}

/** The parsed leading frontmatter, `{}` when the page has none; throws when it cannot be read. */
function frontmatter(text: string): unknown {
  const block = frontmatterBlock(text);
  if (block === undefined) return {};
  return parseYaml(block, { schema: 'failsafe', logLevel: 'error', stringKeys: true });
}
