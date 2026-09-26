import { promises as fs } from 'node:fs';
import path from 'node:path';
import { rewriteNoteReferences } from './note-references';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { SerialQueue } from './serial-queue';
import writeFileAtomic from 'write-file-atomic';
import { writeLocalFile, writeLocalJson } from './local-json';
import { classify, owner, within } from '../domain/scopes';
import type { Category, Document, Entry, Space, SpaceChange } from '../domain/types';
import { brainLook, iconImagePath } from '../domain/brains';
import {
  imagesForNoteMove,
  noteFilename,
  noteRef,
  trashedNote,
  type NoteRef,
  type TrashedNote,
} from '../domain/note-operations';
import { defaultNoteDirectory } from '../domain/notes';
import { t } from '../domain/i18n';
import { textFilePattern, viewerByteLimit, viewerKind } from '../domain/viewers';
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
  category: z.enum(['personal', 'team', 'organization']).optional(),
  contents: z.array(relative).min(1),
  appearance: brainLook.optional(),
});
export const hash = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
/** Where the unsaved text of one document is kept on this device. */
export const draftFile = (dataDir: string, scopeId: string, rel: string) =>
  path.join(dataDir, `draft-${hash(scopeId + '\0' + rel)}.json`);
export { textFilePattern };
export const textFileByteLimit = 2 * 1024 * 1024;
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
export class FileService {
  cloud?: {
    resolve(scopeId: string, rel: string): Promise<string>;
    rootEntries(scopeId: string, rel: string): Promise<Entry[] | undefined>;
    isWorkspacePath?(root: string): Promise<boolean>;
    /** A Drive file with its editability and kept draft. */
    document?(scopeId: string, rel: string): Promise<Document>;
    /** Writes an edited Drive file in place, hash checked. */
    write?(doc: Document): Promise<void>;
    writable?(scopeId: string, rel: string): boolean;
  };
  private spaces: Space[] = [];
  private bindings: { root: string; scopeId: string }[] = [];
  private queue = new SerialQueue();
  constructor(readonly dataDir: string) {}
  async init() {
    await fs.mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    try {
      const bindings = z
        .array(z.object({ root: z.string(), scopeId: z.uuid() }))
        .parse(JSON.parse(await fs.readFile(path.join(this.dataDir, 'spaces.json'), 'utf8')));
      this.bindings = bindings;
      for (const b of bindings) {
        try {
          const s = await this.inspect(b.root);
          if (s.scopeId !== b.scopeId) throw Error('Scope identity changed');
          await this.validateRoot(s);
          this.spaces.push(s);
        } catch (error) {
          console.warn('Space unavailable:', b.root, String(error));
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
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
  private async validateRoot(candidate: Space) {
    if (await this.cloud?.isWorkspacePath?.(candidate.root))
      throw Error('A KB cannot be registered inside workspace cloud storage');
    for (const s of this.spaces) {
      if (s.root === candidate.root || s.scopeId === candidate.scopeId)
        throw Error('This space or identity is already registered');
      if (
        (await this.contentsPaths(s)).some((c) => within(c, candidate.root)) ||
        (await this.contentsPaths(candidate)).some((c) => within(c, s.root))
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
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        s = {
          ...declaration.parse({
            schemaVersion: 1,
            scopeId: randomUUID(),
            name,
            category,
            contents: ['contents'],
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
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        }
        const before = await fs.readFile(ignore, 'utf8').catch((e) => {
          if (e.code === 'ENOENT') return '';
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
      const next: Space = { ...declaration.parse(raw), root: s.root };
      // A file of the KB keeps its own mode; only device records are made private.
      await writeFileAtomic(meta, JSON.stringify(raw, null, 2) + '\n');
      this.spaces = this.spaces.map((item) => (item.scopeId === id ? next : item));
      // Only the icon the declaration names stays beside it.
      const icon = next.appearance?.icon?.kind === 'image' ? next.appearance.icon.path : '';
      for (const name of await fs.readdir(path.dirname(meta)))
        if (iconImagePath.test(`.irori/${name}`) && `.irori/${name}` !== icon)
          await fs.rm(path.join(path.dirname(meta), name), { force: true });
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
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
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
      if (Buffer.byteLength(doc.text, 'utf8') > textFileByteLimit)
        throw Error('The text editor supports files up to 2 MiB');
      if (doc.text.includes('\0')) throw Error('Binary files cannot be edited as text');
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
            'CONFLICT: ディスク上の変更を確認してください。下書きは保持されています。',
            'CONFLICT: Check the changes on disk. Your draft is kept.',
          ),
        );
      if (hash(doc.text) !== doc.hash) {
        // Retain the previous observed version against a racing external writer.
        await writeLocalFile(
          path.join(this.dataDir, `backup-${hash(before)}.txt`),
          before.toString('utf8'),
        );
        const mode = (await fs.stat(filename)).mode;
        const temp = path.join(path.dirname(filename), `.irori-save-${randomUUID()}.tmp`);
        try {
          const pending = await fs.open(temp, 'wx', mode);
          try {
            await pending.writeFile(doc.text);
            await pending.sync();
          } finally {
            await pending.close();
          }
          if (hash(await fs.readFile(filename)) !== doc.hash)
            throw Error('CONFLICT: File changed during save');
          await fs.rename(temp, filename);
        } finally {
          await fs.rm(temp, { force: true });
        }
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
    let prefix = '';
    for (const part of rel.split('/').filter(Boolean)) {
      prefix = prefix ? `${prefix}/${part}` : part;
      const filename = this.noteLocation(id, prefix, true);
      let stat = await fs.lstat(filename).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT' || !create) throw error;
      });
      if (!stat) {
        await fs.mkdir(filename);
        stat = await fs.lstat(filename);
      }
      if (stat.isSymbolicLink() || !stat.isDirectory())
        throw Error(
          t(
            'フォルダの alias / シンボリックリンクは操作できません。',
            'Folder aliases and symbolic links cannot be changed.',
          ),
        );
      if ((await this.resolve(id, prefix)) !== filename)
        throw Error(t('フォルダの alias が変更されています。', 'The folder alias has changed.'));
    }
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
      throw Error(
        t(
          'CONFLICT: ノートが変更されています。開き直してください。',
          'CONFLICT: The note has changed. Open it again.',
        ),
      );
    if (doc.draft && doc.draft.text !== doc.text)
      throw Error(
        t(
          '未保存の下書きを保存または解決してからノートを整理してください。',
          'Save or resolve the unsaved draft before organizing notes.',
        ),
      );
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
   * Publishes a file irori generated in the knowledge layer — the graph index —
   * atomically: `expected` is the hash of the bytes being replaced, or null when
   * the file must not exist yet, so a file changed meanwhile is never overwritten.
   * Missing folders are created; an alias anywhere on the path is refused.
   */
  async writeGenerated(id: string, rel: string, text: string, expected: string | null) {
    return this.queue.run(async () => {
      if (Buffer.byteLength(text, 'utf8') > textFileByteLimit)
        throw Error('The text editor supports files up to 2 MiB');
      if (text.includes('\0')) throw Error('Binary files cannot be edited as text');
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
      const existing = await fs.lstat(filename).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
      if (existing && (!existing.isFile() || existing.isSymbolicLink()))
        throw Error(
          t('生成先が通常のファイルではありません。', 'The output is not an ordinary file.'),
        );
      // A previous version may have generated an oversized file. Hash it without
      // loading its bytes into memory, retaining the ordinary replacement guard.
      const currentHash = async () => {
        const digest = createHash('sha256');
        const file = await fs.open(filename, 'r');
        try {
          const before = await file.stat();
          if (!before.isFile())
            throw Error(
              t('生成先が通常のファイルではありません。', 'The output is not an ordinary file.'),
            );
          let size = 0;
          for await (const chunk of file.createReadStream({ autoClose: false, end: before.size })) {
            digest.update(chunk);
            size += chunk.length;
          }
          const after = await file.stat();
          if (
            size !== before.size ||
            after.size !== before.size ||
            after.mtimeMs !== before.mtimeMs
          )
            throw Error(
              t(
                'CONFLICT: 生成先のファイルが変更されています。',
                'CONFLICT: The output file has changed.',
              ),
            );
        } finally {
          await file.close();
        }
        return digest.digest('hex');
      };
      if (expected === null) {
        if (existing)
          throw Error(
            t(
              'CONFLICT: 生成先にファイルが作られています。',
              'CONFLICT: A file was created at the output location.',
            ),
          );
        const created = await fs.open(filename, 'wx');
        try {
          await created.writeFile(text);
          await created.sync();
        } finally {
          await created.close();
        }
      } else {
        if (!existing || (await currentHash()) !== expected)
          throw Error(
            t(
              'CONFLICT: 生成先のファイルが変更されています。',
              'CONFLICT: The output file has changed.',
            ),
          );
        const temp = path.join(parent, `.irori-save-${randomUUID()}.tmp`);
        try {
          const pending = await fs.open(temp, 'wx', existing.mode);
          try {
            await pending.writeFile(text);
            await pending.sync();
          } finally {
            await pending.close();
          }
          if ((await currentHash()) !== expected)
            throw Error(
              t(
                'CONFLICT: 生成先のファイルが変更されています。',
                'CONFLICT: The output file has changed.',
              ),
            );
          await fs.rename(temp, filename);
        } finally {
          await fs.rm(temp, { force: true });
        }
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
        );
        if (!rewriting && references.links)
          throw Error(
            t(
              '相対参照を含むノートを移動するには「リンクも更新する」を有効にしてください。',
              'To move a note with relative references, turn on "Also update links".',
            ),
          );
      }
      await this.noteDirectory(ref.scopeId, to === '.' ? '' : to);
      // Exclusive publication must reject existing files, directories and aliases.
      if (
        await fs.lstat(destination).then(
          () => true,
          (error: NodeJS.ErrnoException) => {
            if (error.code !== 'ENOENT') throw error;
            return false;
          },
        )
      )
        throw Error(
          t(
            '移動先には既にファイルがあります。別の名前を指定してください。',
            'A file already exists at the destination. Choose another name.',
          ),
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
      const copied = await fs.open(destination, 'wx', source.stat.mode);
      try {
        await copied.writeFile(source.doc.text);
        await copied.sync();
      } finally {
        await copied.close();
      }
      const latest = await this.existingNote(ref);
      if (latest.stat.ino !== source.stat.ino || hash(await fs.readFile(destination)) !== ref.hash)
        throw Error(
          t(
            'CONFLICT: 移動中にノートが変更されました。両方のファイルを確認してください。',
            'CONFLICT: The note changed during the move. Check both files.',
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
        text: z.string().max(2 * 1024 * 1024),
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
    const names = await fs
      .readdir(path.join(this.dataDir, 'note-trash'))
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
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
      const restored = await fs.open(destination, 'wx');
      try {
        await restored.writeFile(record.text);
        await restored.sync();
      } finally {
        await restored.close();
      }
      const doc = await this.read(scopeId, record.path);
      try {
        await writeLocalJson(this.trashPath(trashId), { ...record, restored: true });
        return doc;
      } catch {
        return {
          ...doc,
          notice: t(
            'ノートは復元しましたが、削除済み一覧の更新に失敗しました。このノートを再度復元する必要はありません。',
            'The note was restored, but the list of deleted notes could not be updated. You do not need to restore this note again.',
          ),
        };
      }
    });
  }
}
