import { promises as fs, statSync } from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { claudeSettingsFile, readHooks } from '../domain/schema-settings';
import type { AgentId } from '../domain/types';
import { killTree, launch } from './process';

/**
 * The hooks of a Schema (`.claude/settings.json`'s `hooks`, in Claude Code's
 * shape) run for the CLIs that do not run them themselves (ADR 058). Claude Code
 * runs a folder's own hooks and is given the shared Schema's as settings; for
 * every other CLI irori runs both, here, with Claude Code's meaning: the same
 * events, the same input on standard input, and the same reading of exit codes
 * and JSON output. Where a CLI lets irori in (its plugin, extension or hook),
 * the tool events come from there; the rest irori sees itself.
 */

/** The events irori runs for a CLI, in Claude Code's names. */
export type HookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'UserPromptSubmit'
  | 'Stop'
  | 'SubagentStop'
  | 'SessionStart'
  | 'SessionEnd'
  | 'Notification'
  | 'PreCompact';

/** One hook of a Schema, with the Schema it came from. */
export interface SchemaHook {
  event: string;
  matcher?: string;
  type: string;
  command: string;
  /** An `http` hook's address. */
  url?: string;
  /** Seconds, as Claude Code reads `timeout`. */
  timeout?: number;
  /** Which Schema: the shared one or the folder's own. */
  from: 'shared' | 'folder';
}

/** What the hooks of one event decided, read as Claude Code reads them. */
export interface HookOutcome {
  /** The event is stopped: a PreToolUse denial, a blocked prompt, a Stop that keeps going. */
  blocked?: string;
  /** PreToolUse: the person decides, with this reason. */
  ask?: string;
  /** PreToolUse: the tool's input as a hook replaced it. */
  input?: Record<string, unknown>;
  /** PostToolUse: the tool's output as a hook replaced it. */
  output?: unknown;
  /** Words for the agent: additional context, a PostToolUse block's reason, exit-0 output where it is context. */
  context: string[];
  /** `continue: false`: the run ends, with the hook's reason for the person. */
  halt?: string;
  /** For the person: `systemMessage`, and hooks that failed without stopping anything. */
  notices: string[];
}

/** The longest standard output or error kept of one hook, in characters. */
const outputLimit = 1_000_000;
/** What one hook adds for the agent or the person at most, as Claude Code caps it. */
const wordsLimit = 10_000;
/** Claude Code's default timeout for a command hook, in seconds; 30 for a prompt. */
const defaultTimeout = 600;
const promptTimeout = 30;
/** All SessionEnd hooks share this long, as in Claude Code. */
const sessionEndBudget = 1_500;

/** Events whose hooks have a matcher, and what it is matched against. */
const matched = new Set<string>([
  'PreToolUse',
  'PostToolUse',
  'SessionStart',
  'SessionEnd',
  'PreCompact',
  'Notification',
  'SubagentStop',
]);

/**
 * Whether a matcher takes a value, as Claude Code reads one: all for `*`, empty
 * or none; a plain list of names separated by `|` or `,` matches exactly; anything
 * else is an unanchored JavaScript regular expression. `also` are other names
 * the same thing has, such as a CLI's own tool name.
 */
export function matcherTakes(matcher: string | undefined, value: string, also: string[] = []) {
  if (matcher === undefined || matcher === '' || matcher === '*') return true;
  const names = [value, ...also];
  if (/^[A-Za-z0-9_\- ,|]+$/.test(matcher)) {
    const list = matcher
      .split(/[|,]/)
      .map((name) => name.trim())
      .filter(Boolean);
    return names.some((name) => list.includes(name));
  }
  try {
    const pattern = new RegExp(matcher);
    return names.some((name) => pattern.test(name));
  } catch {
    return false;
  }
}

/** The hooks of one Schema's `hooks` value, in file order. A malformed value is refused. */
export function schemaHooks(hooks: unknown, from: SchemaHook['from']): SchemaHook[] {
  if (hooks === undefined || hooks === null) return [];
  return readHooks(JSON.stringify({ hooks })).map((entry) => ({
    event: entry.event,
    ...(entry.matcher !== undefined && { matcher: entry.matcher }),
    type: entry.type,
    command: entry.command,
    ...(typeof entry.extra.url === 'string' && { url: entry.extra.url }),
    ...(typeof entry.extra.timeout === 'number' &&
      entry.extra.timeout > 0 && { timeout: entry.extra.timeout }),
    from,
  }));
}

/** The hooks of the `.claude/settings.json` in `root`, or none when it has none. */
export async function folderHooks(root: string): Promise<SchemaHook[]> {
  const text = await fs
    .readFile(path.join(root, claudeSettingsFile), 'utf8')
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return undefined;
      throw error;
    });
  if (text === undefined || !text.trim()) return [];
  return schemaHooks((JSON.parse(text) as { hooks?: unknown }).hooks, 'folder');
}

