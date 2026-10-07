import { lstat } from 'node:fs/promises';
import path from 'node:path';
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
  type FolderIndexStatus,
  type GraphIndexStatus,
  type GraphIndexTables,
  type GraphIndexUpdate,
  type PageFacts,
} from '../domain/graph-index';
import { utf8Text, type FileService } from './files';
import { isMissing, stableHash } from './local-json';
import { textFileByteLimit } from '../domain/viewers';
import { knowledgeFile, knowledgePath, readDeclaration } from './ontology';
import type { SearchService } from './search';
import { t } from '../domain/i18n';
import { knowledgeFolder } from '../domain/layers';
import { readPropertyDeclaration } from './properties';
import { splitPage, type PropertyDeclaration } from '../domain/properties';
import {
  planFolderIndexes,
  type ExistingIndex,
  type IndexedPage,
  type PlannedIndex,
} from '../domain/folder-index';

/** A page's facts at the size and modification time they were read. */
interface Remembered {
  size: number;
  mtime: number;
  facts?: PageFacts;
  /** A folder's `index.md` keeps its text instead (ADR 028). */
  text?: string;
}

/** What one walk of the knowledge folder read. */
interface Walked {
  root: string;
  pages: PageFacts[];
  /** Each page's path as on disk, in the order of `pages`. */
  paths: string[];
  unreadable: number;
  /** The folder indexes met, by path as on disk. */
  indexes: Map<string, { size: number; text?: string }>;
}

interface Built {
  tables: GraphIndexTables;
  texts: ReturnType<typeof renderGraphIndex>;
  pages: number;
  unreadable: number;
}

/** A knowledge folder that is an OKF bundle: its root index's frontmatter and its property declaration. */
interface Bundle {
  frontmatter: string;
  declaration: PropertyDeclaration;
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
  private readonly building = new Map<string, Promise<Walked>>();
  constructor(
    private readonly files: FileService,
    private readonly search: SearchService,
  ) {}

  /** Whether the module and folder indexes match the pages now, and what an update would change. Writes nothing. */
  status(scopeId: string): Promise<GraphIndexStatus> {
    const pending = this.statuses.get(scopeId);
    if (pending) return pending;
    const next = this.readStatus(scopeId).finally(() => this.statuses.delete(scopeId));
    this.statuses.set(scopeId, next);
    return next;
  }
  private async readStatus(scopeId: string): Promise<GraphIndexStatus> {
    const declared = (await readDeclaration(this.files, scopeId)) !== null;
    const bundle = await this.bundle(scopeId);
    if (declared && !bundle) return declaredGraphIndex;
    const walked = await this.build(scopeId);
    const graph = declared ? declaredGraphIndex : await this.compare(scopeId, this.graph(walked));
    if (!bundle) return graph;
    return { ...graph, indexes: await this.indexStatus(scopeId, walked, bundle) };
  }

  /**
   * Generates the module, unless a declaration exists, and the folder indexes of
   * an OKF bundle, and writes the files whose bytes change. Every output is
   * checked before the first is written.
   */
  async update(scopeId: string): Promise<GraphIndexUpdate> {
    const declared = (await readDeclaration(this.files, scopeId)) !== null;
    const bundle = await this.bundle(scopeId);
    if (declared && !bundle)
      throw Error(
        t(
          'この KB は .irori/ontology.json で表示設定を宣言しているため、グラフ索引は生成しません。',
          'This KB declares its view in .irori/ontology.json, so no graph index is generated.',
        ),
      );
    const walked = await this.build(scopeId, true);
    const built = declared ? undefined : this.graph(walked);
    const planned = bundle ? await this.plan(scopeId, walked, bundle) : [];
    const written: string[] = [];
    if (built) {
      const graphIndexFiles = this.at(scopeId).files;
      const keys = ['entities', 'relations', 'index'] as const;
      const previous = await Promise.all(
        keys.map((key) => moduleFile(this.files, scopeId, graphIndexFiles[key])),
      );
      for (const [index, key] of keys.entries()) {
        const relative = graphIndexFiles[key];
        const existing = previous[index];
        if (existing?.text === built.texts[key]) continue;
        await this.files.writeGenerated(
          scopeId,
          relative,
          built.texts[key],
          existing?.hash ?? null,
        );
        written.push(relative);
      }
    }
    for (const index of planned) {
      const existing = await moduleFile(this.files, scopeId, index.path);
      if (existing?.text === index.text) continue;
      await this.files.writeGenerated(scopeId, index.path, index.text, existing?.hash ?? null);
      written.push(index.path);
    }
    const graph = built ? await this.compare(scopeId, built) : declaredGraphIndex;
    return {
      ...graph,
      ...(bundle && { indexes: { folders: planned.length, added: 0, changed: 0 } }),
      written,
    };
  }

  /**
   * The knowledge folder as an OKF bundle: its root `index.md` opens with
   * frontmatter naming `okf_version`, and `.property/property.json` reads. Folder
   * indexes are offered only then (ADR 028).
   */
  private async bundle(scopeId: string): Promise<Bundle | undefined> {
    const root = knowledgeFolder(this.files.get(scopeId));
    let index;
    try {
      index = await knowledgeFile(this.files, scopeId, `${root}/index.md`);
    } catch {
      return undefined;
    }
    if (!index) return undefined;
    const page = splitPage(index.text);
    if (page.yaml === undefined) return undefined;
    let fields: unknown;
    try {
      fields = parseYaml(page.yaml, { schema: 'failsafe', logLevel: 'error', stringKeys: true });
    } catch {
      return undefined;
    }
    if (
      typeof fields !== 'object' ||
      fields === null ||
      !Object.prototype.hasOwnProperty.call(fields, 'okf_version')
    )
      return undefined;
    const { declaration } = await readPropertyDeclaration(this.files, scopeId).catch(() => ({
      declaration: null,
    }));
    if (!declaration) return undefined;
    return { frontmatter: page.head.slice(page.bom.length), declaration };
  }

