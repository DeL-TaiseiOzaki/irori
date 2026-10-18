import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { t } from '../domain/i18n';
import {
  sharedSchemaFolder,
  type IroriAgentFolder,
  type YourAi,
  type YourAiEntry,
} from '../domain/you';
import { iroriAgentSkills, yourAiStarter, type SharedSchemaPrompt } from '../../prompts';
import { within } from '../domain/scopes';
import {
  claudeSettingsFile,
  instructionsFile,
  readHooks,
  ruleFileName,
  rulesRoot,
} from '../domain/schema-settings';
import type { AgentSkill } from '../domain/skills';
import { readTextDocument } from './files';
import { ifPresent, isMissing, readLocalJson, writeLocalJson } from './local-json';
import type { SchemaFolder } from './schema-folder';
import { findSkill, readFolderSkills } from './skills';

const record = z
  .object({ schemaVersion: z.literal(1), id: z.uuid(), root: z.string().min(1) })
  .strict();
/** The folder each workspace chose for the irori agent, by workspace id (ADR 044). */
const chosenFolders = z.record(z.uuid(), z.string().min(1));
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

/** Shared instructions and rules longer than this are read from their files, not sent with each request. */
const sharedInline = 32 * 1024;

/** Where a standard skill's package is in the irori agent's folder. */
const standardSkill = (name: string) => `.agents/skills/${name}`;

/**
 * Your AI's folder on this device. Its record (an id and the default folder)
 * lives in irori's data directory, not in any KB; the default folder is
 * `~/irori/you` unless the record says otherwise. A workspace may choose
 * another folder for the irori agent (ADR 044): its runs, its Schema and the
 * screens shown while that workspace is open use it. The shared Schema, the
 * irori agent's routines and the saved environment stay in the default folder.
 * irori writes a starter only when the person asks, and only into an absent or
 * empty folder.
 */
