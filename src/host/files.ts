import { promises as fs } from 'node:fs';
import path from 'node:path';
import { rewriteNoteReferences } from './note-references';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { SerialQueue } from './serial-queue';
import writeFileAtomic from 'write-file-atomic';
import type { FSWatcher } from 'chokidar';
import {
  isMissing,
  ordinaryFolders,
  replaceChecked,
  stableHash,
  writeExclusive,
  writeLocalFile,
  writeLocalJson,
} from './local-json';
import { classify, owner, within } from '../domain/scopes';
import type { Category, Document, Entry, NewEntry, Space, SpaceChange } from '../domain/types';
import { entryNameError } from '../domain/connections';
import { freeName, renameEntry, writeNewEntry } from './entries';
import { carriedImage } from '../domain/vault-move';
import { internalLinks } from '../domain/note-links';
import { brainLook, categoryText, iconImagePath } from '../domain/brains';
import {
  imagesForNoteMove,
  noteFilename,
  noteRef,
  trashedNote,
  type NoteRef,
  type TrashedNote,
} from '../domain/note-operations';
import { defaultNoteDirectory } from '../domain/notes';
import {
  defaultKnowledgeFolder,
  knowledgeFolder,
  knowledgeFolderName,
  layerFolderProblem,
  layerLabels,
  layerRoots,
  movedPath,
  rootKnowledgeFolder,
  type LayerMove,
  type NamedLayer,
} from '../domain/layers';
import { frontmatterBlock } from '../domain/graph-index';
import { t } from '../domain/i18n';
import { textFileByteLimit, textFilePattern, viewerByteLimit, viewerKind } from '../domain/viewers';
const relative = z
  .string()
  .min(1)
  .refine(
    (p) =>
      !path.isAbsolute(p) &&
      !p.includes('\\') &&
      p.split('/').every((x) => x && x !== '..' && x !== '.'),
  );
const declaration = z.object({
  schemaVersion: z.literal(1),
  scopeId: z.uuid(),
  name: z.string().min(1).max(120),
  category: categoryText.optional(),
  contents: z.array(relative).min(1),
  knowledge: knowledgeFolderName.optional(),
  labels: layerLabels.optional(),
  appearance: brainLook.optional(),
});
export const hash = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
/** Where the unsaved text of one document is kept on this device. */
export const draftFile = (dataDir: string, scopeId: string, rel: string) =>
  path.join(dataDir, `draft-${hash(scopeId + '\0' + rel)}.json`);
export { textFilePattern };
/** Strict UTF-8 without NUL as text, else undefined; `keepBOM` false drops a leading BOM. */
export function utf8Text(bytes: Uint8Array, keepBOM = true) {
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: keepBOM }).decode(bytes);
    return text.includes('\0') ? undefined : text;
  } catch {
    return undefined;
  }
}
/** Whether a resolved file is `relative` under `root` as written, with no alias on the way. */
export const reachedAsWritten = (root: string, actual: string, relative: string) =>
  path.relative(root, actual).split(path.sep).join('/') === relative;
/** Refuses text the editor would not write: over its limit, or holding NUL. */
export function editableText(text: string) {
  if (Buffer.byteLength(text, 'utf8') > textFileByteLimit)
    throw Error('The text editor supports files up to 2 MiB');
  if (text.includes('\0')) throw Error('Binary files cannot be edited as text');
}
export async function readTextDocument(
  filename: string,
  scopeId: string,
  rel: string,
): Promise<Document> {
  if (!textFilePattern.test(rel)) throw Error('Use the external application for this file format');
  if ((await fs.stat(filename)).size > textFileByteLimit)
    throw Error('The text editor supports files up to 2 MiB');
  const bytes = await fs.readFile(filename);
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  if (text.includes('\0')) throw Error('Binary files cannot be edited as text');
  return { scopeId, path: rel, text, hash: hash(bytes) };
}
const tooLarge = () =>
  Error(
    t(
      '100 MiB を超えるファイルは外部アプリで開いてください。',
      'Open files larger than 100 MiB in an external app.',
    ),
  );
/**
 * A file the renderer opens: text for the editor, or, for a format irori shows with a
 * viewer, an empty text whose version is the file's size and modification time. The
 * viewer reads the bytes itself; reading them here as well would only be discarded.
 */
export async function readDocument(filename: string, scopeId: string, rel: string) {
  const viewer = viewerKind(rel);
  if (!viewer) return readTextDocument(filename, scopeId, rel);
  const stat = await fs.stat(filename);
  if (!stat.isFile()) throw Error(t('ファイルではありません。', 'This is not a file.'));
  if (stat.size > viewerByteLimit) throw tooLarge();
  const version = hash(`${stat.size}:${stat.mtimeMs}`);
  return { scopeId, path: rel, text: '', hash: version, viewer } satisfies Document;
}
/** The bytes of a file irori shows with a viewer, under the same limit as its document. */
export async function readViewerBytes(filename: string, rel: string) {
  if (!viewerKind(rel)) throw Error('Use the external application for this file format');
  if ((await fs.stat(filename)).size > viewerByteLimit) throw tooLarge();
  return new Uint8Array(await fs.readFile(filename));
}
const unwatchedNames = new Set([
  '.git',
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.tox',
  '.next',
  '.turbo',
  '.cache',
  '.DS_Store',
]);

/** Files that only keep a folder or its look, which go with a knowledge folder emptied into the root. */
const placeholders = ['.DS_Store', '.gitkeep'];

/** One registration's watcher boundaries, computed outside chokidar's path callback. */
export function watcherIgnored(space: Space, spaces: Space[]) {
  const excluded = [
    ...space.contents,
    ...spaces
      .filter((other) => other.scopeId !== space.scopeId && within(space.root, other.root))
      .map((other) => path.relative(space.root, other.root).replaceAll('\\', '/')),
  ];
  const knowledge = knowledgeFolder(space);
  return (filename: string) => {
    const relative = path.relative(space.root, filename).replaceAll('\\', '/');
    return (
      relative
        .split('/')
        .some((part, index) => unwatchedNames.has(part) && !(index === 0 && part === knowledge)) ||
      excluded.some((folder) => relative === folder || relative.startsWith(folder + '/'))
    );
  };
}

/** Reconcile only watchers whose registration boundaries changed. */
export function watchRegistrationChanges(
  files: FileService,
  handlers: {
    watchers: Map<string, FSWatcher>;
    watch(space: Space, spaces: Space[]): FSWatcher;
    refreshed(scopeId: string): void;
    closing(): boolean;
    error(error: unknown): void;
  },
) {
  let previous = files.list();
  let refreshing = Promise.resolve();
  let stopped = false;
  const boundary = (space: Space) =>
    JSON.stringify([space.root, [...space.contents].sort(), knowledgeFolder(space)]);
  const unsubscribe = files.onRegistrationsChanged(() => {
    const spaces = files.list();
    const before = new Map(previous.map((space) => [space.scopeId, boundary(space)]));
    const after = new Map(spaces.map((space) => [space.scopeId, boundary(space)]));
    const changed = [...previous, ...spaces].filter(
      (space) => before.get(space.scopeId) !== after.get(space.scopeId),
    );
    const affected = new Set(
      [...previous, ...spaces]
        .filter((space) =>
          changed.some((other) => within(space.root, other.root) || within(other.root, space.root)),
        )
        .map((space) => space.scopeId),
    );
    previous = spaces;
    if (!affected.size) return;
    refreshing = refreshing
      .then(async () => {
        if (stopped || handlers.closing()) return;
        const removed: FSWatcher[] = [];
        for (const id of affected) {
          const watcher = handlers.watchers.get(id);
          if (!watcher) continue;
          handlers.watchers.delete(id);
          removed.push(watcher);
        }
        await Promise.all(removed.map((watcher) => watcher.close()));
        if (stopped || handlers.closing()) return;
        const current = files.list();
        for (const space of current) {
          if (!affected.has(space.scopeId)) continue;
          const watcher = handlers.watch(space, current);
          // ignoreInitial hides writes between closing the old watcher and the
          // new one's initial scan. One ready notification covers that gap.
          watcher.once('ready', () => {
            if (!stopped && !handlers.closing() && handlers.watchers.get(space.scopeId) === watcher)
              handlers.refreshed(space.scopeId);
          });
        }
      })
      .catch(handlers.error);
  });
  return () => {
    stopped = true;
    unsubscribe();
  };
}

