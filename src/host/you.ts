import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { t } from '../domain/i18n';
import {
  sharedSchemaFolder,
  subAgentDefinition,
  subAgentFiles,
  type BrainAgent,
  type SubAgentCli,
  type YourAi,
  type YourAiEntry,
} from '../domain/you';
import { iroriAgentSkills, yourAiStarter, type SharedSchemaPrompt } from '../../prompts';
import { instructionsFile } from '../domain/schema-settings';
import type { AgentSkill } from '../domain/skills';
import { readTextDocument } from './files';
import { readLocalJson, writeLocalJson } from './local-json';
import type { SchemaFolder } from './schema-folder';
import { findSkill, readFolderSkills } from './skills';

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

/** Shared instructions longer than this are read from their file, not sent with each request. */
const sharedInline = 32 * 1024;

/** Where a standard skill's package is in the irori agent's folder. */
const standardSkill = (name: string) => `.agents/skills/${name}`;

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
    const missingSkills: string[] = [];
    if (ready)
      for (const name of Object.keys(iroriAgentSkills))
        if (!(await fs.lstat(path.join(root, standardSkill(name))).catch(() => undefined)))
          missingSkills.push(name);
    return { id, root, state: ready ? 'ready' : 'missing', missingSkills };
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
    await this.writeSkills();
    return this.status();
  }
  /**
   * Writes each standard skill whose folder is absent, for a folder set up
   * before irori had them. A present folder is left as it is, edited, retired
   * or emptied, and the person's own skills are never touched.
   */
  async addStandardSkills(): Promise<YourAi> {
    if ((await this.status()).state !== 'ready')
      throw Error(t('irori agent を用意してください。', 'Set up the irori agent first.'));
    await this.writeSkills();
    return this.status();
  }
  private async writeSkills() {
    const { root } = await this.load();
    for (const [name, text] of Object.entries(iroriAgentSkills)) {
      const rel = standardSkill(name);
      if (await fs.lstat(path.join(root, rel)).catch(() => undefined)) continue;
      await this.folders(`${rel}/SKILL.md`);
      await fs.writeFile(path.join(root, rel, 'SKILL.md'), text, { flag: 'wx' });
    }
  }
  /**
   * Makes the folders on the way to `rel` inside the irori agent's folder; a
   * link or a file in their place stops the write.
   */
  private async folders(rel: string) {
    const { root } = await this.load();
    relative.parse(rel);
    let dir = root;
    for (const part of rel.split('/').slice(0, -1)) {
      dir = path.join(dir, part);
      const stat = await fs.lstat(dir).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      });
      if (!stat) await fs.mkdir(dir);
      else if (!stat.isDirectory())
        throw Error(`${dir} is not a folder inside the irori agent’s folder`);
    }
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
  /**
   * The shared Schema as the settings see it (ADR 027): its own folder inside
   * the irori agent's, made when first asked for, with the same confinement.
   * Only instructions at its root and skill packages are settings there.
   */
  async sharedFolder(): Promise<SchemaFolder> {
    if ((await this.status()).state !== 'ready')
      throw Error(t('irori agent を用意してください。', 'Set up the irori agent first.'));
    await this.folders(`${sharedSchemaFolder}/${instructionsFile}`);
    return this.sharedSchema();
  }
  /** The shared Schema's folder without making it; reading a missing one finds nothing. */
  private async sharedSchema(): Promise<SchemaFolder> {
    const inside = (rel: string) => (rel ? `${sharedSchemaFolder}/${rel}` : sharedSchemaFolder);
    const root = path.join(await fs.realpath((await this.load()).root), sharedSchemaFolder);
    const resolve = async (rel: string) => {
      const actual = await this.resolve(inside(rel));
      if (!within(root, actual)) throw Error('Path alias leaves the shared Schema');
      return actual;
    };
    return {
      root,
      knowledge: false,
      settings: ['instructions', 'skill'],
      layer: () => 'schema',
      entries: async (rel) => {
        await resolve(rel);
        return (await this.listing(inside(rel))).map(({ link, path: entry, ...rest }) => ({
          ...rest,
          path: entry.slice(sharedSchemaFolder.length + 1),
          blocked: link ? t('リンクは開けません', 'Links cannot be opened') : undefined,
        }));
      },
      resolve,
      read: async (rel) => {
        const { id } = await this.load();
        return (await readTextDocument(await resolve(rel), id, rel)).text;
      },
    };
  }
  /**
   * The shared Schema as agents are told it, or undefined when the irori agent
   * is not set up or the shared Schema holds neither instructions nor skills.
   */
  async shared(): Promise<SharedSchemaPrompt | undefined> {
    if ((await this.status()).state !== 'ready') return undefined;
    const folder = await this.sharedSchema();
    const missing = (error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return undefined;
    };
    const text = (await folder.read(instructionsFile).catch(missing))?.trim();
    const skills = (await readFolderSkills(folder).catch(missing))?.skills ?? [];
    if (!text && !skills.length) return undefined;
    const long = !!text && Buffer.byteLength(text, 'utf8') > sharedInline;
    return {
      root: folder.root,
      file: path.join(folder.root, instructionsFile),
      ...(text && !long && { instructions: text }),
      ...(long && { long }),
      skills: skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        path: path.join(folder.root, skill.path),
      })),
    };
  }
  /** A shared skill by name, for a request that picked one its own Schema lacks. */
  async sharedSkill(name: string): Promise<AgentSkill | undefined> {
    if ((await this.status()).state !== 'ready') return undefined;
    const folder = await this.sharedSchema();
    const skill = await findSkill(folder, name).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    });
    return skill && { ...skill, path: path.join(folder.root, skill.path), shared: true };
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
    const shared = path.join(root, sharedSchemaFolder);
    const written: string[] = [];
    for (const brain of brains) {
      const rel = subAgentFiles[cli](brain.agent);
      await this.folders(rel);
      try {
        await fs.writeFile(path.join(root, rel), subAgentDefinition(cli, brain, shared), {
          flag: 'wx',
        });
        written.push(rel);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    return written;
  }
}