export class YourAiService {
  private value?: z.infer<typeof record>;
  private chosen: Record<string, string> = {};
  /** The workspace open in the window: the screens and the terminal use its folder. */
  private shown?: string;
  constructor(
    private dataDir: string,
    private home = os.homedir(),
  ) {}
  private get filename() {
    return path.join(this.dataDir, 'your-ai.json');
  }
  private get choicesFile() {
    return path.join(this.dataDir, 'irori-agent-folders.json');
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
    const choices = chosenFolders.safeParse(
      await readLocalJson(this.choicesFile, {}).catch(() => ({})),
    );
    this.chosen = choices.success ? choices.data : {};
    this.value = value;
    return value;
  }
  /** Which workspace the window shows, for the folder the screens and the terminal use. */
  show(workspaceId: string | null) {
    this.shown = workspaceId ?? undefined;
  }
  /**
   * The irori agent's folder for a workspace, the one on show without one. A
   * chosen folder that is not there, such as one on a drive not mounted yet,
   * gives way to the default meanwhile, as a vault's work folder does.
   */
  folderOf(workspaceId = this.shown): IroriAgentFolder {
    const fallback = this.value?.root ?? path.join(this.home, 'irori', 'you');
    const chosen = workspaceId ? this.chosen[workspaceId] : undefined;
    if (!chosen) return { path: fallback, chosen: false };
    let there = false;
    try {
      there = statSync(chosen).isDirectory();
    } catch {
      /* not there */
    }
    return there
      ? { path: chosen, chosen: true }
      : { path: fallback, chosen: true, missing: chosen };
  }
  /**
   * Your AI's folder when `scopeId` is its id, for `workspaceId` or the workspace
   * on show; the agent service asks once the record is loaded.
   */
  rootOf(scopeId: string, workspaceId?: string) {
    return this.value?.id === scopeId ? this.folderOf(workspaceId).path : undefined;
  }
  /** The folder the record names: the shared Schema, routines and the environment live there. */
  private async defaultFolder() {
    return (await this.load()).root;
  }
  private async root(workspaceId?: string) {
    await this.load();
    return this.folderOf(workspaceId).path;
  }
  /**
   * Chooses the irori agent's folder for a workspace, or the default again with
   * `null` or the default itself. It must be a folder that exists, apart from
   * every vault, irori's data and any other irori agent folder (a folder inside
   * another would read that one's instructions too). Nothing is made or moved.
   */
  async choose(workspaceId: string, chosen: string | null, vaultRoots: string[]) {
    const fallback = await this.defaultFolder();
    const records = { ...this.chosen };
    const missing = () => Error(t('フォルダが見つかりません。', 'The folder was not found.'));
    let target: string | undefined;
    if (chosen !== null) {
      if (!path.isAbsolute(chosen)) throw missing();
      target = await fs.realpath(chosen).catch(() => {
        throw missing();
      });
      if (!(await fs.stat(target)).isDirectory()) throw missing();
    }
    const real = async (folder: string) => fs.realpath(folder).catch(() => folder);
    if (target === undefined || target === (await real(fallback))) delete records[workspaceId];
    else {
      const refuse = () =>
        Error(
          t(
            'irori agent のフォルダには、vault や irori のデータ、ほかの irori agent のフォルダと重なるフォルダは選べません。',
            "The irori agent's folder cannot overlap a vault, irori's data or another irori agent folder.",
          ),
        );
      const overlaps = (folder: string) => within(folder, target!) || within(target!, folder);
      if (overlaps(await real(this.dataDir))) throw refuse();
      for (const root of vaultRoots) if (overlaps(await real(root))) throw refuse();
      const others = [
        fallback,
        ...Object.entries(records)
          .filter(([id]) => id !== workspaceId)
          .map(([, folder]) => folder),
      ];
      for (const other of others) {
        const folder = await real(other);
        if (folder !== target && overlaps(folder)) throw refuse();
      }
      records[workspaceId] = target;
    }
    await writeLocalJson(this.choicesFile, records);
    this.chosen = records;
    return this.folderOf(workspaceId);
  }
  async status(workspaceId?: string): Promise<YourAi> {
    const { id } = await this.load();
    const folder = this.folderOf(workspaceId);
    const root = folder.path;
    const ready = await fs
      .stat(path.join(root, 'AGENTS.md'))
      .then((stat) => stat.isFile())
      .catch(() => false);
    const missingSkills: string[] = [];
    if (ready)
      for (const name of Object.keys(iroriAgentSkills))
        if (!(await fs.lstat(path.join(root, standardSkill(name))).catch(() => undefined)))
          missingSkills.push(name);
    return {
      id,
      root,
      state: ready ? 'ready' : 'missing',
      missingSkills,
      chosen: folder.chosen,
      ...(folder.missing && { missing: folder.missing }),
    };
  }
  async create(): Promise<YourAi> {
    const current = await this.status();
    if (current.state === 'ready') return current;
    const existing = await fs.readdir(current.root).catch((error) => {
      if (isMissing(error)) return [];
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
    await this.writeSkills(current.root);
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
    await this.writeSkills(await this.root());
    return this.status();
  }
  private async writeSkills(root: string) {
    for (const [name, text] of Object.entries(iroriAgentSkills)) {
      const rel = standardSkill(name);
      if (await fs.lstat(path.join(root, rel)).catch(() => undefined)) continue;
      await this.folders(root, `${rel}/SKILL.md`);
      await fs.writeFile(path.join(root, rel, 'SKILL.md'), text, { flag: 'wx' });
    }
  }
  /**
   * Makes the folders on the way to `rel` inside an irori agent folder; a link
   * or a file in their place stops the write.
   */
  private async folders(root: string, rel: string) {
    relative.parse(rel);
    let dir = root;
    for (const part of rel.split('/').slice(0, -1)) {
      dir = path.join(dir, part);
      const stat = await fs.lstat(dir).catch((error) => {
        if (isMissing(error)) return undefined;
        throw error;
      });
      if (!stat)
        try {
          await fs.mkdir(dir);
          continue;
        } catch (error) {
          // Another run of the irori agent made it a moment ago.
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
      if (!(stat ?? (await fs.lstat(dir))).isDirectory())
        throw Error(`${dir} is not a folder inside the irori agent’s folder`);
    }
  }
  private async resolve(rel: string, root?: string) {
    root ??= await this.root();
    relative.parse(rel);
    const requested = path.resolve(root, rel);
    if (!within(root, requested)) throw Error('Path is outside the irori agent’s folder');
    const actual = await fs.realpath(requested);
    if (!within(await fs.realpath(root), actual))
      throw Error('Path alias leaves the irori agent’s folder');
    return actual;
  }
  /** One folder's entries, folders first, links marked. */
  private async listing(rel: string, root?: string) {
    const dir = await this.resolve(rel, root);
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
  async schemaFolder(workspaceId?: string): Promise<SchemaFolder> {
    const folder = await this.root(workspaceId);
    const root = await fs.realpath(folder);
    return {
      root,
      knowledge: false,
      layer: () => 'schema',
      entries: async (rel) =>
        (await this.listing(rel, folder)).map(({ link, ...entry }) => ({
          ...entry,
          blocked: link ? t('リンクは開けません', 'Links cannot be opened') : undefined,
        })),
      resolve: (rel) => this.resolve(rel, folder),
      read: async (rel) => (await this.read(rel, folder)).text,
    };
  }
  /** Whether the default folder is set up: the shared Schema is kept there. */
  private async homeReady() {
    return fs
      .stat(path.join(await this.defaultFolder(), 'AGENTS.md'))
      .then((stat) => stat.isFile())
      .catch(() => false);
  }
  /**
   * The shared Schema as the settings see it (ADR 027): its own folder inside
   * the irori agent's, made when first asked for, with the same confinement.
   * Its settings are the irori agent's: instructions at its root, skill
   * packages, rules and hooks (ADR 048).
   */
  async sharedFolder(): Promise<SchemaFolder> {
    if (!(await this.homeReady()))
      throw Error(
        t(
          '既定のフォルダで irori agent を用意してください。',
          'Set up the irori agent in its default folder first.',
        ),
      );
    await this.folders(await this.defaultFolder(), `${sharedSchemaFolder}/${instructionsFile}`);
    return this.sharedSchema();
  }
  /** The shared Schema's folder without making it; reading a missing one finds nothing. */
  private async sharedSchema(): Promise<SchemaFolder> {
    const inside = (rel: string) => (rel ? `${sharedSchemaFolder}/${rel}` : sharedSchemaFolder);
    const home = await this.defaultFolder();
    const root = path.join(await fs.realpath(home), sharedSchemaFolder);
    const resolve = async (rel: string) => {
      const actual = await this.resolve(inside(rel), home);
      if (!within(root, actual)) throw Error('Path alias leaves the shared Schema');
      return actual;
    };
    return {
      root,
      knowledge: false,
      layer: () => 'schema',
      entries: async (rel) => {
        await resolve(rel);
        return (await this.listing(inside(rel), home)).map(({ link, path: entry, ...rest }) => ({
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
   * is not set up or the shared Schema holds no instructions, rules or skills.
   * Its hooks are not words: `sharedHooks` gives them to Claude Code.
   */
  async shared(): Promise<SharedSchemaPrompt | undefined> {
    if (!(await this.homeReady())) return undefined;
    const folder = await this.sharedSchema();
    const text = (await ifPresent(folder.read(instructionsFile)))?.trim();
    const skills = (await ifPresent(readFolderSkills(folder)))?.skills ?? [];
    const rules: { file: string; text: string }[] = [];
    for (const entry of (await ifPresent(folder.entries(rulesRoot))) ?? []) {
      if (entry.directory || entry.blocked || !ruleFileName(entry.name)) continue;
      const rule = (await ifPresent(folder.read(entry.path)))?.trim();
      if (rule) rules.push({ file: path.join(folder.root, entry.path), text: rule });
    }
    rules.sort((a, b) => a.file.localeCompare(b.file));
    if (!text && !skills.length && !rules.length) return undefined;
    const long = !!text && Buffer.byteLength(text, 'utf8') > sharedInline;
    // The rules go whole while they fit beside the instructions sent; otherwise by their files.
    const room = sharedInline - (text && !long ? Buffer.byteLength(text, 'utf8') : 0);
    const inline =
      rules.reduce((size, rule) => size + Buffer.byteLength(rule.text, 'utf8'), 0) <= room;
    return {
      root: folder.root,
      file: path.join(folder.root, instructionsFile),
      ...(text && !long && { instructions: text }),
      ...(long && { long }),
      rules: rules.map((rule) => (inline ? rule : { file: rule.file })),
      skills: skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        path: path.join(folder.root, skill.path),
      })),
    };
  }
  /**
   * The shared Schema's hooks in Claude Code's settings shape, for every Claude
   * Code run beside that folder's own (ADR 048); undefined when there are none.
   * Hooks not in Claude Code's shape are refused, as the settings refuse them.
   */
  async sharedHooks(): Promise<Record<string, unknown> | undefined> {
    if (!(await this.homeReady())) return undefined;
    const folder = await this.sharedSchema();
    const text = await ifPresent(folder.read(claudeSettingsFile));
    if (!text?.trim() || !readHooks(text).length) return undefined;
    return (JSON.parse(text) as { hooks: Record<string, unknown> }).hooks;
  }
  /** A shared skill by name, for a request that picked one its own Schema lacks. */
  async sharedSkill(name: string): Promise<AgentSkill | undefined> {
    if (!(await this.homeReady())) return undefined;
    const folder = await this.sharedSchema();
    const skill = await ifPresent(findSkill(folder, name));
    return skill && { ...skill, path: path.join(folder.root, skill.path), shared: true };
  }
  async read(rel: string, root?: string) {
    const { id } = await this.load();
    const doc = await readTextDocument(await this.resolve(rel, root), id, rel);
    return { path: doc.path, text: doc.text };
  }
}
