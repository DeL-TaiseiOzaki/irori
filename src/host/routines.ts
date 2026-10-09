import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { parseDocument } from 'yaml';
import { z } from 'zod';
import { t } from '../domain/i18n';
import { agentAccessModes, agentIds } from '../domain/types';
import type { AgentId, DeviceSettings, Space, WorkspaceProfile } from '../domain/types';
import type { GitStatus } from '../domain/git';
import { agentModel, promptLimit } from '../domain/conversation';
import { requireAgentAccess } from '../domain/agent-access';
import { within } from '../domain/scopes';
import {
  lineDiff,
  routineKey,
  secretName,
  routineRef,
  routineRunStates,
  routineStepStates,
  stepLabel,
  type Routine,
  type RoutineRef,
  type RoutineReview,
  type RoutineReviewFile,
  type RoutineRun,
  type RoutineRunState,
  type RoutineSource,
  type RoutineStep,
  type RoutineStepRun,
  type RunRoutine,
} from '../domain/routines';
import type { AgentService, StepEnd } from '../agents/service';
import { agentEnv, killTree, launch } from '../agents/process';
import { readLocalJson, writeLocalJson } from './local-json';
import { findExecutable } from './executables';
import { readWriteBack, Redactor, unavailableText, type SecretStore } from './keystore';
// Imported as sha256: several locals here are named `hash`.
import { hash as sha256, utf8Text, type FileService } from './files';
import type { YourAiService } from './you';
import { stepPreamble } from '../../prompts';

const yamlLimit = 64 * 1024;
const fileLimit = 100;
const folderLimit = 5 * 1024 * 1024;
/** The largest file the review shows as text. */
const textLimit = 256 * 1024;
/** Texts kept with a review, so the next one can show what changed. */
const keptTextLimit = 1024 * 1024;
const outputLimit = 16 * 1024;
/** The most a step may write back to `IRORI_SECRETS_OUT`. */
const writeBackLimit = 64 * 1024;
const keptRuns = 20;
const javascript = ['.js', '.mjs', '.cjs'];
/** Files the system writes into folders it shows, never run by a routine. */
const systemFiles = new Set(['.DS_Store']);

const relativeFile = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (value) =>
      !/[\\\0:]/.test(value) &&
      value.split('/').every((part) => part && part !== '.' && part !== '..'),
  );
const commandName = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => !/[\\/\0:]/.test(value) && !value.startsWith('-'));
const runStep = z
  .object({
    run: z.union([
      relativeFile,
      z
        .array(z.string().min(1).max(4000))
        .min(1)
        .max(64)
        .refine((argv) => commandName.safeParse(argv[0]).success),
    ]),
    secrets: z.array(secretName).min(1).max(20).optional(),
  })
  .strict();
const agentStep = z
  .object({
    agent: z.enum(['irori', 'hibachi']),
    hibachis: z
      .union([z.literal('all'), z.array(z.string().min(1).max(120)).min(1).max(50)])
      .optional(),
    access: z.enum(agentAccessModes),
    cli: z.enum(agentIds).optional(),
    model: agentModel.optional(),
    prompt: z
      .string()
      .max(promptLimit)
      .refine((value) => !!value.trim()),
  })
  .strict();
const routineFile = z
  .object({
    name: z.string().trim().min(1).max(120),
    steps: z.array(z.unknown()).min(1).max(20),
  })
  .strict();

/** A validation failure as one sentence; `step` counts from 1. */
function issueText(issues: z.core.$ZodIssue[], step?: number) {
  // A misspelt key also leaves the real one missing; naming the unknown one says why.
  const issue = issues.find((item) => item.code === 'unrecognized_keys') ?? issues[0];
  const key = issue.path.map(String).join('.');
  const where =
    step === undefined
      ? key
      : key
        ? t(`ステップ ${step} の ${key}`, `step ${step}'s ${key}`)
        : t(`ステップ ${step}`, `step ${step}`);
  if (issue.code === 'unrecognized_keys') {
    const keys = issue.keys.join(', ');
    return step === undefined
      ? t(
          `routine.yaml に不明なキーがあります: ${keys}`,
          `routine.yaml has an unknown key: ${keys}`,
        )
      : t(
          `ステップ ${step} に不明なキーがあります: ${keys}`,
          `Step ${step} has an unknown key: ${keys}`,
        );
  }
  if (
    (issue.code === 'invalid_type' || issue.code === 'invalid_value') &&
    issue.input === undefined
  )
    return t(`${where} がありません。`, `${where} is missing.`);
  if (issue.code === 'invalid_value')
    return t(
      `${where} は ${issue.values.join(' / ')} のどれかです。`,
      `${where} must be ${issue.values.join(' / ')}.`,
    );
  return t(`${where} が正しくありません。`, `${where} is not valid.`);
}

/**
 * Reads `routine.yaml` (ADR 016 D2). A routine in the irori agent's folder
 * instructs the irori agent; one in a hibachi instructs that hibachi's agent.
 */