/**
 * The shell a hook's command runs in: `sh` on macOS and Linux, Git Bash on
 * Windows when it is there, as Claude Code does, otherwise cmd.exe. The third
 * value says the arguments go to cmd.exe as written, as Node's own `shell` does.
 */
export function hookShell(
  command: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): [string, string[], boolean] {
  if (platform !== 'win32') return ['/bin/sh', ['-c', command], false];
  const bash = [
    env.CLAUDE_CODE_GIT_BASH_PATH,
    path.join(env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
  ].find((file) => {
    try {
      return !!file && statSync(file).isFile();
    } catch {
      return false;
    }
  });
  return bash
    ? [bash, ['-c', command], false]
    : [env.ComSpec ?? env.COMSPEC ?? 'cmd.exe', ['/d', '/s', '/c', `"${command}"`], true];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const cut = (text: string) =>
  text.length > wordsLimit
    ? `${text.slice(0, wordsLimit)}\n… (${text.length - wordsLimit} more characters)`
    : text;
const firstLine = (text: string) => text.trim().split('\n')[0] ?? '';

type Finished = { code: number | null; stdout: string; stderr: string; error?: string };

/** Keeps the first `limit` characters of a stream. */
function collect(stream: NodeJS.ReadableStream | null | undefined) {
  let text = '';
  stream?.setEncoding?.('utf8');
  stream?.on('data', (chunk: string) => {
    if (text.length < outputLimit) text = (text + chunk).slice(0, outputLimit);
  });
  return () => text;
}

/**
 * Runs the hooks of a Schema for one CLI run. `fields` are the input every event
 * carries besides its own (session id, folder, permission mode); `env` is the
 * run's environment, to which `CLAUDE_PROJECT_DIR` is added as Claude Code adds it.
 */
export class SchemaHookRunner {
  private children = new Set<ChildProcess>();
  constructor(
    readonly hooks: SchemaHook[],
    private options: {
      cwd: string;
      env: NodeJS.ProcessEnv;
      agent: AgentId;
      fields: () => Record<string, unknown>;
      signal?: AbortSignal;
    },
  ) {}
  /** Whether any hook of the event could run. */
  has(event: HookEvent) {
    return this.hooks.some((hook) => hook.event === event);
  }
  /** The events the hooks name, each once. */
  events() {
    return [...new Set(this.hooks.map((hook) => hook.event))];
  }
  /** Stops every hook still running. */
  async stop() {
    await Promise.all([...this.children].map((child) => killTree(child).catch(() => {})));
  }
  /**
   * Runs the hooks of `event` whose matcher takes `match` (the tool's name, the
   * session's source …) with `input`, all at once as Claude Code does, a command
   * named twice once; then reads what they decided.
   */
  async run(
    event: HookEvent,
    input: Record<string, unknown>,
    match?: { value: string; also?: string[] },
  ): Promise<HookOutcome> {
    const outcome: HookOutcome = { context: [], notices: [] };
    const chosen = this.hooks.filter(
      (hook) =>
        hook.event === event &&
        (!matched.has(event) || !match || matcherTakes(hook.matcher, match.value, match.also)),
    );
    const seen = new Set<string>();
    const unique = chosen.filter((hook) => {
      const key = JSON.stringify([hook.type, hook.command, hook.url]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!unique.length) return outcome;
    const body = JSON.stringify({
      ...this.options.fields(),
      hook_event_name: event,
      ...input,
    });
    const budget = event === 'SessionEnd' ? AbortSignal.timeout(sessionEndBudget) : undefined;
    const results = await Promise.all(
      unique.map(async (hook) => ({ hook, finished: await this.one(hook, event, body, budget) })),
    );
    const reasons: string[] = [];
    const asks: string[] = [];
    for (const { hook, finished } of results) {
      const label = `${event}${hook.matcher ? ` (${hook.matcher})` : ''}`;
      if (finished.error) {
        outcome.notices.push(`${label}: ${finished.error}`);
        continue;
      }
      if (finished.code === 2) {
        const reason = cut(finished.stderr.trim() || `${label} hook exited with 2`);
        if (event === 'PostToolUse') outcome.context.push(reason);
        else if (
          ['PreToolUse', 'UserPromptSubmit', 'Stop', 'SubagentStop', 'PreCompact'].includes(event)
        )
          reasons.push(reason);
        else outcome.notices.push(`${label}: ${reason}`);
        continue;
      }
      if (finished.code !== 0) {
        outcome.notices.push(
          `${label}: failed with non-blocking status code ${finished.code}${
            firstLine(finished.stderr) ? `: ${firstLine(finished.stderr)}` : ''
          }`,
        );
        continue;
      }
      const stdout = finished.stdout.trim();
      let json: Record<string, unknown> | undefined;
      if (stdout.startsWith('{'))
        try {
          const parsed: unknown = JSON.parse(stdout);
          if (isObject(parsed)) json = parsed;
        } catch {
          // Plain words, not JSON.
        }
      if (!json) {
        // Plain output is context where Claude Code makes it context.
        if (stdout && ['UserPromptSubmit', 'SessionStart', 'PreCompact'].includes(event))
          outcome.context.push(cut(stdout));
        continue;
      }
      if (typeof json.systemMessage === 'string' && json.systemMessage)
        outcome.notices.push(cut(json.systemMessage));
      if (json.continue === false)
        outcome.halt ??=
          typeof json.stopReason === 'string' && json.stopReason
            ? json.stopReason
            : `A ${event} hook stopped the run.`;
      const specific = isObject(json.hookSpecificOutput) ? json.hookSpecificOutput : {};
      if (typeof specific.additionalContext === 'string' && specific.additionalContext)
        outcome.context.push(cut(specific.additionalContext));
      const reason = typeof json.reason === 'string' ? json.reason : '';
      if (event === 'PreToolUse') {
        const decision =
          typeof specific.permissionDecision === 'string'
            ? specific.permissionDecision
            : json.decision === 'block'
              ? 'deny'
              : json.decision === 'approve'
                ? 'allow'
                : undefined;
        const why =
          typeof specific.permissionDecisionReason === 'string'
            ? specific.permissionDecisionReason
            : reason;
        if (decision === 'deny') reasons.push(cut(why || `A ${label} hook denied this call.`));
        if (decision === 'ask') asks.push(cut(why || `A ${label} hook asks you to decide.`));
        if (isObject(specific.updatedInput)) outcome.input = specific.updatedInput;
      } else if (event === 'PostToolUse') {
        if (json.decision === 'block')
          outcome.context.push(cut(reason || `${label} hook feedback`));
        if ('updatedToolOutput' in specific) outcome.output = specific.updatedToolOutput;
      } else if (json.decision === 'block' && event !== 'SessionStart') {
        reasons.push(cut(reason || `A ${label} hook blocked this.`));
      }
    }
    if (reasons.length) outcome.blocked = reasons.join('\n');
    else if (asks.length) outcome.ask = asks.join('\n');
    return outcome;
  }
  private async one(
    hook: SchemaHook,
    event: HookEvent,
    body: string,
    budget?: AbortSignal,
  ): Promise<Finished> {
    const seconds = hook.timeout ?? (event === 'UserPromptSubmit' ? promptTimeout : defaultTimeout);
    const signals = [AbortSignal.timeout(seconds * 1000), budget, this.options.signal].filter(
      (signal): signal is AbortSignal => !!signal,
    );
    const signal = AbortSignal.any(signals);
    if (hook.type === 'http') return this.http(hook, body, signal, seconds);
    if (hook.type !== 'command' || !hook.command)
      return {
        code: null,
        stdout: '',
        stderr: '',
        error: `irori runs command and http hooks only; this ${hook.type} hook did not run`,
      };
    const [shell, args, verbatim] = hookShell(hook.command, process.platform, this.options.env);
    const env = {
      ...this.options.env,
      CLAUDE_PROJECT_DIR: this.options.cwd,
      IRORI_HOOK_CLI: this.options.agent,
    };
    const child = verbatim
      ? spawn(shell, args, {
          cwd: this.options.cwd,
          env,
          stdio: 'pipe',
          windowsHide: true,
          windowsVerbatimArguments: true,
        })
      : launch(shell, args, this.options.cwd, env);
    this.children.add(child);
    const stdout = collect(child.stdout);
    const stderr = collect(child.stderr);
    child.stdin?.on('error', () => {}); // A hook that does not read its input may exit first.
    child.stdin?.end(body);
    const stop = () => void killTree(child).catch(() => {});
    signal.addEventListener('abort', stop, { once: true });
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', resolve);
      });
      if (signal.aborted)
        return {
          code,
          stdout: stdout(),
          stderr: stderr(),
          error:
            budget?.aborted || this.options.signal?.aborted
              ? 'stopped before it finished'
              : `timed out after ${seconds} s`,
        };
      return { code, stdout: stdout(), stderr: stderr() };
    } catch (error) {
      return { code: null, stdout: '', stderr: '', error: String(error) };
    } finally {
      signal.removeEventListener('abort', stop);
      this.children.delete(child);
    }
  }
  /** An `http` hook: the input as a POST, the answer read as a command's output. */
  private async http(
    hook: SchemaHook,
    body: string,
    signal: AbortSignal,
    seconds: number,
  ): Promise<Finished> {
    if (!hook.url || !/^https?:\/\//i.test(hook.url))
      return { code: null, stdout: '', stderr: '', error: 'an http hook needs an http(s) url' };
    try {
      const response = await fetch(hook.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal,
        redirect: 'error',
      });
      const text = (await response.text()).slice(0, outputLimit);
      return response.ok
        ? { code: 0, stdout: text, stderr: '' }
        : { code: 1, stdout: '', stderr: `HTTP ${response.status}` };
    } catch (error) {
      return {
        code: null,
        stdout: '',
        stderr: '',
        error: signal.aborted ? `timed out after ${seconds} s` : String(error),
      };
    }
  }
}