  /** The folder indexes the pages give, with submodules left out. */
  private async plan(scopeId: string, walked: Walked, bundle: Bundle): Promise<PlannedIndex[]> {
    const { root } = walked;
    const folders = new Set<string>();
    const add = (file: string) => {
      for (
        let folder = path.posix.dirname(file);
        folder === root || folder.startsWith(`${root}/`);
      ) {
        if (folders.has(folder)) break;
        folders.add(folder);
        folder = path.posix.dirname(folder);
      }
    };
    for (const file of [...walked.paths, ...walked.indexes.keys()]) add(file);
    // A submodule is another repository's folder: it gets no index, and its pages list nowhere.
    const space = this.files.get(scopeId);
    const gitlinks = new Set<string>();
    const ordered = [...folders];
    for (let at = 0; at < ordered.length; at += 64) {
      const batch = ordered.slice(at, at + 64);
      const found = await Promise.all(
        batch.map((folder) =>
          lstat(path.join(space.root, folder, '.git')).then(
            () => true,
            () => false,
          ),
        ),
      );
      batch.forEach((folder, slot) => found[slot] && gitlinks.add(folder));
      await setImmediate();
    }
    const excluded = (file: string) => {
      for (
        let folder = path.posix.dirname(file);
        folder === root || folder.startsWith(`${root}/`);
      ) {
        if (gitlinks.has(folder)) return true;
        folder = path.posix.dirname(folder);
      }
      return false;
    };
    const pages: IndexedPage[] = [];
    walked.paths.forEach((file, slot) => {
      if (excluded(file)) return;
      const facts = walked.pages[slot];
      pages.push({
        path: file,
        type: facts.type,
        title: facts.title,
        description: facts.description,
      });
    });
    const indexes = new Map<string, ExistingIndex>();
    for (const [file, { text }] of walked.indexes) {
      if (excluded(file)) continue;
      const folder = path.posix.dirname(file);
      // `index.md` itself wins over another spelling in the same folder.
      if (indexes.has(folder) && !/\/index\.md$/.test(file)) continue;
      indexes.set(folder, { path: file, text });
    }
    const planned = planFolderIndexes({
      root,
      pages,
      indexes,
      declaration: bundle.declaration,
      frontmatter: bundle.frontmatter,
    });
    for (const index of planned) checkOutput(index.path, index.text);
    return planned;
  }

  private async indexStatus(
    scopeId: string,
    walked: Walked,
    bundle: Bundle,
  ): Promise<FolderIndexStatus> {
    const planned = await this.plan(scopeId, walked, bundle);
    let added = 0;
    let changed = 0;
    for (const index of planned) {
      const existing = walked.indexes.get(index.path);
      if (!existing) added++;
      // The walk reads text without a BOM; the size tells a file that has one.
      else if (
        existing.text !== index.text ||
        existing.size !== Buffer.byteLength(index.text, 'utf8')
      )
        changed++;
    }
    return { folders: planned.length, added, changed };
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

  private build(scopeId: string, fresh = false): Promise<Walked> {
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
  private async readPages(scopeId: string): Promise<Walked> {
    const previous = this.remembered.get(scopeId) ?? new Map<string, Remembered>();
    const next = new Map<string, Remembered>();
    const pages: PageFacts[] = [];
    const paths: string[] = [];
    const indexes = new Map<string, { size: number; text?: string }>();
    let unreadable = 0;
    const root = knowledgeFolder(this.files.get(scopeId));
    const { folder } = graphIndexAt(root);
    const folderIndex = (path: string) =>
      path.startsWith(`${root}/`) &&
      /(^|\/)index\.md$/i.test(path) &&
      !path.startsWith(`${folder}/`);
    const walk = await this.search.walk(
      scopeId,
      (path) => bundlePage(path, root) || folderIndex(path),
      (directory) =>
        (directory === root || directory.startsWith(`${root}/`)) && directory !== folder,
      async ({ path, stat, read }) => {
        const known = previous.get(path);
        const same = known && known.size === stat.size && known.mtime === stat.mtimeMs;
        if (folderIndex(path)) {
          let entry: Remembered;
          if (same && known.text !== undefined) entry = known;
          else {
            entry = { size: stat.size, mtime: stat.mtimeMs };
            entry.text = await read().catch(() => undefined);
          }
          next.set(path, entry);
          indexes.set(path, { size: stat.size, text: entry.text });
          return;
        }
        let entry: Remembered;
        if (same && known.facts) entry = known;
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
        paths.push(path);
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
    return { root, pages, paths, unreadable, indexes };
  }

  /** The module the walked pages give; refused when the reader could not load it. */
  private graph({ root, pages, unreadable }: Walked): Built {
    const graphIndexFiles = graphIndexAt(root).files;
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
    for (const [key, text] of Object.entries(texts))
      checkOutput(graphIndexFiles[key as keyof typeof texts], text);
    return { tables, texts, pages: pages.length, unreadable };
  }
}

/** Refuses generated bytes the editor could not hold: over 2 MiB, or with NUL. */
function checkOutput(relative: string, text: string) {
  if (Buffer.byteLength(text, 'utf8') > textFileByteLimit)
    throw Error(
      t(
        `${relative} が 2 MiB を超えるため、索引は書き込まれませんでした。`,
        `${relative} exceeds 2 MiB, so the indexes were not written.`,
      ),
    );
  if (text.includes('\0'))
    throw Error(
      t(
        '生成する索引に NUL があるため、書き込まれませんでした。',
        'The generated index contains NUL, so it was not written.',
      ),
    );
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