export function parseRoutine(
  text: string,
  owner: Routine['owner'],
): { name: string; steps: RoutineStep[] } | { problem: string; name?: string } {
  const document = parseDocument(text, { uniqueKeys: true });
  if (document.errors.length) {
    const line = document.errors[0].linePos?.[0].line;
    return {
      problem: line
        ? t(
            `routine.yaml を読めません（${line} 行目）。`,
            `routine.yaml cannot be read (line ${line}).`,
          )
        : t('routine.yaml を読めません。', 'routine.yaml cannot be read.'),
    };
  }
  let value: unknown;
  try {
    value = document.toJS({ maxAliasCount: 50 });
  } catch {
    return { problem: t('routine.yaml を読めません。', 'routine.yaml cannot be read.') };
  }
  const top = routineFile.safeParse(value, { reportInput: true });
  if (!top.success) return { problem: issueText(top.error.issues) };
  const { name } = top.data;
  const steps: RoutineStep[] = [];
  for (const [index, raw] of top.data.steps.entries()) {
    const n = index + 1;
    const fields = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : undefined;
    if (!fields || Object.hasOwn(fields, 'run') === Object.hasOwn(fields, 'agent'))
      return {
        name,
        problem: t(
          `ステップ ${n} には run か agent のどちらかを書きます。`,
          `Step ${n} needs either run or agent.`,
        ),
      };
    if (Object.hasOwn(fields, 'run')) {
      const step = runStep.safeParse(fields, { reportInput: true });
      if (!step.success) return { name, problem: issueText(step.error.issues, n) };
      steps.push({ kind: 'run', ...step.data });
      continue;
    }
    const step = agentStep.safeParse(fields, { reportInput: true });
    if (!step.success) return { name, problem: issueText(step.error.issues, n) };
    const { agent, hibachis, access, cli } = step.data;
    if (agent !== (owner === 'irori' ? 'irori' : 'hibachi'))
      return {
        name,
        problem:
          owner === 'irori'
            ? t(
                `ステップ ${n}: irori agent のルーティンでは agent: irori を使います。`,
                `Step ${n}: an irori agent routine uses agent: irori.`,
              )
            : t(
                `ステップ ${n}: hibachi のルーティンでは agent: hibachi を使います。`,
                `Step ${n}: a hibachi's routine uses agent: hibachi.`,
              ),
      };
    if (hibachis && agent !== 'irori')
      return {
        name,
        problem: t(
          `ステップ ${n}: hibachis は agent: irori に書きます。`,
          `Step ${n}: hibachis belongs to agent: irori.`,
        ),
      };
    if (cli)
      try {
        requireAgentAccess(cli, access);
      } catch (error) {
        return { name, problem: t(`ステップ ${n}: `, `Step ${n}: `) + (error as Error).message };
      }
    steps.push({ kind: 'agent', ...step.data });
  }
  return { name, steps };
}

/** A folder name for a new routine: its name without what a file system refuses. */
export function routineFolderName(name: string) {
  const folder = name
    .normalize('NFC')
    .replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '-')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 80)
    .trim();
  if (!folder) return 'routine';
  // Windows reserves these names for devices.
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(folder) ? `${folder}-routine` : folder;
}

/** A new routine's `routine.yaml`: one agent step whose prompt the person writes. */
export function routineTemplate(name: string, owner: Routine['owner']) {
  return [
    `name: ${JSON.stringify(name)}`,
    'steps:',
    t(
      '  # プログラムを先に動かすとき: - run: fetch.js または - run: [gh, api, notifications]',
      '  # To run a program first: - run: fetch.js or - run: [gh, api, notifications]',
    ),
    `  - agent: ${owner}`,
    ...(owner === 'irori'
      ? [t('    # hibachis: all  # 渡す hibachi', '    # hibachis: all  # hibachis to hand over')]
      : []),
    '    access: default # or full-access',
    '    prompt: |',
    '',
  ].join('\n');
}

/** Whether a program's last line of standard output is `{"continue": false}`. */
export function nothingToDo(output: string) {
  const last = output.trimEnd().split('\n').at(-1)?.trim();
  if (!last?.startsWith('{')) return false;
  try {
    const value = JSON.parse(last) as unknown;
    return (
      !!value && typeof value === 'object' && (value as { continue?: unknown }).continue === false
    );
  } catch {
    return false;
  }
}

/** The reason an agent's report gives after `[FAILED]`, when it begins with it. */
export function failedReport(report: string) {
  const text = report.trimStart();
  if (!text.startsWith('[FAILED]')) return undefined;
  return (
    text.slice('[FAILED]'.length).trim().split('\n')[0].slice(0, 300) ||
    t('エージェントが失敗を報告しました。', 'The agent reported a failure.')
  );
}

/** The hibachis an irori agent step hands over, by name or all of the workspace's. */
function handed(spec: 'all' | string[] | undefined, workspace: Space[]) {
  if (!spec) return { scopeIds: [] as string[] };
  if (spec === 'all') return { scopeIds: workspace.map((space) => space.scopeId) };
  const scopeIds = new Set<string>();
  for (const name of spec) {
    const found = workspace.filter((space) => space.name === name);
    if (found.length !== 1)
      return {
        problem: found.length
          ? t(
              `「${name}」という hibachi が複数あります。`,
              `More than one hibachi is named ${name}.`,
            )
          : t(
              `hibachi「${name}」はこのワークスペースにありません。`,
              `This workspace has no hibachi named ${name}.`,
            ),
      };
    scopeIds.add(found[0].scopeId);
  }
  return { scopeIds: [...scopeIds] };
}

/** The secrets a routine's `run` steps name, each once. */
function secretsOf(steps: RoutineStep[]) {
  return [...new Set(steps.flatMap((step) => (step.kind === 'run' && step.secrets) || []))];
}

const now = () => new Date().toISOString();
const message = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(/^(?:Error: )+/, '');

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done);
  });
}

/** A file's text for the review, or undefined when it is binary or too large. */
async function readText(file: string, size: number) {
  if (size > textLimit) return undefined;
  return utf8Text(await fs.readFile(file));
}

