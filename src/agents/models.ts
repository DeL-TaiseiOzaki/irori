import { homedir } from 'node:os';
import type { ChildProcess, ChildProcessWithoutNullStreams } from 'node:child_process';
import type { AgentId, AgentModel, AgentModels } from '../domain/types';
import { agentModel } from '../domain/conversation';
import { t } from '../domain/i18n';
import { agentEnv, killTree, launch, output, version } from './process';
import { Rpc } from './rpc';
import { codexServer, initializeCodex, refuseCodex } from './codex';

// Reading a list asks the CLI what it offers; none of these generates text.
const deadline = 30000;
const valid = (id: string) => agentModel.safeParse(id).success;
const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');
const timedOut = () =>
  t('モデル一覧の取得がタイムアウトしました。', 'Reading the model list timed out.');

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

/** What a listing command prints on success, bounded in size and time. */
const listing = (command: string, args: string[]) =>
  output(command, args, {
    cwd: homedir(),
    keep: 1024 * 1024,
    timeout: deadline,
    timedOut,
    failed: (code, stderr) => stderr.trim() || `${command} exited (${code})`,
  });

/** Codex's `model/list` through its app server, following each page; hidden models are left out. */
async function codexModels(): Promise<AgentModel[]> {
  const child = codexServer(homedir());
  const rpc = new Rpc(child, (message) => {
    // Nothing runs, so nothing may be asked; refuse rather than approve.
    if (message.id !== undefined && message.method) refuseCodex(rpc, message, 'Not supported');
  });
  try {
    await initializeCodex(rpc);
    const models: AgentModel[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const result = await rpc.request('model/list', cursor ? { cursor } : {});
      for (const model of result?.data ?? []) {
        const id = model?.model ?? model?.id;
        if (model?.hidden || typeof id !== 'string' || !valid(id)) continue;
        models.push({
          id,
          label:
            typeof model.displayName === 'string' && model.displayName ? model.displayName : id,
          ...(model.isDefault === true && { default: true }),
        });
      }
      cursor = typeof result?.nextCursor === 'string' ? result.nextCursor : undefined;
      if (!cursor) break;
    }
    return models;
  } finally {
    rpc.fail(Error('Model list read'));
    await killTree(child).catch(() => {});
  }
}

/** Claude Code's aliases, when the installed CLI cannot be asked. */
export const claudeAliases: AgentModel[] = ['fable', 'opus', 'sonnet', 'haiku'].map((id) => ({
  id,
  label: id[0].toUpperCase() + id.slice(1),
}));

/**
 * Claude Code's `supportedModels()`, asked of a session that is never sent a
 * message: its input never yields, so no turn starts and no model is called.
 */
async function claudeModels(): Promise<AgentModel[]> {
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
      cwd: homedir(),
      pathToClaudeCodeExecutable: 'claude',
      env: agentEnv(),
      settingSources: ['user'],
      abortController: abort,
      spawnClaudeCodeProcess: (options) =>
        (child = launch(
          options.command,
          options.args,
          options.cwd ?? homedir(),
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
    const list = await Promise.race([
      session.supportedModels(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error(timedOut())), deadline);
      }),
    ]);
    // Its "default" row is the CLI's default, offered separately; the row it resolves to is marked.
    const preset = list.find((model) => model.value === 'default');
    return list
      .filter((model) => model.value !== 'default' && valid(model.value))
      .map((model) => ({
        id: model.value,
        label: model.displayName || model.value,
        ...(preset?.resolvedModel &&
          model.resolvedModel === preset.resolvedModel && { default: true }),
      }));
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

async function list(agent: AgentId): Promise<AgentModel[]> {
  if (agent === 'codex') return codexModels();
  if (agent === 'claude') return claudeModels();
  if (agent === 'opencode') return parseOpenCodeModels(await listing('opencode', ['models']));
  if (agent === 'pi') return parsePiModels(await listing('pi', ['--list-models']));
  return []; // Hermes Agent prints no machine-readable list.
}

/** The models each installed CLI offers, read once per CLI version. */
export class ModelCatalog {
  private lists = new Map<string, Promise<AgentModel[]>>();
  constructor(private read = list) {}
  async models(agent: AgentId): Promise<AgentModels> {
    let installed: string;
    try {
      installed = await version(agent);
    } catch (error) {
      return { models: [], custom: true, error: String(error) };
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
      const models = await pending;
      return { models, custom: agent === 'hermes' || !models.length };
    } catch (error) {
      return {
        models: agent === 'claude' ? claudeAliases : [],
        custom: true,
        error: String(error),
      };
    }
  }
}
