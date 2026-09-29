import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { t } from '../domain/i18n';
import {
  subAgentDefinition,
  subAgentFiles,
  yourAiStarter,
  type BrainAgent,
  type SubAgentCli,
  type YourAi,
  type YourAiEntry,
} from '../domain/you';
import { readTextDocument } from './files';
import { readLocalJson, writeLocalJson } from './local-json';
import type { SchemaFolder } from './schema-folder';

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
        t(`${current.root} にはすでにファイルがあります。`, `${current.root} already holds files.`),
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
    if (!within(root, requested)) throw Error('Path is outside the irori agent’s folder');
    const actual = await fs.realpath(requested);
    if (!within(await fs.realpath(root), actual))
      throw Error('Path alias leaves the irori agent’s folder');
    return actual;
  }
  /** One folder's entries, folders first, links marked. */
  private async listing(rel: string) {
    const dir = await this.resolve(rel);
    const found = (await fs.readdir(dir, { withFileTypes: true })).filter(
      (entry) => !['.git', 'node_modules'].includes(entry.name),
    );
    if (found.length > 4000) throw Error('This folder exceeds the 4,000-entry limit');
    return found
      .map((entry) => ({
        path: rel ? `${rel}/${entry.name}` : entry.name,
        name: entry.name,
        directory: entry.isDirectory(),
        link: entry.isSymbolicLink(),
      }))
      .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
  }
  /** One folder's entries without links, for the Your AI screen's file view. */
  async entries(rel: string): Promise<YourAiEntry[]> {
    return (await this.listing(rel))
      .filter((entry) => !entry.link)
      .map(({ link: _, ...entry }) => entry);
  }
  /**
   * The folder as the Schema settings see it: its real path, instructions only
   * at the root, and every path confined to it with no alias leaving it.
   */
  async schemaFolder(): Promise<SchemaFolder> {
    const root = await fs.realpath((await this.load()).root);
    return {
      root,
      knowledge: false,
      layer: () => 'schema',
      entries: async (rel) =>
        (await this.listing(rel)).map(({ link, ...entry }) => ({
          ...entry,
          blocked: link ? t('リンクは開けません', 'Links cannot be opened') : undefined,
        })),
      resolve: (rel) => this.resolve(rel),
      read: async (rel) => (await this.read(rel)).text,
    };
  }
  async read(rel: string) {
    const { id } = await this.load();
    const doc = await readTextDocument(await this.resolve(rel), id, rel);
    return { path: doc.path, text: doc.text };
  }
  /** The definition files each named sub-agent has in the folder, for every CLI that loads them. */
  async definitions(agents: string[]) {
    const { root } = await this.load();
    const found = new Map<string, BrainAgent['definitions']>();
    for (const agent of agents) {
      const files: BrainAgent['definitions'] = [];
      for (const [cli, file] of Object.entries(subAgentFiles) as [
        SubAgentCli,
        (agent: string) => string,
      ][]) {
        const rel = file(agent);
        const present = await fs
          .lstat(path.join(root, rel))
          .then((stat) => stat.isFile())
          .catch(() => false);
        if (present) files.push({ cli, path: rel });
      }
      found.set(agent, files);
    }
    return found;
  }
  /**
   * Writes the definition of each brain's sub-agent for `cli` where the file is
   * absent, and returns the paths written. An existing file is never replaced:
   * the person may have edited it. Folders on the way are made inside the
   * folder only; a link or file in their place stops the write.
   */
  async writeDefinitions(cli: SubAgentCli, brains: Pick<BrainAgent, 'name' | 'agent' | 'root'>[]) {
    const { root } = await this.load();
    const written: string[] = [];
    for (const brain of brains) {
      const rel = subAgentFiles[cli](brain.agent);
      relative.parse(rel);
      const parts = rel.split('/');
      let dir = root;
      for (const part of parts.slice(0, -1)) {
        dir = path.join(dir, part);
        const stat = await fs.lstat(dir).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return undefined;
          throw error;
        });
        if (!stat) await fs.mkdir(dir);
        else if (!stat.isDirectory())
          throw Error(`${dir} is not a folder inside the irori agent’s folder`);
      }
      try {
        await fs.writeFile(path.join(root, rel), subAgentDefinition(cli, brain), { flag: 'wx' });
        written.push(rel);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    return written;
  }
}