const reviewRecord = z.object({
  schemaVersion: z.literal(1),
  owner: z.uuid(),
  folder: z.string(),
  digest: z.string(),
  reviewedAt: z.string(),
  files: z.array(
    z.object({
      path: z.string(),
      hash: z.string(),
      size: z.number(),
      text: z.string().optional(),
    }),
  ),
});
const runRecord = z.object({
  schemaVersion: z.literal(1),
  id: z.uuid(),
  routine: routineRef,
  name: z.string(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  state: z.enum(routineRunStates),
  steps: z
    .array(
      z.object({
        kind: z.enum(['run', 'agent']),
        label: z.string(),
        state: z.enum(routineStepStates),
        startedAt: z.string().optional(),
        endedAt: z.string().optional(),
        exitCode: z.number().int().nullable().optional(),
        output: z.string(),
        truncated: z.boolean().optional(),
        detail: z.string().optional(),
        conversation: z
          .object({
            scopeId: z.string(),
            agent: z.enum(agentIds),
            runId: z.string(),
            conversationId: z.uuid().optional(),
          })
          .optional(),
      }),
    )
    .max(20),
  changes: z.array(z.object({ scopeId: z.string(), name: z.string(), paths: z.array(z.string()) })),
  detail: z.string().optional(),
});

interface Owner {
  kind: Routine['owner'];
  id: string;
  name: string;
  /** The working folder: the irori agent's folder or the hibachi's root. */
  root: string;
  /** Where its routines are. */
  dir: string;
}
interface FolderFile {
  path: string;
  file: string;
  size: number;
  hash: string;
}
interface Found {
  name: string;
  path: string;
  steps: RoutineStep[];
  problem?: string;
  files?: FolderFile[];
  digest?: string;
}
interface Active {
  run: RoutineRun;
  owner: Owner;
  steps: RoutineStep[];
  workspace: Space[];
  input: RunRoutine;
  abort: AbortController;
  /** Hides the values this run handed out or got back from its record. */
  redactor: Redactor;
  finished?: Promise<void>;
  timer?: NodeJS.Timeout;
}

export interface RoutineHost {
  dataDir: string;
  files: FileService;
  you: YourAiService;
  agents: AgentService;
  workspaces: () => Promise<WorkspaceProfile[]>;
  settings: () => Promise<DeviceSettings>;
  gitStatus: (scopeId: string) => Promise<GitStatus>;
  /** The device's secrets, handed to the `run` steps that name them (D5). */
  secrets: SecretStore;
  /** Throws while Git, a save or a cloud connection keeps agents from starting. */
  canStart: () => void;
  emit: (run: RoutineRun) => void;
  /** Runs `.js` files: irori's own executable as Node. */
  runtime?: string;
}

/**
 * Routines on this device (ADR 016): discovery in the irori agent's folder and
 * the workspace's hibachis, the review of their files, runs started by the
 * person, and the record of each run. Nothing here starts a run by itself.
 */
export class RoutineService {
  private active = new Map<string, Active>();
  private starting = new Set<string>();
  private records = new Map<string, RoutineRun[]>();
  private hashes = new Map<string, { size: number; mtimeMs: number; hash: string }>();
  constructor(private host: RoutineHost) {}
  get busy() {
    return this.active.size > 0 || this.starting.size > 0;
  }
  private get dir() {
    return path.join(this.host.dataDir, 'routines');
  }
  private runsDir(key: string) {
    return path.join(this.dir, 'runs', sha256(key));
  }
  private reviewFile(key: string) {
    return path.join(this.dir, 'reviews', `${sha256(key)}.json`);
  }
  /**
   * Clears the work folders an earlier process left, and marks a run it left
   * running as unknown (D8). Such a run is never repeated.
   */
  async init() {
    await fs.rm(path.join(this.dir, 'work'), { recursive: true, force: true });
    await fs.rm(path.join(this.dir, 'out'), { recursive: true, force: true });
    const runs = path.join(this.dir, 'runs');
    for (const folder of await fs.readdir(runs).catch(() => [])) {
      for (const name of await fs.readdir(path.join(runs, folder)).catch(() => [])) {
        const file = path.join(runs, folder, name);
        const value = runRecord.safeParse(await readLocalJson(file, undefined).catch(() => 0));
        if (!value.success || value.data.state !== 'running') continue;
        value.data.state = 'unknown';
        for (const step of value.data.steps)
          if (step.state === 'running' || step.state === 'waiting') step.state = 'unknown';
        await writeLocalJson(file, value.data);
      }
    }
  }
  private async owner(id: string): Promise<Owner> {
    const you = await this.host.you.load();
    if (id === you.id)
      return {
        kind: 'irori',
        id,
        name: 'irori agent',
        root: you.root,
        dir: path.join(you.root, 'routines'),
      };
    const space = this.host.files.get(id);
    return {
      kind: 'hibachi',
      id,
      name: space.name,
      root: space.root,
      dir: path.join(space.root, '.irori', 'routines'),
    };
  }
  private async workspace(id: string) {
    const profile = (await this.host.workspaces()).find((item) => item.id === id);
    if (!profile)
      throw Error(t('ワークスペースが見つかりません。', 'The workspace was not found.'));
    const spaces = this.host.files.list();
    return profile.scopeIds.flatMap((scopeId) =>
      spaces.filter((space) => space.scopeId === scopeId),
    );
  }
  private nameOf(scopeId: string) {
    return this.host.you.rootOf(scopeId) ? 'irori agent' : this.host.files.get(scopeId).name;
  }
  /** Every file of a routine's folder with its hash, and the folder's digest (D4). */
  private async read(dir: string) {
    const files: FolderFile[] = [];
    let total = 0;
    const walk = async (rel: string, depth: number) => {
      for (const entry of await fs.readdir(path.join(dir, rel), { withFileTypes: true })) {
        if (systemFiles.has(entry.name)) continue;
        const child = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink())
          throw Error(t(`リンクは使えません: ${child}`, `Links are not allowed: ${child}`));
        if (entry.isDirectory()) {
          if (depth >= 8)
            throw Error(t('フォルダが深すぎます。', 'The folders are nested too deeply.'));
          await walk(child, depth + 1);
          continue;
        }
        if (!entry.isFile())
          throw Error(t(`ファイルではありません: ${child}`, `Not a file: ${child}`));
        const file = path.join(dir, child);
        const stat = await fs.stat(file);
        total += stat.size;
        if (files.length >= fileLimit)
          throw Error(
            t(
              `ファイルが ${fileLimit} 個を超えています。`,
              `There are more than ${fileLimit} files.`,
            ),
          );
        if (total > folderLimit)
          throw Error(t('ファイルが合計 5 MiB を超えています。', 'The files exceed 5 MiB in all.'));
        const known = this.hashes.get(file);
        const hash =
          known && known.size === stat.size && known.mtimeMs === stat.mtimeMs
            ? known.hash
            : sha256(await fs.readFile(file));
        this.hashes.set(file, { size: stat.size, mtimeMs: stat.mtimeMs, hash });
        files.push({ path: child, file, size: stat.size, hash });
      }
    };
    await walk('', 0);
    files.sort((a, b) => (a.path < b.path ? -1 : 1));
    return { files, digest: sha256(JSON.stringify(files.map((file) => [file.path, file.hash]))) };
  }
  private async inspect(owner: Owner, folder: string): Promise<Found> {
    const dir = path.join(owner.dir, folder);
    const found: Found = { name: folder, path: dir, steps: [] };
    try {
      const stat = await fs.lstat(dir);
      if (stat.isSymbolicLink())
        throw Error(t(`リンクは使えません: ${folder}`, `Links are not allowed: ${folder}`));
      if (!stat.isDirectory())
        throw Error(t('ルーティンはフォルダです。', 'A routine is a folder.'));
      if (!within(await fs.realpath(owner.root), await fs.realpath(dir)))
        throw Error(
          t('フォルダが持ち主のフォルダの外にあります。', "The folder leaves its owner's."),
        );
      const { files, digest } = await this.read(dir);
      found.files = files;
      found.digest = digest;
      const yaml = files.find((file) => file.path === 'routine.yaml');
      if (!yaml) throw Error(t('routine.yaml がありません。', 'routine.yaml is missing.'));
      if (yaml.size > yamlLimit)
        throw Error(t('routine.yaml が大きすぎます。', 'routine.yaml is too large.'));
      const parsed = parseRoutine(await fs.readFile(yaml.file, 'utf8'), owner.kind);
      if (parsed.name) found.name = parsed.name;
      if ('problem' in parsed) throw Error(parsed.problem);
      for (const step of parsed.steps) {
        if (step.kind !== 'run' || Array.isArray(step.run)) continue;
        const file = files.find((item) => item.path === step.run);
        if (!file) throw Error(t(`${step.run} がありません。`, `${step.run} is missing.`));
        // Any other file runs as a program itself, so it needs to be executable.
        const extension = path.extname(step.run).toLowerCase();
        if (
          process.platform !== 'win32' &&
          ![...javascript, '.py'].includes(extension) &&
          !((await fs.stat(file.file)).mode & 0o111)
        )
          throw Error(t(`${step.run} に実行権限がありません。`, `${step.run} is not executable.`));
      }
      found.steps = parsed.steps;
    } catch (error) {
      found.problem = message(error);
    }
    return found;
  }
  /** What the device or workspace lacks before the steps can run (D3). */
  private async needs(steps: RoutineStep[], workspace: Space[], settings: DeviceSettings) {
    const env = agentEnv();
    const named = secretsOf(steps);
    if (named.length) {
      const stored = await this.host.secrets.list();
      if (!stored.available) return { text: unavailableText() };
      const missing = named.filter((name) => !stored.names.includes(name));
      if (missing.length)
        return {
          text: t(
            `シークレット ${missing.join(', ')} がありません。`,
            `Needs the secret ${missing.join(', ')}.`,
          ),
          secrets: missing,
        };
    }
    for (const step of steps) {
      if (step.kind === 'run') {
        if (Array.isArray(step.run)) {
          if (!(await findExecutable(step.run[0], env)))
            return {
              text: t(`${step.run[0]} が見つかりません。`, `${step.run[0]} was not found.`),
            };
          continue;
        }
        const extension = path.extname(step.run).toLowerCase();
        if (javascript.includes(extension) && !settings.routineRuntimes.includes('javascript'))
          return {
            text: t('JavaScript が必要です。', 'Needs JavaScript.'),
            runtime: 'javascript' as const,
          };
        if (extension === '.py')
          return { text: t('Python はまだ使えません。', 'Python is not available yet.') };
        continue;
      }
      if (step.agent !== 'irori') continue;
      if ((await this.host.you.status()).state !== 'ready')
        return { text: t('irori agent が用意されていません。', 'The irori agent is not set up.') };
      const hibachis = handed(step.hibachis, workspace);
      if ('problem' in hibachis) return { text: hibachis.problem! };
    }
    return undefined;
  }
  private async readReview(key: string) {
    const value = reviewRecord.safeParse(
      await readLocalJson(this.reviewFile(key), undefined).catch(() => undefined),
    );
    return value.success ? value.data : undefined;
  }
  /** Keeps the files as the person confirmed them, and their text for the next review. */
  private async confirm(ref: RoutineRef, files: FolderFile[], digest: string) {
    let kept = 0;
    const recorded = [];
    for (const file of files) {
      const text =
        kept + file.size <= keptTextLimit ? await readText(file.file, file.size) : undefined;
      if (text !== undefined) kept += file.size;
      recorded.push({ path: file.path, hash: file.hash, size: file.size, text });
    }
    await writeLocalJson(this.reviewFile(routineKey(ref)), {
      schemaVersion: 1,
      ...ref,
      digest,
      reviewedAt: now(),
      files: recorded,
    });
  }
  /**
   * The irori agent's routines and those of the workspace's hibachis; with no
   * workspace, the irori agent's alone.
   */
  async list(workspaceId: string | undefined): Promise<Routine[]> {
    const workspace = workspaceId ? await this.workspace(workspaceId) : [];
    const settings = await this.host.settings();
    const owners = [await this.owner((await this.host.you.load()).id)];
    for (const space of workspace) owners.push(await this.owner(space.scopeId));
    const routines: Routine[] = [];
    for (const owner of owners) {
      const folders = await fs.readdir(owner.dir, { withFileTypes: true }).catch(() => []);
      for (const entry of folders.sort((a, b) => (a.name < b.name ? -1 : 1))) {
        if (!routineRef.shape.folder.safeParse(entry.name).success) continue;
        if (!(entry.isDirectory() || entry.isSymbolicLink())) continue;
        // A folder is a routine when it holds routine.yaml.
        const yaml = await fs.stat(path.join(owner.dir, entry.name, 'routine.yaml')).catch(() => 0);
        if (!yaml) continue;
        const ref = { owner: owner.id, folder: entry.name };
        const key = routineKey(ref);
        const found = await this.inspect(owner, entry.name);
        const reviewed = await this.readReview(key);
        const last = (await this.runs(ref))[0];
        routines.push({
          ref,
          owner: owner.kind,
          name: found.name,
          path: found.path,
          steps: found.steps,
          problem: found.problem,
          needs: found.problem ? undefined : await this.needs(found.steps, workspace, settings),
          review: !reviewed
            ? 'unreviewed'
            : reviewed.digest === found.digest
              ? 'reviewed'
              : 'changed',
          running: this.active.get(key)?.run.id,
          last: last && {
            id: last.id,
            state: last.state,
            startedAt: last.startedAt,
            endedAt: last.endedAt,
          },
        });
      }
    }
    return routines;
  }
  /**
   * Starts a routine for the person: a new folder in the owner's routines with
   * a `routine.yaml` whose prompt is still to be written, so it cannot run yet.
   * irori writes only a folder that did not exist.
   */
  async create(ownerId: string, name: string): Promise<RoutineRef> {
    const title = name.trim();
    if (!title || title.length > 120)
      throw Error(
        t('名前を 120 文字以内で入力してください。', 'Enter a name of up to 120 characters.'),
      );
    const owner = await this.owner(ownerId);
    if (owner.kind === 'irori' && (await this.host.you.status()).state !== 'ready')
      throw Error(t('irori agent が用意されていません。', 'The irori agent is not set up.'));
    await fs.mkdir(owner.dir, { recursive: true });
    if (!within(await fs.realpath(owner.root), await fs.realpath(owner.dir)))
      throw Error(
        t('フォルダが持ち主のフォルダの外にあります。', "The folder leaves its owner's."),
      );
    const base = routineFolderName(title);
    for (let n = 1; n <= 100; n++) {
      const folder = n === 1 ? base : `${base} ${n}`;
      try {
        await fs.mkdir(path.join(owner.dir, folder));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
        throw error;
      }
      await fs.writeFile(
        path.join(owner.dir, folder, 'routine.yaml'),
        routineTemplate(title, owner.kind),
        { flag: 'wx' },
      );
      return { owner: owner.id, folder };
    }
    throw Error(t('同じ名前のルーティンが多すぎます。', 'Too many routines share this name.'));
  }
  /** The routine's `routine.yaml` and its version, for the person to edit. */
  async source(ref: RoutineRef): Promise<RoutineSource> {
    const file = await this.yamlFile(ref);
    const text = await fs.readFile(file, 'utf8');
    return { text, version: sha256(text) };
  }
  /**
   * Saves the person's `routine.yaml`, unless it changed since `version` was
   * read, and returns why the routine still cannot run, if it cannot. The next
   * run is reviewed as after any change (D4).
   */
  async saveSource(ref: RoutineRef, text: string, version: string) {
    if (Buffer.byteLength(text) > yamlLimit)
      throw Error(t('routine.yaml が大きすぎます。', 'routine.yaml is too large.'));
    const key = routineKey(ref);
    if (this.active.has(key) || this.starting.has(key))
      throw Error(t('このルーティンは実行中です。', 'This routine is already running.'));
    const file = await this.yamlFile(ref);
    if (sha256(await fs.readFile(file, 'utf8')) !== version)
      throw Error(
        t(
          'routine.yaml がほかで変更されました。開き直してください。',
          'routine.yaml changed elsewhere. Open it again.',
        ),
      );
    await fs.writeFile(file, text);
    const owner = await this.owner(ref.owner);
    return { version: sha256(text), problem: (await this.inspect(owner, ref.folder)).problem };
  }
  /** The routine's `routine.yaml`, refusing a link or a folder that leaves its owner's. */
  private async yamlFile(ref: RoutineRef) {
    const owner = await this.owner(ref.owner);
    const dir = path.join(owner.dir, ref.folder);
    const file = path.join(dir, 'routine.yaml');
    const [folder, yaml] = await Promise.all([fs.lstat(dir), fs.lstat(file)]);
    if (folder.isSymbolicLink() || yaml.isSymbolicLink())
      throw Error(t('リンクは使えません。', 'Links are not allowed.'));
    if (!yaml.isFile()) throw Error(t('routine.yaml がありません。', 'routine.yaml is missing.'));
    if (!within(await fs.realpath(owner.root), await fs.realpath(dir)))
      throw Error(
        t('フォルダが持ち主のフォルダの外にあります。', "The folder leaves its owner's."),
      );
    return file;
  }
  /** The routine's files as they are now, and what changed since the person confirmed them. */
  async review(ref: RoutineRef): Promise<RoutineReview> {
    const found = await this.inspect(await this.owner(ref.owner), ref.folder);
    if (!found.files || !found.digest) throw Error(found.problem);
    const reviewed = await this.readReview(routineKey(ref));
    const before = new Map((reviewed?.files ?? []).map((file) => [file.path, file]));
    const files: RoutineReviewFile[] = [];
    for (const file of found.files) {
      const old = before.get(file.path);
      const status = !old ? 'added' : old.hash === file.hash ? 'same' : 'changed';
      const entry: RoutineReviewFile = { path: file.path, status, size: file.size };
      files.push(entry);
      if (status === 'same') continue;
      const text = await readText(file.file, file.size);
      if (text === undefined) entry.opaque = true;
      else if (old?.text !== undefined) entry.diff = lineDiff(old.text, text);
      else entry.text = text;
    }
    for (const old of reviewed?.files ?? [])
      if (!found.files.some((file) => file.path === old.path))
        files.push({ path: old.path, status: 'removed', size: old.size });
    files.sort((a, b) =>
      a.path === 'routine.yaml' ? -1 : b.path === 'routine.yaml' ? 1 : a.path < b.path ? -1 : 1,
    );
    return {
      ref,
      name: found.name,
      path: found.path,
      digest: found.digest,
      confirmedBefore: !!reviewed,
      files,
      secrets: secretsOf(found.steps),
      problem: found.problem,
    };
  }
  /**
   * Starts a routine the person asked to run (D6). A routine whose files differ
   * from what the person confirmed runs only with `digest` of the files as they
   * are now, which the review showed.
   */
  async run(ref: RoutineRef, input: RunRoutine): Promise<string> {
    const key = routineKey(ref);
    if (this.active.has(key) || this.starting.has(key))
      throw Error(t('このルーティンは実行中です。', 'This routine is already running.'));
    this.starting.add(key);
    try {
      const owner = await this.owner(ref.owner);
      const workspace = await this.workspace(input.workspaceId);
      const found = await this.inspect(owner, ref.folder);
      if (found.problem || !found.files || !found.digest) throw Error(found.problem);
      const needs = await this.needs(found.steps, workspace, await this.host.settings());
      if (needs) throw Error(needs.text);
      const reviewed = await this.readReview(key);
      if (reviewed?.digest !== found.digest) {
        if (input.digest !== found.digest)
          throw Error(
            reviewed
              ? t(
                  'ルーティンが変わりました。確認し直してください。',
                  'The routine has changed. Review it again.',
                )
              : t(
                  'ルーティンを確認してから実行してください。',
                  'Review the routine before running it.',
                ),
          );
        await this.confirm(ref, found.files, found.digest);
      }
      const run: RoutineRun = {
        id: randomUUID(),
        routine: ref,
        name: found.name,
        startedAt: now(),
        state: 'running',
        steps: found.steps.map((step) => ({
          kind: step.kind,
          label: stepLabel(step),
          state: 'pending',
          output: '',
        })),
        changes: [],
      };
      const active: Active = {
        run,
        owner,
        steps: found.steps,
        workspace,
        input,
        abort: new AbortController(),
        redactor: new Redactor(),
      };
      const runs = [run, ...(await this.runs(ref))];
      for (const old of runs.splice(keptRuns))
        await fs.rm(path.join(this.runsDir(key), `${old.id}.json`), { force: true });
      this.records.set(key, runs);
      this.active.set(key, active);
      try {
        await this.save(active);
      } catch (error) {
        this.active.delete(key);
        this.records.set(key, runs.slice(1));
        throw error;
      }
      active.finished = this.execute(active);
      return run.id;
    } finally {
      this.starting.delete(key);
    }
  }
  /** Ends the step in progress; later steps do not run (D6). */
  async stop(ref: RoutineRef) {
    const active = this.active.get(routineKey(ref));
    if (!active) return;
    active.abort.abort();
    await active.finished;
  }
  async stopAll() {
    await Promise.all([...this.active.values()].map((active) => this.stop(active.run.routine)));
  }
  /** The routine's runs kept on this device, newest first (D8). */
  async runs(ref: RoutineRef): Promise<RoutineRun[]> {
    const key = routineKey(ref);
    const cached = this.records.get(key);
    if (cached) return cached;
    const dir = this.runsDir(key);
    const runs: RoutineRun[] = [];
    for (const name of await fs.readdir(dir).catch(() => [])) {
      const value = runRecord.safeParse(
        await readLocalJson(path.join(dir, name), undefined).catch(() => 0),
      );
      if (!value.success) continue;
      const { schemaVersion: _, ...run } = value.data;
      runs.push(run);
    }
    runs.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
    this.records.set(key, runs);
    return runs;
  }
  private async save(active: Active) {
    clearTimeout(active.timer);
    active.timer = undefined;
    const key = routineKey(active.run.routine);
    await writeLocalJson(path.join(this.runsDir(key), `${active.run.id}.json`), {
      schemaVersion: 1,
      ...active.run,
    });
    this.host.emit(active.run);
  }
  /** Tells the view about new output now and then, without writing the record each time. */
  private touch(active: Active) {
    active.timer ??= setTimeout(() => {
      active.timer = undefined;
      this.host.emit(active.run);
    }, 250);
  }
  private async execute(active: Active) {
    const { run, owner } = active;
    const key = routineKey(run.routine);
    const work = path.join(this.dir, 'work', run.id);
    const reach = owner.kind === 'hibachi' ? [this.host.files.get(owner.id)] : active.workspace;
    let before: Map<string, Map<string, string>> | undefined;
    let state: RoutineRunState = 'succeeded';
    try {
      const kept = path.join(this.dir, 'state', sha256(key));
      await fs.mkdir(work, { recursive: true, mode: 0o700 });
      await fs.mkdir(kept, { recursive: true, mode: 0o700 });
      const env = {
        IRORI_WORK: work,
        IRORI_STATE: kept,
        IRORI_ROUTINE: path.join(owner.dir, run.routine.folder),
      };
      before = await this.changes(reach);
      for (const [index, step] of active.steps.entries()) {
        if (active.abort.signal.aborted) break;
        const record = run.steps[index];
        record.state = 'running';
        record.startedAt = now();
        await this.save(active);
        let nothing = false;
        try {
          if (step.kind === 'run') nothing = await this.program(active, step, record, env);
          else await this.agent(active, step, record, env, index);
        } catch (error) {
          record.state = 'failed';
          record.detail = active.redactor.hide(message(error));
        }
        record.endedAt = now();
        await this.save(active);
        // The step's own code set its state; the assignments above say nothing about it.
        const ended = record.state as RoutineStepRun['state'];
        if (ended !== 'succeeded') {
          state = ended === 'stopped' ? 'stopped' : 'failed';
          break;
        }
        if (nothing) {
          state = 'nothing';
          break;
        }
      }
      if (active.abort.signal.aborted) state = 'stopped';
    } catch (error) {
      state = 'failed';
      run.detail = message(error);
    } finally {
      run.state = state;
      if (before) run.changes = await this.changed(before, reach).catch(() => []);
      run.endedAt = now();
      await this.save(active).catch((error) =>
        console.warn('Could not keep the routine run', String(error)),
      );
      await fs.rm(work, { recursive: true, force: true }).catch(() => {});
      this.active.delete(key);
    }
  }
  /**
   * Runs a `run` step; true when it printed `{"continue": false}` last. Only
   * this step receives the secrets it names, with a fresh private file to write
   * new values to (D5); the file is read once the program has ended.
   */
  private async program(
    active: Active,
    step: Extract<RoutineStep, { kind: 'run' }>,
    record: RoutineStepRun,
    vars: Record<string, string>,
  ) {
    const env: NodeJS.ProcessEnv = { ...agentEnv(), ...vars };
    delete env.ELECTRON_RUN_AS_NODE;
    let back: string | undefined;
    if (step.secrets) {
      const values = await this.host.secrets.values(step.secrets);
      for (const value of Object.values(values)) active.redactor.add(value);
      Object.assign(env, values);
      // Outside IRORI_WORK, which agent steps are given.
      const dir = path.join(this.dir, 'out', randomUUID());
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      back = path.join(dir, 'values');
      await fs.writeFile(back, '', { mode: 0o600, flag: 'wx' });
      env.IRORI_SECRETS_OUT = back;
    }
    try {
      const nothing = await this.spawn(active, step, record, env, vars.IRORI_ROUTINE);
      if (back) await this.writeBack(active, step.secrets!, record, back);
      return nothing && record.state === 'succeeded';
    } finally {
      if (back) await fs.rm(path.dirname(back), { recursive: true, force: true });
    }
  }
  /** Keeps what a step wrote to `IRORI_SECRETS_OUT`; a refused line fails the step. */
  private async writeBack(
    active: Active,
    declared: string[],
    record: RoutineStepRun,
    file: string,
  ) {
    const stat = await fs.lstat(file).catch(() => undefined);
    // A step that removed or replaced the file wrote nothing back.
    if (!stat?.isFile() || !stat.size) return;
    if (stat.size > writeBackLimit) {
      record.state = 'failed';
      record.detail = t('書き戻しが 64 KiB を超えています。', 'The write-back exceeds 64 KiB.');
      return;
    }
    const written = readWriteBack(
      await fs.readFile(file, 'utf8'),
      declared,
      record.state === 'succeeded',
    );
    for (const value of Object.values(written.values)) active.redactor.add(value);
    record.output = active.redactor.hide(record.output);
    if (Object.keys(written.values).length) await this.host.secrets.update(written.values);
    if (written.refused.length) {
      record.state = 'failed';
      const refused = t(
        `書き戻せない行: ${written.refused.join(', ')}`,
        `Not written back: ${written.refused.join(', ')}`,
      );
      record.detail = record.detail ? `${record.detail} · ${refused}` : refused;
    }
  }
  private spawn(
    active: Active,
    step: Extract<RoutineStep, { kind: 'run' }>,
    record: RoutineStepRun,
    env: NodeJS.ProcessEnv,
    folder: string,
  ) {
    let command: string;
    let args: string[];
    if (Array.isArray(step.run)) [command, ...args] = step.run;
    else {
      const file = path.join(folder, step.run);
      if (javascript.includes(path.extname(file).toLowerCase())) {
        command = this.host.runtime ?? process.execPath;
        args = [file];
        env.ELECTRON_RUN_AS_NODE = '1';
      } else {
        command = file;
        args = [];
      }
    }
    const signal = active.abort.signal;
    return new Promise<boolean>((resolve) => {
      const child = launch(command, args, active.owner.root, env);
      const out = new StringDecoder('utf8');
      const err = new StringDecoder('utf8');
      const shownOut = active.redactor.stream();
      const shownErr = active.redactor.stream();
      let stdout = '';
      const append = (text: string) => {
        if (!text) return;
        record.output += text;
        if (record.output.length > outputLimit) {
          record.output = record.output.slice(-outputLimit);
          record.truncated = true;
        }
        this.touch(active);
      };
      child.stdout!.on('data', (bytes: Buffer) => {
        const text = out.write(bytes);
        stdout = (stdout + text).slice(-8192);
        append(shownOut.write(text));
      });
      child.stderr!.on('data', (bytes: Buffer) => append(shownErr.write(err.write(bytes))));
      child.stdin?.on('error', () => {});
      child.stdin?.end();
      const stop = () => void killTree(child);
      signal.addEventListener('abort', stop);
      let settled = false;
      const settle = (state: RoutineStepRun['state'], detail?: string, nothing = false) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', stop);
        append(shownOut.end(out.end()) + shownErr.end(err.end()));
        record.state = signal.aborted ? 'stopped' : state;
        if (detail && !signal.aborted) record.detail = detail;
        resolve(nothing && !signal.aborted);
      };
      // A program that never started has no close to wait for.
      child.on('error', (error) => {
        if (child.pid === undefined)
          settle(
            'failed',
            t(`起動できません: ${error.message}`, `Could not start: ${error.message}`),
          );
      });
      child.on('close', (code, killed) => {
        record.exitCode = code;
        if (code === 0) settle('succeeded', undefined, nothingToDo(stdout));
        else
          settle(
            'failed',
            killed
              ? t(`${killed} で終了しました。`, `Ended by ${killed}.`)
              : t(`終了コード ${code}`, `Exit code ${code}`),
          );
      });
    });
  }
  /** Why an agent step waits now (D6), or undefined when it can start. */
  private async blocked(scopeIds: string[], agent: AgentId, workspace: string) {
    try {
      this.host.canStart();
    } catch {
      return t('Git・保存・接続の完了待ち', 'Waiting for Git, saving or a connection');
    }
    for (const scopeId of scopeIds)
      if (this.host.agents.busy(scopeId))
        return t(`${this.nameOf(scopeId)} の実行待ち`, `Waiting for ${this.nameOf(scopeId)}`);
    // The irori agent's queue is the one of the routine's workspace (ADR 017 D4).
    if (await this.host.agents.pending(scopeIds[0], workspace))
      return t('送信待ちの指示の後', 'After the queued instructions');
    return undefined;
  }
  /** Runs an `agent` step as an ordinary run of that agent (D7). */
  private async agent(
    active: Active,
    step: Extract<RoutineStep, { kind: 'agent' }>,
    record: RoutineStepRun,
    env: Record<string, string>,
    index: number,
  ) {
    const scopeId = active.owner.id;
    const settings = await this.host.settings();
    const panel =
      active.input.agents[scopeId] ??
      (active.owner.kind === 'irori'
        ? { agent: settings.yourAi.agent, model: settings.yourAi.models[settings.yourAi.agent] }
        : undefined);
    const agent = step.cli ?? panel?.agent ?? 'claude';
    const model = step.model ?? (panel?.agent === agent ? panel.model : undefined);
    requireAgentAccess(agent, step.access);
    const hibachis = handed(step.hibachis, active.workspace);
    if ('problem' in hibachis) throw Error(hibachis.problem);
    const scopeIds = [scopeId, ...hibachis.scopeIds];
    const signal = active.abort.signal;
    let started: { runId: string; conversationId: string; done: Promise<StepEnd> } | undefined;
    while (!started) {
      if (signal.aborted) {
        record.state = 'stopped';
        return;
      }
      let reason = await this.blocked(scopeIds, agent, active.input.workspaceId);
      if (!reason)
        try {
          started = this.host.agents.startStep(
            {
              scopeId,
              agent,
              access: step.access,
              model,
              prompt: step.prompt,
              brains: hibachis.scopeIds.length ? hibachis.scopeIds : undefined,
              // Hibachis the irori agent registers join the routine's workspace.
              workspace: active.owner.kind === 'irori' ? active.input.workspaceId : undefined,
            },
            {
              preamble: stepPreamble(active.run.name, env),
              directories: Object.values(env),
              notice: t(
                `ルーティン: ${active.run.name}（ステップ ${index + 1}）`,
                `Routine: ${active.run.name} (step ${index + 1})`,
              ),
              env,
              routine: { runId: active.run.id, step: index },
            },
          );
          break;
        } catch (error) {
          // Another run took the space between the check and the start.
          reason = await this.blocked(scopeIds, agent, active.input.workspaceId);
          if (!reason) throw error;
        }
      if (record.state !== 'waiting' || record.detail !== reason) {
        record.state = 'waiting';
        record.detail = reason;
        await this.save(active);
      }
      await pause(1000, signal);
    }
    const runId = started.runId;
    const stop = () => void this.host.agents.cancelRun(runId);
    signal.addEventListener('abort', stop);
    if (signal.aborted) stop();
    try {
      record.state = 'running';
      delete record.detail;
      record.conversation = { scopeId, agent, runId, conversationId: started.conversationId };
      await this.save(active);
      const end = await started.done;
      // A value an earlier step received can reach the agent through IRORI_WORK.
      const report = active.redactor.hide(end.report);
      record.output = report.slice(-outputLimit);
      record.truncated = report.length > outputLimit || undefined;
      const failed = failedReport(report);
      if (end.outcome === 'cancelled') record.state = 'stopped';
      else if (end.outcome === 'failed') {
        record.state = 'failed';
        record.detail = end.error
          ? active.redactor.hide(end.error)
          : t('失敗しました。', 'Failed.');
      } else if (failed) {
        record.state = 'failed';
        record.detail = failed;
      } else record.state = 'succeeded';
    } finally {
      signal.removeEventListener('abort', stop);
    }
  }
  /** Each hibachi's changed paths with their state and content hash, from Git. */
  private async changes(spaces: Space[]) {
    const found = new Map<string, Map<string, string>>();
    for (const space of spaces) {
      const status = await this.host.gitStatus(space.scopeId).catch(() => undefined);
      if (!status?.available) continue;
      const entries = new Map<string, string>();
      const hashing = status.changes.length <= 500;
      for (const change of status.changes) {
        const code = change.index + change.worktree;
        const file = path.join(space.root, change.path);
        const content =
          hashing && !change.blocked
            ? await fs.stat(file).then(
                (stat) =>
                  stat.size > 10 * 1024 * 1024
                    ? `${stat.size}:${stat.mtimeMs}`
                    : fs.readFile(file).then(sha256),
                () => 'missing',
              )
            : '';
        entries.set(change.path, `${code}:${content}`);
      }
      found.set(space.scopeId, entries);
    }
    return found;
  }
  /** The paths whose state or content changed since `before`, per hibachi (D8). */
  private async changed(before: Map<string, Map<string, string>>, spaces: Space[]) {
    const after = await this.changes(spaces);
    const changes: RoutineRun['changes'] = [];
    for (const space of spaces) {
      const earlier = before.get(space.scopeId);
      const later = after.get(space.scopeId);
      if (!earlier || !later) continue;
      const paths = [...new Set([...earlier.keys(), ...later.keys()])]
        .filter((file) => earlier.get(file) !== later.get(file))
        .sort();
      if (paths.length)
        changes.push({ scopeId: space.scopeId, name: space.name, paths: paths.slice(0, 500) });
    }
    return changes;
  }
}
