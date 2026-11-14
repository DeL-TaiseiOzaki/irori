import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { parse as parseYaml } from 'yaml';
import {
  bundlePage,
  compareCodePoints,
  formerGraphIndex,
  frontmatterBlock,
  pageFacts,
  type FolderIndexStatus,
  type IndexUpdate,
  type PageChoice,
  type PageFacts,
} from '../domain/bundle';
import { checkOntology, type Ontology } from '../domain/ontology';
import { reachedAsWritten, utf8Text, type FileService } from './files';
import { isMissing, stableHash } from './local-json';
import { textFileByteLimit } from '../domain/viewers';
import type { SearchService } from './search';
import { t } from '../domain/i18n';
import { classify } from '../domain/scopes';
import { inFolder, knowledgeFolder, underFolder } from '../domain/layers';
import { readPropertyDeclaration } from './properties';
import { splitPage, type PropertyDeclaration } from '../domain/properties';
import {
  planFolderIndexes,
  type ExistingIndex,
  type IndexedPage,
  type PlannedIndex,
} from '../domain/folder-index';
import type { Document } from '../domain/types';

/** Refuses a path outside this KB's knowledge layer or reached through an alias, without opening it. */
async function knowledgePath(files: FileService, scopeId: string, relative: string) {
  const space = files.get(scopeId);
  if (classify(space, relative) !== 'Knowledge_Base')
    throw Error('Generated files must belong to this KB knowledge layer');
  const actual = await files.resolve(scopeId, relative);
  if (!reachedAsWritten(space.root, actual, relative))
    throw Error('Generated files must not be aliases');
}

/** A knowledge-layer file read through the guards above, or undefined when there is none. */
async function knowledgeFile(
  files: FileService,
  scopeId: string,
  relative: string,
): Promise<Document | undefined> {
  try {
    await knowledgePath(files, scopeId, relative);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
  return files.read(scopeId, relative);
}

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
  /** The folder indexes met, by path as on disk. */
  indexes: Map<string, { size: number; text?: string }>;
}

/** A knowledge folder that is an OKF bundle: its root index's frontmatter and its property declaration. */
interface Bundle {
  frontmatter: string;
  declaration: PropertyDeclaration;
}

/**
 * Reads the pages of a knowledge base, applies its ontology to them — the
 * types and relations `.property/property.json` declares (ADR 060) — and keeps
 * the folder indexes of an OKF bundle (ADR 028). The walk is search's, so the
 * layer rules, exclusions and limits are the ones a reader already knows.
 * YAML stays on this side of the boundary.
 *
 * Parsing costs a fraction of a millisecond per page, in the main process, so
 * the walk yields every so many pages, and a page's facts are remembered by
 * size and modification time so that a repeated check reads only what changed.
 */
export class BundleService {
  private readonly remembered = new Map<string, Map<string, Remembered>>();
  private readonly reading = new Map<string, Promise<Ontology>>();
  private readonly building = new Map<string, Promise<Walked>>();
  constructor(
    private readonly files: FileService,
    private readonly search: SearchService,
  ) {}

  /**
   * The declaration applied to the pages now, and whether the folder indexes
   * match them. Writes nothing.
   */
  ontology(scopeId: string): Promise<Ontology> {
    const pending = this.reading.get(scopeId);
    if (pending) return pending;
    const next = this.readOntology(scopeId).finally(() => this.reading.delete(scopeId));
    this.reading.set(scopeId, next);
    return next;
  }
  private async readOntology(scopeId: string): Promise<Ontology> {
    const { declaration, problem } = await readPropertyDeclaration(this.files, scopeId).catch(
      (error) => ({
        declaration: null,
        problem: error instanceof Error ? error.message : String(error),
      }),
    );
    const former = await this.formerGraphIndex(scopeId);
    if (!declaration)
      return {
        declared: false,
        ...(problem && { problem }),
        ...(former && { formerGraphIndex: former }),
      };
    const walked = await this.build(scopeId);
    const bundle = await this.bundle(scopeId, declaration);
    return {
      declared: true,
      report: checkOntology(declaration, walked.pages),
      ...(bundle && { indexes: await this.indexStatus(scopeId, walked, bundle) }),
      ...(former && { formerGraphIndex: former }),
    };
  }

  /**
   * The pages a relation can point at, each with its title and type, for the
   * property view's picker (ADR 015 stage 2). Paths are the checkout's own
   * spelling, so a link written from one opens the file that is there.
   */
  async pages(scopeId: string): Promise<PageChoice[]> {
    const walked = await this.build(scopeId);
    return walked.pages
      .map((facts, slot) => ({ path: walked.paths[slot], title: facts.title, type: facts.type }))
      .sort((a, b) => compareCodePoints(a.path, b.path));
  }

