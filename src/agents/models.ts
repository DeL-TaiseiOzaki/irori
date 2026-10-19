import { homedir } from 'node:os';
import type { Query, SettingSource } from '@anthropic-ai/claude-agent-sdk';
import type { ChildProcess, ChildProcessWithoutNullStreams } from 'node:child_process';
import type { AgentId, AgentModel, AgentModels } from '../domain/types';
import { agentEffort, agentModel } from '../domain/conversation';
import { t } from '../domain/i18n';
import { agentCommand, agentEnv, killTree, launch, output, version } from './process';
import { Rpc } from './rpc';
import { codexServer, initializeCodex, refuseCodex } from './codex';

// Reading a list asks the CLI what it offers; none of these generates text.
const deadline = 30000;
const valid = (id: string) => agentModel.safeParse(id).success;
/** The levels a list names that can be passed on, without repeats. */
const levels = (values: unknown[]) => [
  ...new Set(values.filter((value): value is string => agentEffort.safeParse(value).success)),
];
/** Claude Code's levels, when the installed CLI cannot be asked. */
export const claudeEfforts = ['low', 'medium', 'high', 'xhigh', 'max'];
/** Pi's `set_thinking_level` levels: the same for every model, which Pi clamps to its own. */
export const piEfforts = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');
const timedOut = () =>
  t('CLI からの一覧の取得がタイムアウトしました。', 'Reading the list from the CLI timed out.');

/** `opencode models`: one `provider/model` per line. */
export function parseOpenCodeModels(output: string): AgentModel[] {
  const ids = plain(output)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((id) => /^[^/\s]+\/\S+$/.test(id) && valid(id));
  return [...new Set(ids)].map((id) => ({ id, label: id }));
}

/** `pi --list-models`: a table under the header `provider  model  context  max-out …`. */
export function parsePiModels(output: string): AgentModel[] {
  const lines = plain(output).split(/\r?\n/);
  const header = lines.findIndex((line) => /^\s*provider\s+model\s+context\b/.test(line));
  if (header < 0) return [];
  const ids = lines
    .slice(header + 1)
    .map((line) => line.trim().split(/\s+/))
    .filter((cells) => cells.length >= 2)
    .map(([provider, model]) => `${provider}/${model}`)
    .filter(valid);
  return [...new Set(ids)].map((id) => ({ id, label: id }));
}

/**
 * `agy models`: one `<model>\t<label>` per line. Each model already names its
 * thinking level (`gemini-3.8-flash-high`), so the CLI is passed no level.
 */
export function parseAntigravityModels(output: string): AgentModel[] {
  const models = new Map<string, string>();
  for (const line of plain(output).split(/\r?\n/)) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const id = line.slice(0, tab).trim();
    if (valid(id) && !models.has(id)) models.set(id, line.slice(tab + 1).trim() || id);
  }
  return [...models].map(([id, label]) => ({ id, label }));
}

/** What a listing command prints on success, bounded in size and time. */
const listing = (command: string, args: string[]) =>
  output(command, args, {
    cwd: homedir(),
    keep: 1024 * 1024,
    timeout: deadline,
    timedOut,
    failed: (code, stderr) => stderr.trim() || `${command} exited (${code})`,
  });

/** Codex's app server in `cwd`, asked by `read` and closed after it; nothing runs. */
export async function askCodex<T>(cwd: string, read: (rpc: Rpc) => Promise<T>): Promise<T> {
  const child = codexServer(cwd);
  const rpc = new Rpc(child, (message) => {
    // Nothing runs, so nothing may be asked; refuse rather than approve.
    if (message.id !== undefined && message.method) refuseCodex(rpc, message, 'Not supported');
  });
  try {
    await initializeCodex(rpc);
    return await read(rpc);
  } finally {
    rpc.fail(Error('Codex read'));
    await killTree(child).catch(() => {});
  }
}

/** Codex's `model/list` through its app server, following each page; hidden models are left out. */
function codexModels(): Promise<AgentModel[]> {
  return askCodex(homedir(), async (rpc) => {
    const models: AgentModel[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const result = await rpc.request('model/list', cursor ? { cursor } : {});
      for (const model of result?.data ?? []) {
        const id = model?.model ?? model?.id;
        if (model?.hidden || typeof id !== 'string' || !valid(id)) continue;
        const efforts = Array.isArray(model.supportedReasoningEfforts)
          ? levels(model.supportedReasoningEfforts.map((option: any) => option?.reasoningEffort))
          : [];
        models.push({
          id,
          label:
            typeof model.displayName === 'string' && model.displayName ? model.displayName : id,
          ...(model.isDefault === true && { default: true }),
          // A model listing none takes none.
          efforts,
          ...(efforts.includes(model.defaultReasoningEffort) && {
            defaultEffort: model.defaultReasoningEffort,
          }),
        });
      }
      cursor = typeof result?.nextCursor === 'string' ? result.nextCursor : undefined;
      if (!cursor) break;
    }
    return models;
  });
}

