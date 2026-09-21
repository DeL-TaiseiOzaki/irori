import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { SerialQueue } from './serial-queue';
import { writeLocalFile, writeLocalJson } from './local-json';
import { classify, owner, within } from '../domain/scopes';
import type { Category, Document, Entry, Space } from '../domain/types';
import {
  imagesForNoteMove,
  noteFilename,
  noteRef,
  trashedNote,
  type NoteRef,
  type TrashedNote,
} from '../domain/note-operations';
import { defaultNoteDirectory } from '../domain/notes';
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
  category: z.enum(['personal', 'team', 'organization']),
  contents: z.array(relative).min(1),
});
export const hash = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
export const textFilePattern = /\.(md|txt|csv|json|ya?ml|toml|ts|js|css)$/i;
export async function readTextDocument(
  filename: string,
  scopeId: string,
  rel: string,
): Promise<Document> {
  if (!textFilePattern.test(rel)) throw Error('Use the external application for this file format');
  if ((await fs.stat(filename)).size > 2 * 1024 * 1024)
    throw Error('The text editor supports files up to 2 MiB');
  const bytes = await fs.readFile(filename);
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  if (text.includes('\0')) throw Error('Binary files cannot be edited as text');
  return { scopeId, path: rel, text, hash: hash(bytes) };
}
export class FileService {
  cloud?: {
    resolve(scopeId: string, rel: string): Promise<string>;
    rootEntries(scopeId: string, rel: string): Promise<Entry[] | undefined>;
    isWorkspacePath?(root: string): Promise<boolean>;
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
            ? '接続未検証・ローカル保存先としては使用できません'
            : f.isSymbolicLink()
              ? 'リンク先はこの版では開けません'
              : undefined,
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
            blocked: this.cloud ? undefined : '未接続',
          });
    return out.sort(
      (a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name),
    );
  }
  async read(id: string, rel: string): Promise<Document> {
    const filename = await this.resolve(id, rel);
    const doc = await readTextDocument(filename, id, rel);
    if (classify(this.get(id), rel) === 'contents') return { ...doc, readOnly: true };
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
    return path.join(this.dataDir, `draft-${hash(doc.scopeId + '\0' + doc.path)}.json`);
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
      if (classify(this.get(doc.scopeId), doc.path) === 'contents')
        throw Error('このクラウド接続は読み取り専用です。');
      await this.writeDraft(doc);
      const filename = await this.resolve(doc.scopeId, doc.path);
      const before = await fs.readFile(filename);
      if (hash(before) !== doc.hash)
        throw Error('CONFLICT: ディスク上の変更を確認してください。下書きは保持されています。');
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
      throw Error('同じスペースのナレッジ内にある Markdown ノートを指定してください。');
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
        throw Error('フォルダの alias / シンボリックリンクは操作できません。');
      if ((await this.resolve(id, prefix)) !== filename)
        throw Error('フォルダの alias が変更されています。');
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
      throw Error('通常の Markdown ノートを選択してください。');
    const doc = await this.read(ref.scopeId, ref.path);
    if (doc.hash !== ref.hash)
      throw Error('CONFLICT: ノートが変更されています。開き直してください。');
    if (doc.draft && doc.draft.text !== doc.text)
      throw Error('未保存の下書きを保存または解決してからノートを整理してください。');
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
  /** Moves the note's bytes as they are; `rewriting` says its links will be rewritten after. */
  async moveNote(ref: NoteRef, destinationPath: string, rewriting = false): Promise<Document> {
    return this.queue.run(async () => {
      const source = await this.existingNote(ref);
      const destination = this.noteLocation(ref.scopeId, destinationPath);
      if (ref.path === destinationPath) return source.doc;
      const from = path.posix.dirname(ref.path);
      const to = path.posix.dirname(destinationPath);
      const assets = from === to ? [] : imagesForNoteMove(source.doc.text, rewriting);
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
        throw Error('移動先には既にファイルがあります。別の名前を指定してください。');
      for (const asset of assets) {
        const oldRel = path.posix.join(from, asset);
        const newRel = path.posix.join(to, asset);
        await this.noteDirectory(ref.scopeId, path.posix.dirname(oldRel));
        const oldFile = await this.resolve(ref.scopeId, oldRel);
        const stat = await fs.lstat(path.join(this.get(ref.scopeId).root, oldRel));
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 20 * 1024 * 1024)
          throw Error('画像ファイルを確認してください。');
        const bytes = await fs.readFile(oldFile);
        if (hash(bytes) !== path.posix.basename(asset).slice(6, 70))
          throw Error('ノートの画像が変更されています。');
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
            throw Error('移動先の画像と内容が一致しません。');
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
        throw Error('CONFLICT: 移動中にノートが変更されました。両方のファイルを確認してください。');
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
      throw Error('削除したノートの記録が大きすぎます。');
    const value = JSON.parse(await fs.readFile(this.trashPath(id), 'utf8'));
    const record = trashedNote
      .extend({
        text: z.string().max(2 * 1024 * 1024),
        restored: z.boolean(),
        checkoutRootHash: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .parse(value);
    if (record.id !== id || hash(record.text) !== record.hash)
      throw Error('削除したノートの保存内容が一致しません。');
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
        throw Error('CONFLICT: ノートが置き換えられています。');
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
        throw Error('復元するノートを確認してください。');
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
          notice:
            'ノートは復元しましたが、削除済み一覧の更新に失敗しました。このノートを再度復元する必要はありません。',
        };
      }
    });
  }
}