  /**
   * Generates the folder indexes of an OKF bundle from its pages and writes the
   * files whose bytes change. Every output is checked before the first is
   * written. A knowledge folder that is not a bundle has no index to write.
   */
  async update(scopeId: string): Promise<IndexUpdate> {
    const { declaration } = await readPropertyDeclaration(this.files, scopeId).catch(() => ({
      declaration: null,
    }));
    const bundle = declaration ? await this.bundle(scopeId, declaration) : undefined;
    if (!bundle) return { bundle: false, pages: 0, written: [] };
    const walked = await this.build(scopeId, true);
    const planned = await this.plan(scopeId, walked, bundle);
    const written: string[] = [];
    for (const index of planned) {
      const existing = await generatedFile(this.files, scopeId, index.path);
      if (existing?.text === index.text) continue;
      await this.files.writeGenerated(scopeId, index.path, index.text, existing?.hash ?? null);
      written.push(index.path);
    }
    return { bundle: true, pages: walked.pages.length, written };
  }

  /**
   * The knowledge folder as an OKF bundle: its root `index.md` opens with
   * frontmatter naming `okf_version`. Folder indexes are offered only then
   * (ADR 028).
   */
  private async bundle(
    scopeId: string,
    declaration: PropertyDeclaration,
  ): Promise<Bundle | undefined> {
    const root = knowledgeFolder(this.files.get(scopeId));
    let index;
    try {
      index = await knowledgeFile(this.files, scopeId, inFolder(root, 'index.md'));
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
    return { frontmatter: page.head.slice(page.bom.length), declaration };
  }

  /** Where the graph index of an irori before 0.2.66 still lies, if it does. */
  private async formerGraphIndex(scopeId: string) {
    const file = formerGraphIndex(knowledgeFolder(this.files.get(scopeId)));
    const folder = parentOf(file);
    const entries = await this.files.entries(scopeId, folder).catch(() => []);
    return entries.some((entry) => entry.path === file) ? `${folder}/` : undefined;
  }

  /** The folder indexes the pages give, with submodules left out. */
  private async plan(scopeId: string, walked: Walked, bundle: Bundle): Promise<PlannedIndex[]> {
    const { root } = walked;
    const folders = new Set<string>();
    const add = (file: string) => {
      for (let folder = parentOf(file); underFolder(root, folder); folder = parentOf(folder)) {
        if (folders.has(folder)) break;
        folders.add(folder);
      }
    };
    for (const file of [...walked.paths, ...walked.indexes.keys()]) add(file);
    // A submodule is another repository's folder: it gets no index, and its pages list nowhere.
    const space = this.files.get(scopeId);
    const gitlinks = new Set<string>();
    // The vault's own root is no submodule, though it holds a `.git`.
    const ordered = [...folders].filter(Boolean);
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
        let folder = parentOf(file);
        folder && underFolder(root, folder);
        folder = parentOf(folder)
      )
        if (gitlinks.has(folder)) return true;
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
      const folder = parentOf(file);
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
    const root = knowledgeFolder(this.files.get(scopeId));
    const folderIndex = (path: string) =>
      (!root || path.startsWith(`${root}/`)) && /(^|\/)index\.md$/i.test(path);
    const walk = await this.search.walk(
      scopeId,
      (path) => bundlePage(path, root) || folderIndex(path),
      // The walk itself leaves Schema and contents out of a bundle at the vault's root.
      (directory) => underFolder(root, directory),
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
            /* the page keeps its place with no facts, and is read again next time */
          }
        }
        next.set(path, entry);
        pages.push(entry.facts ?? { ...pageFacts(path, undefined), unreadable: true });
        paths.push(path);
        if (pages.length % 64 === 0) await setImmediate();
      },
    );
    this.remembered.set(scopeId, next);
    if (walk.incomplete)
      throw Error(
        t(
          'ナレッジ層を最後まで読めなかったため、ページを確認できません。',
          'The Knowledge layer could not be read completely, so its pages cannot be checked.',
        ),
      );
    return { root, pages, paths, indexes };
  }
}

/** The folder a vault path is in, `''` at the vault's root. */
const parentOf = (relative: string) => relative.slice(0, Math.max(0, relative.lastIndexOf('/')));

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
 * A generated file may be unreadable as text after a bad merge. Keep its
 * guarded byte hash so an explicit regeneration can repair it; retain text only
 * within the ordinary reader's limit.
 */
async function generatedFile(files: FileService, scopeId: string, relative: string) {
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
          'CONFLICT: 索引の読み取り中にファイルが変更されました。',
          'CONFLICT: A file changed while the indexes were being read.',
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
