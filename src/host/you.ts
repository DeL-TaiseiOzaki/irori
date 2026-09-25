import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { t } from '../domain/i18n';
import { yourAiStarter, type YourAi, type YourAiEntry } from '../domain/you';
import { readTextDocument } from './files';
import { readLocalJson, writeLocalJson } from './local-json';

const record = z
  .object({ schemaVersion: z.literal(1), id: z.uuid(), root: z.string().min(1) })
  .strict();
const relative = z
  .string()
  .max(4096)
  .refine(
    (value) =>
      value === '' ||
      (!value.includes('\\') &&
        !value.includes('\0') &&
        value.split('/').every((part) => part && part !== '.' && part !== '..')),
  );

function within(root: string, file: string) {
  const rel = path.relative(root, file);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Your AI's folder on this device. Its record (an id and the folder) lives in
 * irori's data directory, not in any KB; the folder is `~/irori/you` unless the
 * record says otherwise, one per person. irori writes a starter there only when
 * the person asks, and only into an absent or empty folder.
 */
export class YourAiService {
  private value?: z.infer<typeof record>;
  constructor(
    private dataDir: string,
    private home = os.homedir(),
  ) {}
  private get filename() {
    return path.join(this.dataDir, 'your-ai.json');
  }
  /** Reads the record, making one with a new id and the default folder the first time. */
  async load() {
    if (this.value) return this.value;
    const stored = await readLocalJson(this.filename, undefined);
    const value =
      stored === undefined
        ? {
            schemaVersion: 1 as const,
            id: randomUUID(),
            root: path.join(this.home, 'irori', 'you'),
          }
        : record.parse(stored);
    if (stored === undefined) await writeLocalJson(this.filename, value);
    this.value = value;
    return value;
  }
  /** Your AI's folder when `scopeId` is its id; the agent service asks once the record is loaded. */
  rootOf(scopeId: string) {
    return this.value?.id === scopeId ? this.value.root : undefined;
  }
  async status(): Promise<YourAi> {
    const { id, root } = await this.load();
    const ready = await fs
      .stat(path.join(root, 'AGENTS.md'))
      .then((stat) => stat.isFile())
      .catch(() => false);
    return { id, root, state: ready ? 'ready' : 'missing' };
  }
  async create(): Promise<YourAi> {
    const current = await this.status();
    if (current.state === 'ready') return current;
    const existing = await fs.readdir(current.root).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    if (existing.length)
      throw Error(
        t(
          `${current.root} にはすでにファイルがあります。空のフォルダにするか、AGENTS.md を置いてください。`,
          `${current.root} already holds files. Empty it, or put an AGENTS.md there.`,
        ),
      );
    for (const [rel, text] of Object.entries(yourAiStarter)) {
      const file = path.join(current.root, rel);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, text, { flag: 'wx' });
    }
    await fs.mkdir(path.join(current.root, '.claude', 'agents'), { recursive: true });
    return this.status();
  }
  private async resolve(rel: string) {
    const { root } = await this.load();
    relative.parse(rel);
    const requested = path.resolve(root, rel);
    if (!within(root, requested)) throw Error('Path is outside your AI’s folder');
    const actual = await fs.realpath(requested);
    if (!within(await fs.realpath(root), actual)) throw Error('Path alias leaves your AI’s folder');
    return actual;
  }
  /** One folder's entries, folders first, for the read-only Your AI screen. */
  async entries(rel: string): Promise<YourAiEntry[]> {
    const dir = await this.resolve(rel);
    const found = (await fs.readdir(dir, { withFileTypes: true })).filter(
      (entry) => !['.git', 'node_modules'].includes(entry.name) && !entry.isSymbolicLink(),
    );
    if (found.length > 4000) throw Error('This folder exceeds the 4,000-entry limit');
    return found
      .map((entry) => ({
        path: rel ? `${rel}/${entry.name}` : entry.name,
        name: entry.name,
        directory: entry.isDirectory(),
      }))
      .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
  }
  async read(rel: string) {
    const { id } = await this.load();
    const doc = await readTextDocument(await this.resolve(rel), id, rel);
    return { path: doc.path, text: doc.text };
  }
  /** Which of the named sub-agents have a definition in `.claude/agents`. */
  async defined(agents: string[]) {
    const { root } = await this.load();
    const present = new Set(
      await fs.readdir(path.join(root, '.claude', 'agents')).catch(() => [] as string[]),
    );
    return new Set(agents.filter((agent) => present.has(`${agent}.md`)));
  }
}
