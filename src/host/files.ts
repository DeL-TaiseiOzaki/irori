import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { classify, owner, within } from '../domain/scopes';
import type { Category, Document, Entry, Space } from '../domain/types';
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
export class FileService {
  cloud?: {
    resolve(scopeId: string, rel: string): Promise<string>;
    rootEntries(scopeId: string, rel: string): Promise<Entry[] | undefined>;
  };
  private spaces: Space[] = [];
  private bindings: { root: string; scopeId: string }[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly dataDir: string) {}
  private serialized<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn);
    this.queue = next.catch(() => {});
    return next;
  }
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
    return this.serialized(async () => {
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
      await this.atomic(
        path.join(this.dataDir, 'spaces.json'),
        JSON.stringify(this.bindings, null, 2),
      );
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
    if (!/\.(md|txt|csv|json|ya?ml|toml|ts|js|css)$/i.test(rel))
      throw Error('Use the external application for this file format');
    if ((await fs.stat(filename)).size > 2 * 1024 * 1024)
      throw Error('The text editor supports files up to 2 MiB');
    const bytes = await fs.readFile(filename);
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (text.includes('\0')) throw Error('Binary files cannot be edited as text');
    const doc: Document = { scopeId: id, path: rel, text, hash: hash(bytes) };
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
    return this.serialized(() => this.writeDraft(doc));
  }
  private async writeDraft(doc: Document) {
    this.get(doc.scopeId);
    relative.parse(doc.path);
    await this.atomic(this.draftPath(doc), JSON.stringify({ text: doc.text, baseHash: doc.hash }));
  }
  private async atomic(filename: string, text: string) {
    const temp = `${filename}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, text, { mode: 0o600, flag: 'wx' });
      await fs.rename(temp, filename);
    } finally {
      await fs.rm(temp, { force: true });
    }
  }
  async save(doc: Document): Promise<Document> {
    return this.serialized(async () => {
      if (classify(this.get(doc.scopeId), doc.path) === 'contents')
        throw Error('このクラウド接続は読み取り専用です。');
      await this.writeDraft(doc);
      const filename = await this.resolve(doc.scopeId, doc.path);
      const before = await fs.readFile(filename);
      if (hash(before) !== doc.hash)
        throw Error('CONFLICT: ディスク上の変更を確認してください。下書きは保持されています。');
      if (hash(doc.text) !== doc.hash) {
        // Retain the previous observed version against a racing external writer.
        await this.atomic(
          path.join(this.dataDir, `backup-${hash(before)}.txt`),
          before.toString('utf8'),
        );
        const mode = (await fs.stat(filename)).mode;
        const temp = path.join(path.dirname(filename), `.irori-save-${randomUUID()}.tmp`);
        try {
          await fs.writeFile(temp, doc.text, { mode, flag: 'wx' });
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
  async createNote(id: string, name: string) {
    if (!name.trim() || /[\\/:*?"<>|]/.test(name) || name.startsWith('.'))
      throw Error('Choose a simple note name');
    const s = this.get(id);
    const rel = `Knowledge_Base/Notes/${name.replace(/\.md$/i, '')}.md`;
    // Validate every existing ancestor before mkdir can follow a symlink.
    for (const dir of ['Knowledge_Base', 'Knowledge_Base/Notes']) {
      try {
        await this.resolve(id, dir);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        await fs.mkdir(path.join(s.root, dir));
        await this.resolve(id, dir);
      }
    }
    await fs.writeFile(path.join(s.root, rel), `# ${name.replace(/\.md$/i, '')}\n\n`, {
      flag: 'wx',
    });
    return this.read(id, rel);
  }
}