/** Claude Code's aliases, when the installed CLI cannot be asked. */
export const claudeAliases: AgentModel[] = ['fable', 'opus', 'sonnet', 'haiku'].map((id) => ({
  id,
  label: id[0].toUpperCase() + id.slice(1),
}));

/**
 * A Claude Code session in `cwd` that is never sent a message, asked by `read`:
 * its input never yields, so no turn starts and no model is called.
 */
export async function askClaude<T>(
  cwd: string,
  settingSources: SettingSource[],
  read: (session: Query) => Promise<T>,
): Promise<T> {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  let release!: () => void;
  const idle = new Promise<void>((resolve) => {
    release = resolve;
  });
  async function* nothing(): AsyncGenerator<never> {
    await idle;
  }
  const abort = new AbortController();
  let child: ChildProcess | undefined;
  const session = query({
    prompt: nothing(),
    options: {
      cwd,
      pathToClaudeCodeExecutable: 'claude',
      env: agentEnv(),
      settingSources,
      abortController: abort,
      spawnClaudeCodeProcess: (options) =>
        (child = launch(
          options.command,
          options.args,
          options.cwd ?? cwd,
          options.env,
        )) as ChildProcessWithoutNullStreams,
    },
  });
  const draining = (async () => {
    try {
      for await (const _ of session);
    } catch {
      // The session is closed below; its end is not the answer.
    }
  })();
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      read(session),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error(timedOut())), deadline);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    release();
    abort.abort();
    session.close();
    await draining;
    // Closed like every other spawn: with whatever the CLI started.
    if (child) await killTree(child).catch(() => {});
  }
}

/** Claude Code's `supportedModels()`, each with the effort levels it takes. */
async function claudeModels(): Promise<AgentModels> {
  const list = await askClaude(homedir(), ['user'], (session) => session.supportedModels());
  const effortsOf = (model: (typeof list)[number]) =>
    model.supportsEffort ? levels(model.supportedEffortLevels ?? []) : [];
  // Its "default" row is the CLI's default, offered separately; the row it resolves to is marked.
  const preset = list.find((model) => model.value === 'default');
  const models = list
    .filter((model) => model.value !== 'default' && valid(model.value))
    .map((model): AgentModel => {
      const efforts = effortsOf(model);
      return {
        id: model.value,
        label: model.displayName || model.value,
        ...(preset?.resolvedModel &&
          model.resolvedModel === preset.resolvedModel && { default: true }),
        efforts,
      };
    });
  // The default row's levels stand for a model typed in.
  return { models, custom: !models.length, efforts: preset ? effortsOf(preset) : claudeEfforts };
}

/** What each CLI lets be chosen besides its models' own levels. */
function levelsOf(agent: AgentId): Pick<AgentModels, 'efforts' | 'customEffort'> {
  if (agent === 'claude') return { efforts: claudeEfforts };
  if (agent === 'pi') return { efforts: piEfforts };
  // OpenCode names its levels as variants of each model in its own configuration.
  if (agent === 'opencode') return { customEffort: true };
  return {}; // Codex lists them per model; Hermes Agent and the Antigravity CLI take none.
}

async function list(agent: AgentId): Promise<AgentModel[] | AgentModels> {
  if (agent === 'codex') return codexModels();
  if (agent === 'claude') return claudeModels();
  if (agent === 'opencode') return parseOpenCodeModels(await listing('opencode', ['models']));
  if (agent === 'pi') return parsePiModels(await listing('pi', ['--list-models']));
  if (agent === 'antigravity') return parseAntigravityModels(await listing('agy', ['models']));
  return []; // Hermes Agent prints no machine-readable list.
}

/** The models each installed CLI offers, read once per CLI version. */
export class ModelCatalog {
  private lists = new Map<string, Promise<AgentModel[] | AgentModels>>();
  constructor(private read = list) {}
  async models(agent: AgentId): Promise<AgentModels> {
    let installed: string;
    try {
      installed = await version(agentCommand(agent));
    } catch (error) {
      return { models: [], custom: true, ...levelsOf(agent), error: String(error) };
    }
    const key = `${agent}\n${installed}`;
    let pending = this.lists.get(key);
    if (!pending) {
      pending = this.read(agent);
      this.lists.set(key, pending);
      // A failed read is tried again next time.
      pending.catch(() => this.lists.delete(key));
    }
    try {
      const read = await pending;
      if (!Array.isArray(read)) return read;
      return { models: read, custom: agent === 'hermes' || !read.length, ...levelsOf(agent) };
    } catch (error) {
      return {
        models: agent === 'claude' ? claudeAliases : [],
        custom: true,
        ...levelsOf(agent),
        error: String(error),
      };
    }
  }
}