export class FileService {
  cloud?: {
    resolve(scopeId: string, rel: string): Promise<string>;
    rootEntries(scopeId: string, rel: string): Promise<Entry[] | undefined>;
    /** A connected folder's file with its editability and kept draft. */
    document?(scopeId: string, rel: string): Promise<Document>;
    /** Writes an edited file of a connected folder in place, hash checked. */
    write?(doc: Document): Promise<void>;
    writable?(scopeId: string, rel: string): boolean;
    /** The connected folders on this device that a vault's contents shows through links. */
    localFolders?(scopeId: string): string[];
    /** Where those folders appear, as paths inside the vault. */
    linkedPaths?(scopeId: string): string[];
  };
  private spaces: Space[] = [];
  private bindings: { root: string; scopeId: string }[] = [];
  private queue = new SerialQueue();
  private registrationListeners = new Set<() => void>();
  constructor(readonly dataDir: string) {}
  /** Registration and layer changes require watcher boundaries to be rebuilt. */
  onRegistrationsChanged(listener: () => void) {
    this.registrationListeners.add(listener);
    return () => this.registrationListeners.delete(listener);
  }
  private registrationsChanged() {
    for (const listener of this.registrationListeners) listener();
  }
  async init() {
    await fs.mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    try {
      const bindings = z
        .array(z.object({ root: z.string(), scopeId: z.uuid() }))
        .parse(JSON.parse(await fs.readFile(path.join(this.dataDir, 'spaces.json'), 'utf8')));
      this.bindings = bindings;
      // Each space's contents are resolved once for the whole startup, not once per pair.
      const contents = new Map<Space, Promise<string[]>>();
      for (const b of bindings) {
        try {
          const s = await this.inspect(b.root);
          if (s.scopeId !== b.scopeId) throw Error('Scope identity changed');
          await this.validateRoot(s, contents);
          this.spaces.push(s);
        } catch (error) {
          console.warn('Space unavailable:', b.root, String(error));
        }
      }
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  list() {
    return [...this.spaces];
  }
  get(id: string) {
    const s = this.spaces.find((s) => s.scopeId === id);
    if (!s) throw Error('Unknown space');
    return s;
  }
  private async inspect(root: string): Promise<Space> {
    root = await fs.realpath(root);
    const meta = path.join(root, '.irori', 'scope.json');
    if (!within(root, await fs.realpath(meta))) throw Error('Metadata must stay inside the KB');
    return { ...declaration.parse(JSON.parse(await fs.readFile(meta, 'utf8'))), root };
  }
  private async contentsPaths(s: Space) {
    const paths: string[] = [];
    for (const c of s.contents) {
      const p = path.join(s.root, c);
      paths.push(p);
      try {
        paths.push(await fs.realpath(p));
        // Attachment aliases can point outside contents itself.
        for (const child of await fs.readdir(p)) {
          try {
            paths.push(await fs.realpath(path.join(p, child)));
          } catch {
            /* disconnected */
          }
        }
      } catch {
        /* absent declaration remains a boundary */
      }
    }
    return paths;
  }
  /** `contents` keeps the spaces' resolved contents for the checks of one pass. */
  private async validateRoot(candidate: Space, contents = new Map<Space, Promise<string[]>>()) {
    const contentsOf = (space: Space) => {
      let paths = contents.get(space);
      if (!paths) contents.set(space, (paths = this.contentsPaths(space)));
      return paths;
    };
    for (const s of this.spaces) {
      if (s.root === candidate.root || s.scopeId === candidate.scopeId)
        throw Error('This space or identity is already registered');
      if (
        (await contentsOf(s)).some((c) => within(c, candidate.root)) ||
        (await contentsOf(candidate)).some((c) => within(c, s.root))
      )
        throw Error('A space cannot be registered inside contents (including aliases)');
    }
  }
  async register(root: string, name: string, category: Category): Promise<Space> {
    return this.queue.run(async () => {
      root = await fs.realpath(root);
      if (!(await fs.stat(root)).isDirectory()) throw Error('Choose a KB directory');
      let s: Space;
      let fresh = false;
      try {
        s = await this.inspect(root);
      } catch (error) {
        if (!isMissing(error)) throw error;
        s = {
          ...declaration.parse({
            schemaVersion: 1,
            scopeId: randomUUID(),
            name,
            category,
            contents: ['contents'],
            ...((await bundleAtRoot(root)) && { knowledge: rootKnowledgeFolder }),
          }),
          root,
        };
        fresh = true;
      }
      await this.validateRoot(s);
      if (fresh) {
        const dir = path.join(root, '.irori');
        await fs.mkdir(dir, { recursive: true });
        if (!within(root, await fs.realpath(dir))) throw Error('Metadata alias escapes the KB');
        const { root: _, ...portable } = s;
        await fs.writeFile(path.join(dir, 'scope.json'), JSON.stringify(portable, null, 2) + '\n', {
          flag: 'wx',
        });
        const ignore = path.join(root, '.gitignore');
        // Do not follow a user-created ignore-file alias.
        try {
          if ((await fs.lstat(ignore)).isSymbolicLink())
            throw Error('.gitignore must not be a symlink');
        } catch (e) {
          if (!isMissing(e)) throw e;
        }
        const before = await fs.readFile(ignore, 'utf8').catch((e) => {
          if (isMissing(e)) return '';
          throw e;
        });
        if (!before.split(/\r?\n/).includes('/contents/'))
          await fs.appendFile(
            ignore,
            `${before && !before.endsWith('\n') ? '\n' : ''}/contents/\n`,
          );
      }
      this.spaces.push(s);
      this.bindings = [
        ...this.bindings.filter((b) => b.scopeId !== s.scopeId),
        { root: s.root, scopeId: s.scopeId },
      ];
      await writeLocalJson(path.join(this.dataDir, 'spaces.json'), this.bindings);
      this.registrationsChanged();
      return s;
    });
  }
  /**
   * Takes a vault off this device's list. Its folder and `.irori/scope.json`
   * stay as they are, so registering the folder again brings the same vault back.
   */
  async unregister(id: string): Promise<Space> {
    return this.queue.run(async () => {
      const s = this.get(id);
      const bindings = this.bindings.filter((b) => b.scopeId !== id);
      await writeLocalJson(path.join(this.dataDir, 'spaces.json'), bindings);
      this.bindings = bindings;
      this.spaces = this.spaces.filter((item) => item.scopeId !== id);
      this.registrationsChanged();
      return s;
    });
  }
  /**
   * Changes a brain's name, category or look in its `.irori/scope.json`, keeping
   * every other field of the file as written — another tool's or a later
   * version's included. The write replaces the file atomically.
   */
  async update(id: string, change: SpaceChange): Promise<Space> {
    return this.queue.run(async () => {
      const s = this.get(id);
      const meta = await this.metadata(s.root);
      const raw = JSON.parse(await fs.readFile(meta, 'utf8')) as Record<string, unknown>;
      if (raw.scopeId !== s.scopeId) throw Error('Scope identity changed');
      if (change.name !== undefined) raw.name = change.name.trim();
      for (const key of ['category', 'appearance'] as const) {
        if (change[key] === null) delete raw[key];
        else if (change[key] !== undefined) raw[key] = change[key];
      }
      if (change.labels !== undefined) {
        const labels: Record<string, string> =
          change.labels === null ? {} : { ...(raw.labels as Record<string, string>) };
        for (const [layer, label] of Object.entries(change.labels ?? {})) {
          if (label?.trim()) labels[layer] = label.trim();
          else if (label !== undefined) delete labels[layer];
        }
        if (Object.keys(labels).length) raw.labels = labels;
        else delete raw.labels;
      }
      const next: Space = { ...declaration.parse(raw), root: s.root };
      // A file of the KB keeps its own mode; only device records are made private.
      await writeFileAtomic(meta, JSON.stringify(raw, null, 2) + '\n');
      this.spaces = this.spaces.map((item) => (item.scopeId === id ? next : item));
      this.registrationsChanged();
      // Only the icon the declaration names stays beside it.
      const icon = next.appearance?.icon?.kind === 'image' ? next.appearance.icon.path : '';
      for (const name of await fs.readdir(path.dirname(meta)))
        if (iconImagePath.test(`.irori/${name}`) && `.irori/${name}` !== icon)
          await fs.rm(path.join(path.dirname(meta), name), { force: true });
      return next;
    });
  }
  /**
   * Why a `.irori/scope.json` that a pull brings may not replace this vault's,
   * or undefined when it may (ADR 028): it parses as a declaration, keeps the
   * same `scopeId`, and passes the checks a local layer rename and registration
   * apply — ordinary folder names, layers that do not overlap, no layer inside
   * another vault, and no other vault inside its contents.
   */
  async incomingDeclarationProblem(id: string, text: string): Promise<string | undefined> {
    const s = this.get(id);
    let next: Space;
    try {
      next = { ...declaration.parse(JSON.parse(text.replace(/^\uFEFF/, ''))), root: s.root };
    } catch {
      return 'The incoming declaration does not parse';
    }
    if (next.scopeId !== s.scopeId) return 'The incoming declaration changes the identity';
    // A knowledge folder at the vault's root overlaps nothing and needs no name check.
    const folders = [knowledgeFolder(next), ...next.contents].filter(Boolean);
    for (const folder of folders) {
      if (folder === knowledgeFolder(s) || s.contents.includes(folder)) continue;
      const problem = folder.split('/').map(layerFolderProblem).find(Boolean);
      if (problem) return problem;
    }
    const overlaps = (a: string, b: string) =>
      a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
    if (folders.some((a, i) => folders.some((b, j) => i < j && overlaps(a, b))))
      return 'The incoming declaration overlaps its layers';
    if (folders.some((folder) => owner(this.spaces, path.join(s.root, folder))?.scopeId !== id))
      return 'The incoming declaration puts a layer in another vault';
    const others = this.spaces.filter((other) => other.scopeId !== id);
    const contents = await this.contentsPaths(next);
    if (others.some((other) => contents.some((c) => within(c, other.root))))
      return 'The incoming declaration puts another vault in contents';
  }
  /**
   * Reads this vault's `.irori/scope.json` again after a pull changed it, so
   * its layers, names and look follow without a restart. The identity must stay.
   */
  async reloadDeclaration(id: string): Promise<Space> {
    return this.queue.run(async () => {
      const s = this.get(id);
      const next = await this.inspect(s.root);
      if (next.scopeId !== s.scopeId) throw Error('Scope identity changed');
      const others = this.spaces.filter((other) => other.scopeId !== id);
      const contents = await this.contentsPaths(next);
      if (others.some((other) => contents.some((c) => within(c, other.root))))
        throw Error('A space cannot be registered inside contents (including aliases)');
      this.spaces = this.spaces.map((item) => (item.scopeId === id ? next : item));
      this.registrationsChanged();
      return next;
    });
  }
  /** Keeps an image as the brain's icon in `.irori/`; the declaration names it on save. */
  async saveIcon(id: string, bytes: Uint8Array, type: string) {
    return this.queue.run(async () => {
      const s = this.get(id);
      const directory = path.dirname(await this.metadata(s.root));
      const relative = `.irori/icon-${hash(Buffer.from(bytes)).slice(0, 12)}.${type}`;
      await writeFileAtomic(path.join(directory, path.basename(relative)), Buffer.from(bytes));
      return relative;
    });
  }
  /**
   * Renames the knowledge or contents folder (ADR 024). A folder that exists moves
   * to the new name, which must be free; one not there yet changes only in the
   * declaration, so a KB can name a folder it already has. The connection records
   * that name the contents folder follow it, and so do the kept drafts of the
   * knowledge files. Returns the knowledge files that moved, by their previous
   * paths; links, comments and device records are the caller's to carry.
   */
  async renameLayerFolder(
    id: string,
    layer: NamedLayer,
    name: string,
  ): Promise<{ space: Space; previous: string; files: string[]; entries?: string[] }> {
    return this.queue.run(async () => {
      const atRoot = layer === 'Knowledge_Base' && (name === rootKnowledgeFolder || name === '');
      const problem = atRoot ? undefined : layerFolderProblem(name);
      if (problem) throw Error(problem);
      const s = this.get(id);
      const previous = layer === 'contents' ? s.contents[0] : knowledgeFolder(s);
      if (layer === 'Knowledge_Base' && (atRoot || !previous))
        return this.moveKnowledgeRoot(s, previous, atRoot ? '' : name);
      // A contents folder declared inside another folder keeps its place.
      const parent = layer === 'contents' ? path.posix.dirname(previous) : '.';
      const next = parent === '.' ? name : `${parent}/${name}`;
      if (next === previous) return { space: s, previous, files: [] as string[] };
      const overlaps = (a: string, b: string) =>
        a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
      const others =
        layer === 'contents' ? [knowledgeFolder(s), ...s.contents.slice(1)] : s.contents;
      if (
        others.some((other) => overlaps(other, next)) ||
        owner(this.spaces, path.join(s.root, next))?.scopeId !== id
      )
        throw Error(
          t(
            'その名前は別の層か別の vault のフォルダです。',
            "That name is another layer's or another vault's folder.",
          ),
        );
      const from = path.join(s.root, previous);
      const to = path.join(s.root, next);
      const stat = (filename: string) =>
        fs.lstat(filename).catch((error) => {
          if (!isMissing(error)) throw error;
        });
      const [before, after] = [await stat(from), await stat(to)];
      // On a case-insensitive volume a change of case finds the folder itself.
      const sameEntry = !!before && !!after && before.ino === after.ino && before.dev === after.dev;
      const notFolder = Error(
        t(
          'フォルダの alias / シンボリックリンクは名前を変えられません。',
          'Folder aliases and symbolic links cannot be renamed.',
        ),
      );
      if (before && (before.isSymbolicLink() || !before.isDirectory())) throw notFolder;
      if (!before && after && (after.isSymbolicLink() || !after.isDirectory())) throw notFolder;
      if (before && after && !sameEntry)
        throw Error(
          t(
            '同じ名前のファイルかフォルダが既にあります。',
            'A file or folder with that name already exists.',
          ),
        );
      const moved = before && layer === 'Knowledge_Base' ? await this.walk(from, previous) : [];
      const meta = await this.metadata(s.root);
      const original = await fs.readFile(meta, 'utf8');
      const raw = JSON.parse(original) as Record<string, unknown>;
      if (raw.scopeId !== s.scopeId) throw Error('Scope identity changed');
      if (layer === 'contents') raw.contents = [next, ...s.contents.slice(1)];
      else if (next === defaultKnowledgeFolder) delete raw.knowledge;
      else raw.knowledge = next;
      const space: Space = { ...declaration.parse(raw), root: s.root };
      const records =
        layer === 'contents' ? await this.contentsRecords(path.dirname(meta), previous, next) : [];
      if (before) await fs.rename(from, to);
      try {
        await writeFileAtomic(meta, JSON.stringify(raw, null, 2) + '\n');
        for (const record of records) await writeFileAtomic(record.filename, record.next);
      } catch (error) {
        // The folder and its declaration change together or not at all.
        await writeFileAtomic(meta, original).catch(() => {});
        for (const record of records)
          await writeFileAtomic(record.filename, record.original).catch(() => {});
        if (before) await fs.rename(to, from).catch(() => {});
        throw error;
      }
      this.spaces = this.spaces.map((item) => (item.scopeId === id ? space : item));
      this.registrationsChanged();
      if (layer === 'contents') await this.ignoreContents(s.root, previous, next);
      for (const file of moved) {
        const target = movedPath({ from: previous, to: next }, file)!;
        await fs
          .rename(draftFile(this.dataDir, id, file), draftFile(this.dataDir, id, target))
          .catch(() => {});
      }
      return { space, previous, files: moved };
    });
  }
  /**
   * Makes the vault's root its knowledge folder, or a named folder again (ADR
   * 035). To the root, the knowledge folder's children move up beside Schema
   * and contents, and the emptied folder goes; refused when one of them would
   * land on a name the root already has, or on one that is Schema or contents
   * there. From the root, every top-level knowledge entry moves into the named
   * folder, unless that folder exists, which is then taken as it is. The moves
   * and the declaration change together or not at all; links and other records
   * are the caller's to carry, by the entries returned.
   */
  private async moveKnowledgeRoot(s: Space, previous: string, next: string) {
    if (next === previous) return { space: s, previous, files: [] as string[], entries: [] };
    const id = s.scopeId;
    const meta = await this.metadata(s.root);
    const original = await fs.readFile(meta, 'utf8');
    const raw = JSON.parse(original) as Record<string, unknown>;
    if (raw.scopeId !== s.scopeId) throw Error('Scope identity changed');
    if (next === defaultKnowledgeFolder) delete raw.knowledge;
    else raw.knowledge = next || rootKnowledgeFolder;
    const space: Space = { ...declaration.parse(raw), root: s.root };
    const stat = (relative: string) =>
      fs.lstat(path.join(s.root, relative)).catch((error) => {
        if (!isMissing(error)) throw error;
      });
    const notFolder = Error(
      t(
        'フォルダの alias / シンボリックリンクは名前を変えられません。',
        'Folder aliases and symbolic links cannot be renamed.',
      ),
    );
    const ownEntry = (relative: string) =>
      owner(this.spaces, path.join(s.root, relative))?.scopeId === id;
    // Each top-level entry that moves, by its name at the root, and where it goes.
    const entries: string[] = [];
    const refused: string[] = [];
    let created = false;
    let emptied: string | undefined;
    if (!next) {
      const folder = await stat(previous);
      if (folder && (folder.isSymbolicLink() || !folder.isDirectory())) throw notFolder;
      if (folder) {
        for (const entry of await fs.readdir(path.join(s.root, previous))) {
          if (placeholders.includes(entry)) continue;
          if (
            classify(space, entry) !== 'Knowledge_Base' ||
            (await stat(entry)) ||
            !ownEntry(`${previous}/${entry}`)
          )
            refused.push(entry);
          else entries.push(entry);
        }
        emptied = previous;
      }
    } else {
      const overlaps = (a: string, b: string) =>
        a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
      if (s.contents.some((other) => overlaps(other, next)) || !ownEntry(next))
        throw Error(
          t(
            'その名前は別の層か別の vault のフォルダです。',
            "That name is another layer's or another vault's folder.",
          ),
        );
      const folder = await stat(next);
      if (folder && (folder.isSymbolicLink() || !folder.isDirectory())) throw notFolder;
      if (!folder) {
        for (const entry of await fs.readdir(s.root))
          if (
            classify(s, entry) === 'Knowledge_Base' &&
            entry !== 'node_modules' &&
            // A folder holding a contents folder stays, and so does another vault.
            !s.contents.some((root) => root.startsWith(`${entry}/`)) &&
            ownEntry(entry)
          )
            entries.push(entry);
        created = true;
      }
    }
    if (refused.length)
      throw Error(
        t(
          `vault のルートに同じ名前があるか、Schema か contents になる名前のため移せません: ${refused.join(', ')}`,
          `These cannot move to the vault's root, which has the same name or keeps it for Schema or contents: ${refused.join(', ')}`,
        ),
      );
    const move: LayerMove = { from: previous, to: next, entries };
    const from = (entry: string) => (next ? entry : `${previous}/${entry}`);
    const to = (entry: string) => (next ? `${next}/${entry}` : entry);
    const moved: string[] = [];
    for (const entry of entries) {
      const at = await stat(from(entry));
      if (at?.isDirectory())
        moved.push(...(await this.walk(path.join(s.root, from(entry)), from(entry))));
      else if (at?.isFile()) moved.push(from(entry));
    }
    const done: string[] = [];
    const undo = async () => {
      if (emptied) await fs.mkdir(path.join(s.root, emptied), { recursive: true }).catch(() => {});
      for (const entry of done.reverse())
        await fs
          .rename(path.join(s.root, to(entry)), path.join(s.root, from(entry)))
          .catch(() => {});
      if (created) await fs.rmdir(path.join(s.root, next)).catch(() => {});
    };
    try {
      if (created) await fs.mkdir(path.join(s.root, next));
      for (const entry of entries) {
        await fs.rename(path.join(s.root, from(entry)), path.join(s.root, to(entry)));
        done.push(entry);
      }
      if (emptied) {
        for (const placeholder of placeholders)
          await fs.rm(path.join(s.root, emptied, placeholder), { force: true });
        await fs.rmdir(path.join(s.root, emptied));
      }
      await writeFileAtomic(meta, JSON.stringify(raw, null, 2) + '\n');
    } catch (error) {
      // The entries and the declaration change together or not at all.
      await writeFileAtomic(meta, original).catch(() => {});
      await undo();
      throw error;
    }
    this.spaces = this.spaces.map((item) => (item.scopeId === id ? space : item));
    this.registrationsChanged();
    for (const file of moved)
      await fs
        .rename(
          draftFile(this.dataDir, id, file),
          draftFile(this.dataDir, id, movedPath(move, file)!),
        )
        .catch(() => {});
    return { space, previous, files: moved, entries };
  }
  /**
   * Declares a folder the vault already has as contents beside its contents
   * folder (ADR 030), as a person moving an Obsidian vault or a project in may
   * want for its attachments or code. The folder stays where it is and Git
   * keeps tracking it; it is checked as an incoming declaration's would be.
   */
  async declareContents(id: string, folder: string): Promise<Space> {
    return this.queue.run(async () => {
      const s = this.get(id);
      const next = folder.replace(/\\/g, '/').replace(/^\.\/|\/+$/g, '');
      const problem = next.split('/').map(layerFolderProblem).find(Boolean);
      if (problem) throw Error(problem);
      if (s.contents.includes(next)) return s;
      const overlaps = (a: string, b: string) =>
        a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
      if ([knowledgeFolder(s), ...s.contents].some((other) => overlaps(other, next)))
        throw Error(
          t(
            'そのフォルダは別の層と重なっています。',
            "That folder is another layer's or overlaps one.",
          ),
        );
      const absolute = path.join(s.root, next);
      const stat = await fs.lstat(absolute).catch((error) => {
        if (!isMissing(error)) throw error;
      });
      if (!stat?.isDirectory())
        throw Error(
          t(
            `${next} は vault の中のフォルダではありません。`,
            `${next} is not a folder in the vault.`,
          ),
        );
      if (owner(this.spaces, absolute)?.scopeId !== id)
        throw Error(t('そのフォルダは別の vault です。', "That folder is another vault's."));
      const meta = await this.metadata(s.root);
      const raw = JSON.parse(await fs.readFile(meta, 'utf8')) as Record<string, unknown>;
      if (raw.scopeId !== s.scopeId) throw Error('Scope identity changed');
      raw.contents = [...s.contents, next];
      const space: Space = { ...declaration.parse(raw), root: s.root };
      const contents = await this.contentsPaths(space);
      if (
        this.spaces.some(
          (other) => other.scopeId !== id && contents.some((c) => within(c, other.root)),
        )
      )
        throw Error('A space cannot be registered inside contents (including aliases)');
      await writeFileAtomic(meta, JSON.stringify(raw, null, 2) + '\n');
      this.spaces = this.spaces.map((item) => (item.scopeId === id ? space : item));
      this.registrationsChanged();
      return space;
    });
  }
  /** The files under a folder, by their paths in the vault; links are not followed. */
  private async walk(directory: string, rel: string) {
    const out: string[] = [];
    const visit = async (dir: string, prefix: string) => {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        if (out.length > 100_000)
          throw Error(
            t(
              'ファイルが多すぎるため、このフォルダは名前を変えられません。',
              'This folder holds too many files to be renamed.',
            ),
          );
        const p = `${prefix}/${entry.name}`;
        if (entry.isDirectory() && !['.git', 'node_modules'].includes(entry.name))
          await visit(path.join(dir, entry.name), p);
        else if (entry.isFile()) out.push(p);
      }
    };
    await visit(directory, rel);
    return out;
  }
  /** The connection records whose folders appear in `previous`, rewritten to appear in `next`. */
  private async contentsRecords(directory: string, previous: string, next: string) {
    const out: { filename: string; original: string; next: string }[] = [];
    for (const name of ['local-folders.json', 'cloud-mounts.json']) {
      const filename = path.join(directory, name);
      const stat = await fs.lstat(filename).catch((error) => {
        if (!isMissing(error)) throw error;
      });
      if (!stat) continue;
      if (stat.isSymbolicLink()) throw Error('Cloud metadata must not be a symlink');
      const original = await fs.readFile(filename, 'utf8');
      const records = JSON.parse(original) as unknown;
      if (!Array.isArray(records)) continue;
      let changed = false;
      for (const record of records)
        if (record && typeof record === 'object' && record.contentsRoot === previous) {
          record.contentsRoot = next;
          changed = true;
        }
      if (changed) out.push({ filename, original, next: JSON.stringify(records, null, 2) + '\n' });
    }
    return out;
  }
  /**
   * Ignores the renamed contents folder as the previous name was. The previous
   * line stays: another device keeps its own folder of links under that name
   * until it follows, and those links must not reach the KB's history.
   */
  private async ignoreContents(root: string, previous: string, next: string) {
    const ignore = path.join(root, '.gitignore');
    const stat = await fs.lstat(ignore).catch(() => undefined);
    if (!stat?.isFile()) return;
    const before = await fs.readFile(ignore, 'utf8');
    const lines = before.split(/\r?\n/);
    if (!lines.includes(`/${previous}/`) || lines.includes(`/${next}/`)) return;
    await fs.appendFile(ignore, `${before && !before.endsWith('\n') ? '\n' : ''}/${next}/\n`);
  }
  /** The KB's own `.irori/scope.json`, refusing a link that leads out of it. */
  private async metadata(root: string) {
    const meta = path.join(root, '.irori', 'scope.json');
    if ((await fs.lstat(meta)).isSymbolicLink() || !within(root, await fs.realpath(meta)))
      throw Error('Metadata must stay inside the KB');
    return meta;
  }
  async resolve(id: string, rel: string, allowRoot = false) {
    const s = this.get(id);
    if (!(allowRoot && rel === '')) relative.parse(rel);
    const requested = path.resolve(s.root, rel);
    if (!within(s.root, requested) || owner(this.spaces, requested)?.scopeId !== id)
      throw Error('Path belongs to another space');
    if (classify(s, rel) === 'contents' && this.cloud) return this.cloud.resolve(id, rel);
    const actual = await fs.realpath(requested);
    if (!within(s.root, actual) || owner(this.spaces, actual)?.scopeId !== id)
      throw Error('Path alias crosses a space boundary');
    if (
      classify(s, rel) === 'contents' ||
      classify(s, path.relative(s.root, actual)) === 'contents'
    )
      throw Error(
        'Cloud connection is unverified; contents access is not enabled in this milestone',
      );
    return actual;
  }
  async entries(id: string, rel: string): Promise<Entry[]> {
    const s = this.get(id);
    const cloudEntries = await this.cloud?.rootEntries(id, rel);
    if (cloudEntries) return cloudEntries;
    const dir = await this.resolve(id, rel, true);
    const files = (await fs.readdir(dir, { withFileTypes: true })).filter(
      (f) => !['.git', 'node_modules'].includes(f.name),
    );
    if (files.length > 4000) throw Error('This directory exceeds the initial 4,000-entry limit');
    const out: Entry[] = [];
    for (const f of files) {
      const p = rel ? `${rel}/${f.name}` : f.name;
      if (owner(this.spaces, path.join(s.root, p))?.scopeId !== id) continue;
      const layer = classify(s, p);
      out.push({
        path: p,
        name: f.name,
        directory: f.isDirectory(),
        layer,
        note: /\.md$/i.test(f.name),
        blocked:
          layer === 'contents' &&
          !(this.cloud && (s.contents.includes(p) || classify(s, rel) === 'contents'))
            ? t(
                '接続未検証・ローカル保存先としては使用できません',
                'Connection not verified; cannot be used as local storage',
              )
            : f.isSymbolicLink()
              ? t('リンク先はこの版では開けません', 'Link targets cannot be opened in this version')
              : undefined,
        ...(layer === 'contents' && !f.isSymbolicLink() && this.cloud?.writable?.(id, p)
          ? { writable: true }
          : {}),
      });
    }
    if (!rel)
      for (const c of s.contents)
        if (!out.some((e) => e.path === c))
          out.push({
            path: c,
            name: c,
            directory: true,
            layer: 'contents',
            note: false,
            blocked: this.cloud ? undefined : t('未接続', 'Not connected'),
          });
    return out.sort(
      (a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name),
    );
  }
  async read(id: string, rel: string): Promise<Document> {
    if (classify(this.get(id), rel) === 'contents' && this.cloud?.document)
      return this.cloud.document(id, rel);
    const filename = await this.resolve(id, rel);
    const doc = await readDocument(filename, id, rel);
    if (classify(this.get(id), rel) === 'contents') return { ...doc, readOnly: true };
    if (doc.viewer) return doc;
    try {
      doc.draft = z
        .object({ text: z.string(), baseHash: z.string() })
        .parse(JSON.parse(await fs.readFile(this.draftPath(doc), 'utf8')));
    } catch (e) {
      if (!isMissing(e)) throw e;
    }
    return doc;
  }
  private draftPath(doc: Pick<Document, 'scopeId' | 'path'>) {
    return draftFile(this.dataDir, doc.scopeId, doc.path);
  }
  async draft(doc: Document) {
    return this.queue.run(() => this.writeDraft(doc));
  }
  private async writeDraft(doc: Document) {
    this.get(doc.scopeId);
    relative.parse(doc.path);
    await writeLocalJson(this.draftPath(doc), { text: doc.text, baseHash: doc.hash });
  }
  async save(doc: Document): Promise<Document> {
    return this.queue.run(async () => {
      editableText(doc.text);
      if (classify(this.get(doc.scopeId), doc.path) === 'contents') {
        if (!this.cloud?.write)
          throw Error(
            t('このクラウド接続は読み取り専用です。', 'This cloud connection is read-only.'),
          );
        // A Drive file is written in place by the cloud service; the draft stays
        // until the file holds the text.
        await this.writeDraft(doc);
        await this.cloud.write(doc);
        await fs.rm(this.draftPath(doc), { force: true });
        return this.read(doc.scopeId, doc.path);
      }
      await this.writeDraft(doc);
      const filename = await this.resolve(doc.scopeId, doc.path);
      const before = await fs.readFile(filename);
      if (hash(before) !== doc.hash)
        throw Error(
          t(
            'CONFLICT: ディスク上でファイルが変更されました。下書きは保持されています。',
            'CONFLICT: The file changed on disk. Your draft is kept.',
          ),
        );
      if (hash(doc.text) !== doc.hash) {
        // Retain the previous observed version against a racing external writer.
        await writeLocalFile(
          path.join(this.dataDir, `backup-${hash(before)}.txt`),
          before.toString('utf8'),
        );
        const mode = (await fs.stat(filename)).mode;
        await replaceChecked(filename, doc.text, mode, async () => {
          if (hash(await fs.readFile(filename)) !== doc.hash)
            throw Error('CONFLICT: File changed during save');
        });
      }
      await fs.rm(this.draftPath(doc), { force: true });
      return this.read(doc.scopeId, doc.path);
    });
  }
  private noteLocation(id: string, rel: string, directory = false) {
    const space = this.get(id);
    if (!(directory && rel === '')) relative.parse(rel);
    if (
      /[\u0000-\u001f\\:*?"<>|]/.test(rel) ||
      rel.split('/').some((part) => part.startsWith('.') || /[. ]$/.test(part)) ||
      classify(space, rel) !== 'Knowledge_Base' ||
      owner(this.spaces, path.join(space.root, rel))?.scopeId !== id ||
      (!directory &&
        (!/\.md$/i.test(rel) ||
          noteFilename(path.posix.basename(rel)).toLowerCase() !==
            path.posix.basename(rel).toLowerCase()))
    )
      throw Error(
        t(
          '同じスペースのナレッジ内にある Markdown ノートを指定してください。',
          'Choose a Markdown note in the Knowledge of the same space.',
        ),
      );
    return path.join(space.root, rel);
  }
  private async noteDirectory(id: string, rel: string, create = false) {
    this.noteLocation(id, rel, true);
    await ordinaryFolders(rel, create, {
      location: (prefix) => this.noteLocation(id, prefix, true),
      resolve: (prefix) => this.resolve(id, prefix),
      notFolder: () =>
        Error(
          t(
            'フォルダの alias / シンボリックリンクは操作できません。',
            'Folder aliases and symbolic links cannot be changed.',
          ),
        ),
      moved: () =>
        Error(t('フォルダの alias が変更されています。', 'The folder alias has changed.')),
    });
    return this.resolve(id, rel, true);
  }
  private async existingNote(ref: NoteRef) {
    noteRef.parse(ref);
    const filename = this.noteLocation(ref.scopeId, ref.path);
    await this.noteDirectory(
      ref.scopeId,
      path.posix.dirname(ref.path) === '.' ? '' : path.posix.dirname(ref.path),
    );
    const stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw Error(
        t('通常の Markdown ノートを選択してください。', 'Choose an ordinary Markdown note.'),
      );
    const doc = await this.read(ref.scopeId, ref.path);
    if (doc.hash !== ref.hash)
      throw Error(t('CONFLICT: ノートが変更されています。', 'CONFLICT: The note has changed.'));
    if (doc.draft && doc.draft.text !== doc.text)
      throw Error(t('未保存の下書きがあります。', 'There is an unsaved draft.'));
    return { filename, doc, stat };
  }
  async createNote(id: string, name: string, directory = defaultNoteDirectory) {
    const filename = noteFilename(name);
    return this.createNoteAt(
      id,
      directory ? `${directory}/${filename}` : filename,
      `# ${filename.slice(0, -3)}\n\n`,
    );
  }
  /** Publishes a new note at a full relative path; an existing file is never replaced. */
  async createNoteAt(id: string, rel: string, text: string) {
    return this.queue.run(async () => {
      const destination = this.noteLocation(id, rel);
      const directory = path.posix.dirname(rel);
      await this.noteDirectory(id, directory === '.' ? '' : directory, true);
      await fs.writeFile(destination, text, { flag: 'wx' });
      return this.read(id, rel);
    });
  }
  /**
   * A file or folder of this vault's knowledge that the explorer changes: inside
   * knowledge and this vault, and not the knowledge folder itself, whose name
   * belongs to the vault's settings (ADR 024).
   */
  private knowledgeEntry(id: string, rel: string) {
    const space = this.get(id);
    relative.parse(rel);
    if (
      classify(space, rel) !== 'Knowledge_Base' ||
      owner(this.spaces, path.join(space.root, rel))?.scopeId !== id
    )
      throw Error(
        t(
          'この vault のナレッジの中を指定してください。',
          "Choose a place in this vault's knowledge.",
        ),
      );
    if (rel === knowledgeFolder(space))
      throw Error(
        t(
          'ナレッジのフォルダ名は vault の設定で変更してください。',
          "Change the knowledge folder's name in the vault settings.",
        ),
      );
    return space;
  }
  /** A name for a new or renamed entry; a hidden name would be Schema's, not knowledge's. */
  private entryName(name: string) {
    const problem =
      entryNameError(name) ??
      (name.startsWith('.')
        ? t(
            'ナレッジでは「.」で始まる名前は使えません。',
            'Names in knowledge cannot start with ".".',
          )
        : undefined);
    if (problem) throw Error(problem);
  }
  /**
   * The real folder of `directory` in knowledge, an ordinary folder all the way
   * down. A vault may not have its knowledge folder yet; it is made on first use.
   */
  private knowledgeFolderOf(id: string, directory: string) {
    if (!directory) return this.resolve(id, '', true);
    return this.noteDirectory(id, directory, directory === knowledgeFolder(this.get(id)));
  }
  /** Refuses a folder whose move or deletion would take another vault or contents with it. */
  private holdsNoBoundary(space: Space, rel: string) {
    const folder = path.join(space.root, rel);
    if (
      this.spaces.some((other) => other.scopeId !== space.scopeId && within(folder, other.root)) ||
      space.contents.some((root) => root.startsWith(`${rel}/`))
    )
      throw Error(
        t(
          'このフォルダには別の vault かコンテンツが入っています。',
          'This folder holds another vault or contents.',
        ),
      );
  }
  /** Adds a file or folder to a folder of knowledge; an existing entry is never replaced. */
  async createEntry(id: string, directory: string, entry: NewEntry): Promise<Entry> {
    return this.queue.run(async () => {
      this.entryName(entry.name);
      if (directory) this.knowledgeEntry(id, `${directory}/${entry.name}`);
      else this.knowledgeEntry(id, entry.name);
      const { name, upload } = await writeNewEntry(
        await this.knowledgeFolderOf(id, directory),
        entry,
      );
      return {
        path: directory ? `${directory}/${name}` : name,
        name,
        directory: entry.kind === 'folder',
        layer: 'Knowledge_Base',
        note: entry.kind === 'file' && /\.md$/i.test(name),
        ...(upload && { upload }),
      };
    });
  }
  /**
   * Renames or moves a file or folder within knowledge. The caller carries what
   * names its paths, from the files returned: their paths before the move.
   */
  async moveEntry(
    id: string,
    from: string,
    to: string,
  ): Promise<{ entry: Entry; files: string[] }> {
    return this.queue.run(async () => {
      const space = this.knowledgeEntry(id, from);
      this.knowledgeEntry(id, to);
      const name = path.posix.basename(to);
      this.entryName(name);
      const parentOf = (rel: string) => {
        const directory = path.posix.dirname(rel);
        return this.knowledgeFolderOf(id, directory === '.' ? '' : directory);
      };
      const actual = path.join(await parentOf(from), path.posix.basename(from));
      const info = await fs.lstat(actual);
      if (info.isSymbolicLink())
        throw Error(
          t(
            'alias / シンボリックリンクは移動できません。',
            'Aliases and symbolic links cannot be moved.',
          ),
        );
      if (info.isDirectory()) {
        if (to === from || to.startsWith(`${from}/`))
          throw Error(
            t(
              'フォルダを自分自身やその中のフォルダには移動できません。',
              'A folder cannot be moved into itself or into one of its own folders.',
            ),
          );
        this.holdsNoBoundary(space, from);
      }
      const destination = path.join(await parentOf(to), name);
      const moved = info.isDirectory() ? await this.walk(actual, from) : [from];
      await renameEntry(actual, destination);
      // A kept draft follows its file.
      if (from !== to)
        for (const file of moved)
          await fs
            .rename(
              draftFile(this.dataDir, id, file),
              draftFile(this.dataDir, id, movedPath({ from, to }, file)!),
            )
            .catch(() => {});
      return {
        entry: {
          path: to,
          name,
          directory: info.isDirectory(),
          layer: 'Knowledge_Base',
          note: info.isFile() && /\.md$/i.test(name),
        },
        files: moved,
      };
    });
  }
  /**
   * Moves a file or folder of one vault's knowledge into `directory` of another
   * vault's knowledge (ADR 038). It keeps its name, or takes the first free one;
   * nothing is replaced. A note's managed images are copied beside it. Between
   * volumes the entry is copied and the original goes to `trash`. Returns the
   * moved files by their paths before the move, for the caller to carry what
   * names them.
   */
  async moveAcross(
    id: string,
    from: string,
    toId: string,
    directory: string,
    trash: (filename: string) => Promise<void>,
  ): Promise<{ entry: Entry; files: string[] }> {
    return this.queue.run(async () => {
      if (id === toId) throw Error('The same vault');
      const space = this.knowledgeEntry(id, from);
      const parentOf = (scope: string, rel: string) => {
        const folder = path.posix.dirname(rel);
        return this.knowledgeFolderOf(scope, folder === '.' ? '' : folder);
      };
      const actual = path.join(await parentOf(id, from), path.posix.basename(from));
      const info = await fs.lstat(actual);
      if (info.isSymbolicLink())
        throw Error(
          t(
            'alias / シンボリックリンクは移動できません。',
            'Aliases and symbolic links cannot be moved.',
          ),
        );
      if (info.isDirectory()) this.holdsNoBoundary(space, from);
      const target = await this.knowledgeFolderOf(toId, directory);
      const name = await freeName(target, path.posix.basename(from));
      const to = directory ? `${directory}/${name}` : name;
      this.knowledgeEntry(toId, to);
      const destination = path.join(target, name);
      const moved = info.isDirectory() ? await this.walk(actual, from) : [from];
      // The managed images a note shows go with it; a missing one was broken already.
      if (info.isFile() && /\.md$/i.test(from)) {
        const text = await fs.readFile(actual, 'utf8');
        const folder = path.posix.dirname(from) === '.' ? '' : path.posix.dirname(from);
        const images = [
          ...new Set(internalLinks(text, from).filter((link) => carriedImage(from, link))),
        ];
        for (const image of images) {
          const asset = image.slice(folder ? folder.length + 1 : 0);
          const bytes = await fs
            .readFile(path.join(await parentOf(id, image), path.posix.basename(image)))
            .catch(() => undefined);
          if (!bytes) continue;
          const assets = path.posix.dirname(directory ? `${directory}/${asset}` : asset);
          await this.noteDirectory(toId, assets, true);
          const copy = path.join(target, asset);
          try {
            await fs.writeFile(copy, bytes, { flag: 'wx' });
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
            // Managed images are named by their contents, so the one there is the same.
            if (hash(await fs.readFile(copy)) !== hash(bytes))
              throw Error(
                t(
                  '移動先の画像と内容が一致しません。',
                  'The image at the destination has different contents.',
                ),
              );
          }
        }
      }
      try {
        await fs.rename(actual, destination);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
        await fs.cp(actual, destination, {
          recursive: true,
          errorOnExist: true,
          force: false,
          verbatimSymlinks: true,
        });
        await trash(actual);
      }
      // A kept draft follows its file.
      for (const file of moved)
        await fs
          .rename(
            draftFile(this.dataDir, id, file),
            draftFile(this.dataDir, toId, movedPath({ from, to }, file)!),
          )
          .catch(() => {});
      return {
        entry: {
          path: to,
          name,
          directory: info.isDirectory(),
          layer: 'Knowledge_Base',
          note: info.isFile() && /\.md$/i.test(name),
        },
        files: moved,
      };
    });
  }
  /** Hands a file or folder of knowledge to `trash`, the system trash. */
  async trashEntry(id: string, rel: string, trash: (filename: string) => Promise<void>) {
    return this.queue.run(async () => {
      const space = this.knowledgeEntry(id, rel);
      const directory = path.posix.dirname(rel);
      const actual = path.join(
        await this.knowledgeFolderOf(id, directory === '.' ? '' : directory),
        path.posix.basename(rel),
      );
      const info = await fs.lstat(actual);
      if (info.isDirectory()) this.holdsNoBoundary(space, rel);
      await trash(actual);
      if (info.isFile()) await fs.rm(draftFile(this.dataDir, id, rel), { force: true });
    });
  }
  /**
   * Publishes a file irori generated in the knowledge layer — the graph index —
   * atomically: `expected` is the hash of the bytes being replaced, or null when
   * the file must not exist yet, so a file changed meanwhile is never overwritten.
   * Missing folders are created; an alias anywhere on the path is refused.
   */
  async writeGenerated(id: string, rel: string, text: string, expected: string | null) {
    return this.queue.run(async () => {
      editableText(text);
      const space = this.get(id);
      relative.parse(rel);
      if (
        classify(space, rel) !== 'Knowledge_Base' ||
        owner(this.spaces, path.join(space.root, rel))?.scopeId !== id ||
        rel.split('/').some((part) => part.startsWith('.')) ||
        !textFilePattern.test(rel)
      )
        throw Error(
          t(
            '生成したファイルはこの KB のナレッジ層にだけ書き込めます。',
            "Generated files can be written only to this KB's Knowledge layer.",
          ),
        );
      const directory = path.posix.dirname(rel);
      const parent = await this.noteDirectory(id, directory === '.' ? '' : directory, true);
      const filename = path.join(parent, path.posix.basename(rel));
      const existing = await fs.lstat(filename).catch((error) => {
        if (!isMissing(error)) throw error;
      });
      if (existing && (!existing.isFile() || existing.isSymbolicLink()))
        throw Error(
          t('生成先が通常のファイルではありません。', 'The output is not an ordinary file.'),
        );
      const changed = () =>
        Error(
          t(
            'CONFLICT: 生成先のファイルが変更されています。',
            'CONFLICT: The output file has changed.',
          ),
        );
      // A previous version may have generated an oversized file. Hash it without
      // loading its bytes into memory, retaining the ordinary replacement guard.
      const unchanged = async () => {
        if ((await stableHash(filename, changed)).hash !== expected) throw changed();
      };
      if (expected === null) {
        if (existing)
          throw Error(
            t(
              'CONFLICT: 生成先にファイルが作られています。',
              'CONFLICT: A file was created at the output location.',
            ),
          );
        await writeExclusive(filename, text);
      } else {
        if (!existing) throw changed();
        await unchanged();
        await replaceChecked(filename, text, existing.mode, unchanged);
      }
      return this.read(id, rel);
    });
  }
  /** Moves the note's bytes as they are; `rewriting` says its links will be rewritten after. */
  async moveNote(ref: NoteRef, destinationPath: string, rewriting = false): Promise<Document> {
    return this.queue.run(async () => {
      const source = await this.existingNote(ref);
      const destination = this.noteLocation(ref.scopeId, destinationPath);
      if (ref.path === destinationPath) return source.doc;
      const from = path.posix.dirname(ref.path);
      const to = path.posix.dirname(destinationPath);
      const assets = from === to ? [] : imagesForNoteMove(source.doc.text, rewriting);
      if (from !== to) {
        const copied = new Map(
          assets.map((asset) => [
            path.posix.join(from, asset).normalize('NFC'),
            path.posix.join(to, asset),
          ]),
        );
        const references = rewriteNoteReferences(
          source.doc.text,
          ref.path,
          destinationPath,
          (p) => copied.get(p) ?? p,
          layerRoots(this.get(ref.scopeId)),
        );
        if (!rewriting && references.links)
          throw Error(
            t(
              '相対参照を含むノートはリンクを更新せずに移動できません。',
              'A note with relative references cannot be moved without updating links.',
            ),
          );
      }
      await this.noteDirectory(ref.scopeId, to === '.' ? '' : to);
      // Exclusive publication must reject existing files, directories and aliases.
      if (
        await fs.lstat(destination).then(
          () => true,
          (error) => {
            if (!isMissing(error)) throw error;
            return false;
          },
        )
      )
        throw Error(
          t('移動先には既にファイルがあります。', 'A file already exists at the destination.'),
        );
      for (const asset of assets) {
        const oldRel = path.posix.join(from, asset);
        const newRel = path.posix.join(to, asset);
        await this.noteDirectory(ref.scopeId, path.posix.dirname(oldRel));
        const oldFile = await this.resolve(ref.scopeId, oldRel);
        const stat = await fs.lstat(path.join(this.get(ref.scopeId).root, oldRel));
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 20 * 1024 * 1024)
          throw Error(t('画像ファイルを確認してください。', 'Check the image file.'));
        const bytes = await fs.readFile(oldFile);
        if (hash(bytes) !== path.posix.basename(asset).slice(6, 70))
          throw Error(t('ノートの画像が変更されています。', "The note's image has changed."));
        await this.noteDirectory(ref.scopeId, path.posix.dirname(newRel), true);
        const newFile = path.join(this.get(ref.scopeId).root, newRel);
        try {
          await fs.writeFile(newFile, bytes, { flag: 'wx' });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          const existing = await fs.lstat(newFile);
          if (
            !existing.isFile() ||
            existing.isSymbolicLink() ||
            hash(await fs.readFile(newFile)) !== hash(bytes)
          )
            throw Error(
              t(
                '移動先の画像と内容が一致しません。',
                'The image at the destination has different contents.',
              ),
            );
        }
      }
      await this.existingNote(ref);
      await this.noteDirectory(ref.scopeId, to === '.' ? '' : to);
      // Flush copied bytes before removing the source. Directory-entry durability
      // still depends on the host filesystem; this is not a power-loss transaction.
      await writeExclusive(destination, source.doc.text, source.stat.mode);
      const latest = await this.existingNote(ref);
      if (latest.stat.ino !== source.stat.ino || hash(await fs.readFile(destination)) !== ref.hash)
        throw Error(
          t(
            'CONFLICT: 移動中にノートが変更されました。',
            'CONFLICT: The note changed during the move.',
          ),
        );
      await fs.unlink(source.filename);
      return this.read(ref.scopeId, destinationPath);
    });
  }
  private trashPath(id: string) {
    z.uuid().parse(id);
    return path.join(this.dataDir, 'note-trash', `${id}.json`);
  }
  private async trashRecord(id: string) {
    if ((await fs.stat(this.trashPath(id))).size > 16 * 1024 * 1024)
      throw Error(
        t('削除したノートの記録が大きすぎます。', 'The record of the deleted note is too large.'),
      );
    const value = JSON.parse(await fs.readFile(this.trashPath(id), 'utf8'));
    const record = trashedNote
      .extend({
        text: z.string().max(textFileByteLimit),
        restored: z.boolean(),
        checkoutRootHash: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .parse(value);
    if (record.id !== id || hash(record.text) !== record.hash)
      throw Error(
        t(
          '削除したノートの保存内容が一致しません。',
          'The saved contents of the deleted note do not match.',
        ),
      );
    return record;
  }
  async trashNote(ref: NoteRef): Promise<TrashedNote> {
    return this.queue.run(async () => {
      const source = await this.existingNote(ref);
      const record = {
        ...noteRef.parse(ref),
        id: randomUUID(),
        deletedAt: new Date().toISOString(),
        text: source.doc.text,
        restored: false,
        checkoutRootHash: hash(this.get(ref.scopeId).root),
      };
      // Retain bytes first. A failure or interruption never removes the recovery copy.
      await writeLocalJson(this.trashPath(record.id), record);
      const latest = await this.existingNote(ref);
      if (latest.stat.ino !== source.stat.ino)
        throw Error(
          t('CONFLICT: ノートが置き換えられています。', 'CONFLICT: The note has been replaced.'),
        );
      await fs.unlink(source.filename);
      return trashedNote.parse(record);
    });
  }
  async trashedNotes(scopeId: string): Promise<TrashedNote[]> {
    this.get(scopeId);
    const names = await fs.readdir(path.join(this.dataDir, 'note-trash')).catch((error) => {
      if (!isMissing(error)) throw error;
      return [];
    });
    const result: TrashedNote[] = [];
    for (const name of names) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      const record = await this.trashRecord(name.slice(0, -5));
      if (
        record.scopeId === scopeId &&
        record.checkoutRootHash === hash(this.get(scopeId).root) &&
        !record.restored
      )
        result.push(trashedNote.parse(record));
    }
    return result.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  }
  async restoreNote(scopeId: string, trashId: string): Promise<Document & { notice?: string }> {
    return this.queue.run(async () => {
      const record = await this.trashRecord(trashId);
      if (
        record.scopeId !== scopeId ||
        record.checkoutRootHash !== hash(this.get(scopeId).root) ||
        record.restored
      )
        throw Error(t('復元するノートを確認してください。', 'Check the note to restore.'));
      const destination = this.noteLocation(scopeId, record.path);
      const directory = path.posix.dirname(record.path);
      await this.noteDirectory(scopeId, directory === '.' ? '' : directory, true);
      await writeExclusive(destination, record.text);
      const doc = await this.read(scopeId, record.path);
      try {
        await writeLocalJson(this.trashPath(trashId), { ...record, restored: true });
        return doc;
      } catch {
        return {
          ...doc,
          notice: t(
            'ノートは復元しましたが、削除済み一覧を更新できませんでした。再度の復元は不要です。',
            'The note was restored, but the list of deleted notes could not be updated. No need to restore it again.',
          ),
        };
      }
    });
  }
}

/**
 * Whether a folder irori registers for the first time keeps its OKF bundle at
 * its root (ADR 035): no `Knowledge_Base/`, and a root `index.md` whose
 * frontmatter names `okf_version`, as irori-templete lays a knowledge base out.
 */
async function bundleAtRoot(root: string) {
  try {
    if (await fs.lstat(path.join(root, defaultKnowledgeFolder)).then(Boolean, () => false))
      return false;
    const index = path.join(root, 'index.md');
    const stat = await fs.lstat(index);
    if (!stat.isFile() || stat.size > textFileByteLimit) return false;
    const block = frontmatterBlock(await fs.readFile(index, 'utf8'));
    return block !== undefined && /^okf_version[ \t]*:/m.test(block);
  } catch {
    return false;
  }
}
