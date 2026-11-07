import { promises as fs, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
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
  | 'PostToolUseFailure'
  | 'PermissionRequest'
  | 'UserPromptSubmit'
  | 'Stop'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'SessionStart'
  | 'SessionEnd'
  | 'Notification'
  | 'PreCompact'
  | 'PostCompact';

/** One hook of a Schema, with the fields Claude Code reads, and the Schema it came from. */
export interface SchemaHook {
  event: string;
  matcher?: string;
  type: string;
  command: string;
  /** The exec form: `command` is run directly with these arguments, without a shell. */
  args?: string[];
  /** `bash` (the default) or `powershell`, for the shell form. */
  shell?: string;
  /** An `http` hook's address, headers and the environment variables they may name. */
  url?: string;
  headers?: Record<string, string>;
  allowedEnvVars?: string[];
  /** Seconds, as Claude Code reads `timeout`. */
  timeout?: number;
  /** Runs in the background: it decides nothing; `asyncRewake` wakes the agent on exit 2. */
  async?: boolean;
  asyncRewake?: boolean;
  /** `block`: a hook that cannot start, fails, times out or answers nonsense acts as exit 2. */
  onFailure?: string;
  /** A permission rule, such as `Bash(git *)`, the call must match for the hook to run. */
  if?: string;
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
  /** PermissionRequest: the hooks answered the request instead of the person. */
  decision?: { behavior: 'allow' | 'deny'; message?: string; input?: Record<string, unknown> };
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
/** SessionEnd hooks share this long unless a hook's own timeout raises it, at most 60 s, as in Claude Code. */
const sessionEndDefault = 1_500;
const sessionEndMost = 60_000;

/** Events whose hooks have a matcher, and what it is matched against. */
const matched = new Set<string>([
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'SessionStart',
  'SessionEnd',
  'PreCompact',
  'PostCompact',
  'Notification',
  'SubagentStart',
  'SubagentStop',
]);
/** Events where a hook's `if` is read; on any other, a hook with `if` never runs. */
const ruled = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest']);
/** Events exit 2 stops; on the others it is a notice for the person. */
const blocking = new Set(['PreToolUse', 'UserPromptSubmit', 'Stop', 'SubagentStop', 'PreCompact']);
/** Events whose exit-2 words go to the agent beside a call that ran or failed. */
const feedback = new Set(['PostToolUse', 'PostToolUseFailure']);

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

/** A glob as a regular expression: `**` any path, `*` within a name, `?` one character. */
function globPattern(glob: string) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === '*' && glob[i + 1] === '*') {
      out += '.*';
      i++;
      if (glob[i + 1] === '/') i++;
    } else if (char === '*') out += '[^/]*';
    else if (char === '?') out += '[^/]';
    else out += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

/** The tools a permission rule's name covers, as Claude Code applies Edit and Read rules. */
const ruleTools: Record<string, string[]> = {
  Edit: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'apply_patch'],
  Read: ['Read', 'Glob', 'Grep', 'LS'],
};

/**
 * Whether a call takes a hook's `if`, a permission rule as Claude Code writes
 * them: `Tool` or `Tool(spec)`. Bash's spec is a command pattern (`git *`, or
 * `npm run test:*` for a prefix); a file tool's is a path pattern, relative to
 * the folder unless it starts with `//` (absolute) or `~/` (home); WebFetch's
 * is `domain:host`. A spec irori cannot read lets the hook run: a guard that
 * runs too often is safer than one that does not.
 */
export function ruleTakes(
  rule: string,
  tool: { name: string; also?: string[]; input: Record<string, unknown> },
  root: string,
  home: string,
) {
  const parsed = /^\s*([^()\s]+)\s*(?:\((.*)\))?\s*$/s.exec(rule);
  if (!parsed) return true;
  const [, name, spec] = parsed;
  const names = [tool.name, ...(tool.also ?? [])];
  if (!(ruleTools[name] ?? [name]).some((covered) => names.includes(covered))) return false;
  if (spec === undefined || spec === '' || spec === '*') return true;
  const input = tool.input;
  if (name === 'Bash') {
    const command = typeof input.command === 'string' ? input.command.trim() : '';
    if (spec.endsWith(':*')) return command.startsWith(spec.slice(0, -2));
    return new RegExp(
      `^${spec
        .split('*')
        .map((part) => part.replace(/[.+^${}()|[\]\\?]/g, '\\$&'))
        .join('.*')}$`,
      's',
    ).test(command);
  }
  if (name === 'WebFetch' && spec.startsWith('domain:')) {
    try {
      const host = new URL(String(input.url ?? '')).hostname;
      const domain = spec.slice('domain:'.length);
      return host === domain || host.endsWith(`.${domain}`);
    } catch {
      return true;
    }
  }
  const file = [input.file_path, input.path, input.notebook_path].find(
    (value): value is string => typeof value === 'string' && !!value,
  );
  if (ruleTools[name] || file !== undefined) {
    if (file === undefined) return true;
    const absolute = path.resolve(root, file).split(path.sep).join('/');
    const pattern = spec.startsWith('//')
      ? spec.slice(1)
      : spec.startsWith('~/')
        ? `${home.split(path.sep).join('/')}/${spec.slice(2)}`
        : `${root.split(path.sep).join('/')}/${spec.replace(/^\.?\//, '')}`;
    // A pattern without a slash of its own matches a name at any depth, as in .gitignore.
    const loose = !spec.replace(/^\.?\//, '').includes('/') && !spec.startsWith('//');
    return (
      globPattern(pattern).test(absolute) ||
      (loose && globPattern(`**/${spec.replace(/^\.?\//, '')}`).test(absolute))
    );
  }
  return true;
}

/** The hooks of one Schema's `hooks` value, in file order. A malformed value is refused. */
export function schemaHooks(hooks: unknown, from: SchemaHook['from']): SchemaHook[] {
  if (hooks === undefined || hooks === null) return [];
  const strings = (value: unknown) =>
    Array.isArray(value) && value.every((item) => typeof item === 'string')
      ? (value as string[])
      : undefined;
  return readHooks(JSON.stringify({ hooks })).map(({ extra, ...entry }) => {
    const headers =
      extra.headers && typeof extra.headers === 'object' && !Array.isArray(extra.headers)
        ? Object.fromEntries(
            Object.entries(extra.headers as Record<string, unknown>).filter(
              (pair): pair is [string, string] => typeof pair[1] === 'string',
            ),
          )
        : undefined;
    return {
      event: entry.event,
      ...(entry.matcher !== undefined && { matcher: entry.matcher }),
      type: entry.type,
      command: entry.command,
      ...(strings(extra.args) && { args: strings(extra.args) }),
      ...(typeof extra.shell === 'string' && { shell: extra.shell }),
      ...(typeof extra.url === 'string' && { url: extra.url }),
      ...(headers && { headers }),
      ...(strings(extra.allowedEnvVars) && { allowedEnvVars: strings(extra.allowedEnvVars) }),
      ...(typeof extra.timeout === 'number' && extra.timeout > 0 && { timeout: extra.timeout }),
      ...(extra.async === true && { async: true }),
      ...(extra.asyncRewake === true && { asyncRewake: true }),
      ...(typeof extra.onFailure === 'string' && { onFailure: extra.onFailure }),
      ...(typeof extra.if === 'string' && { if: extra.if }),
      from,
    };
  });
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

const isFile = (file: string | undefined) => {
  try {
    return !!file && statSync(file).isFile();
  } catch {
    return false;
  }
};

/**
 * Where a hook's shell-form command runs, as Claude Code runs it: bash by
 * default (Git Bash on Windows), PowerShell when the hook names it or Windows
 * has no Git Bash; `sh` where a system has no bash.
 */
export function hookShell(
  command: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  shell?: string,
): [string, string[]] {
  const powershell = (): [string, string[]] => [
    platform === 'win32' ? 'powershell.exe' : 'pwsh',
    ['-NoProfile', '-NonInteractive', '-Command', command],
  ];
  if (shell === 'powershell') return powershell();
  if (platform !== 'win32') {
    const bash = (env.PATH ?? '')
      .split(':')
      .filter(Boolean)
      .map((dir) => path.posix.join(dir, 'bash'))
      .find(isFile);
    return [bash ?? '/bin/sh', ['-c', command]];
  }
  const bash = [
    env.CLAUDE_CODE_GIT_BASH_PATH,
    path.win32.join(env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
  ].find(isFile);
  return bash ? [bash, ['-c', command]] : powershell();
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

/** `$NAME` and `${NAME}` in an http hook's header, for the variables it lists; others become empty. */
function headerValue(value: string, allowed: string[], env: NodeJS.ProcessEnv) {
  return value.replace(/\$\{(\w+)\}|\$(\w+)/g, (_, braced: string, bare: string) => {
    const name = braced ?? bare;
    return allowed.includes(name) ? (env[name] ?? '') : '';
  });
}

/**
 * Runs the hooks of a Schema for one CLI run. `fields` are the input every event
 * carries besides its own (session id, folder, permission mode); `env` is the
 * run's environment, to which `CLAUDE_PROJECT_DIR` is added as Claude Code adds it.
 * `rewake` hears what an `asyncRewake` hook said with exit 2, for the agent.
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
      rewake?: (words: string) => void;
      home?: string;
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
  /** Hooks of a type irori cannot run (`prompt`, `agent`, `mcp_tool` need Claude Code's model or tools). */
  unrunnable() {
    return this.hooks.filter(
      (hook) => !(hook.type === 'command' && hook.command) && hook.type !== 'http',
    );
  }
  /** Stops every hook still running. */
  async stop() {
    await Promise.all([...this.children].map((child) => killTree(child).catch(() => {})));
  }
  /**
   * Runs the hooks of `event` whose matcher takes `match` (the tool's name, the
   * session's source …) and whose `if` takes the call, with `input`, all at once
   * as Claude Code does, a command named twice once; then reads what they decided.
   */
  async run(
    event: HookEvent,
    input: Record<string, unknown>,
    match?: { value: string; also?: string[] },
  ): Promise<HookOutcome> {
    const outcome: HookOutcome = { context: [], notices: [] };
    const toolInput = isObject(input.tool_input) ? input.tool_input : {};
    const chosen = this.hooks.filter(
      (hook) =>
        hook.event === event &&
        (!matched.has(event) || !match || matcherTakes(hook.matcher, match.value, match.also)) &&
        (hook.if === undefined ||
          (ruled.has(event) &&
            !!match &&
            ruleTakes(
              hook.if,
              { name: match.value, also: match.also, input: toolInput },
              this.options.cwd,
              this.options.home ?? os.homedir(),
            ))),
    );
    const seen = new Set<string>();
    const unique = chosen.filter((hook) => {
      const key = JSON.stringify([hook.type, hook.command, hook.args, hook.url]);
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
    // Background hooks decide nothing; one that wakes the agent says so with exit 2.
    for (const hook of unique.filter((item) => item.async || item.asyncRewake))
      void this.one(hook, event, body).then((finished) => {
        if (hook.asyncRewake && finished.code === 2)
          this.options.rewake?.(cut(finished.stderr.trim() || finished.stdout.trim()));
      });
    const waited = unique.filter((item) => !item.async && !item.asyncRewake);
    const budget = event === 'SessionEnd' ? this.sessionEndBudget(waited) : undefined;
    const results = await Promise.all(
      waited.map(async (hook) => ({ hook, finished: await this.one(hook, event, body, budget) })),
    );
    const reasons: string[] = [];
    const asks: string[] = [];
    for (const { hook, finished } of results) {
      const label = `${event}${hook.matcher ? ` (${hook.matcher})` : ''}`;
      const stdout = finished.stdout.trim();
      let json: Record<string, unknown> | undefined;
      let invalid = false;
      if (!finished.error && finished.code === 0 && stdout.startsWith('{'))
        try {
          const parsed: unknown = JSON.parse(stdout);
          if (isObject(parsed)) json = parsed;
        } catch {
          invalid = true;
        }
      const failure =
        finished.error ??
        (finished.code !== 0 && finished.code !== 2
          ? `failed with non-blocking status code ${finished.code}${
              firstLine(finished.stderr) ? `: ${firstLine(finished.stderr)}` : ''
            }`
          : invalid
            ? 'answered with JSON that could not be read'
            : undefined);
      // A failure of a hook set to block acts as exit 2, as in Claude Code.
      const failed =
        failure !== undefined &&
        hook.onFailure === 'block' &&
        event !== 'Stop' &&
        event !== 'SubagentStop';
      if (failure !== undefined && !failed) {
        outcome.notices.push(`${label}: ${failure}`);
        continue;
      }
      if (finished.code === 2 || failed) {
        const reason = cut(
          (failed ? failure : finished.stderr.trim()) || `${label} hook exited with 2`,
        );
        if (event === 'PermissionRequest') {
          if (failed) outcome.decision = { behavior: 'deny', message: reason };
        } else if (feedback.has(event)) outcome.context.push(reason);
        else if (blocking.has(event)) reasons.push(reason);
        else outcome.notices.push(`${label}: ${reason}`);
        continue;
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
      } else if (feedback.has(event)) {
        if (json.decision === 'block')
          outcome.context.push(cut(reason || `${label} hook feedback`));
        if ('updatedToolOutput' in specific) outcome.output = specific.updatedToolOutput;
      } else if (event === 'PermissionRequest') {
        const decision = isObject(specific.decision) ? specific.decision : undefined;
        if (decision?.behavior === 'deny')
          outcome.decision = {
            behavior: 'deny',
            ...(typeof decision.message === 'string' && { message: decision.message }),
          };
        else if (decision?.behavior === 'allow' && outcome.decision?.behavior !== 'deny')
          outcome.decision = {
            behavior: 'allow',
            ...(isObject(decision.updatedInput) && { input: decision.updatedInput }),
          };
      } else if (json.decision === 'block' && blocking.has(event)) {
        reasons.push(cut(reason || `A ${label} hook blocked this.`));
      }
    }
    if (reasons.length) outcome.blocked = reasons.join('\n');
    else if (asks.length) outcome.ask = asks.join('\n');
    return outcome;
  }
  /**
   * How long SessionEnd hooks have, together: 1.5 s, or
   * `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS`, raised to the longest timeout a
   * hook gives itself, at most 60 s.
   */
  private sessionEndBudget(hooks: SchemaHook[]) {
    const set = Number(this.options.env.CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS);
    const base = Number.isFinite(set) && set > 0 ? set : sessionEndDefault;
    const longest = Math.max(0, ...hooks.map((hook) => (hook.timeout ?? 0) * 1000));
    return AbortSignal.timeout(Math.min(sessionEndMost, Math.max(base, longest)));
  }
  private async one(
    hook: SchemaHook,
    event: HookEvent,
    body: string,
    budget?: AbortSignal,
  ): Promise<Finished> {
    const set = Number(this.options.env.CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS);
    const seconds =
      hook.timeout ??
      (event === 'UserPromptSubmit'
        ? promptTimeout
        : event === 'SessionEnd'
          ? (Number.isFinite(set) && set > 0 ? set : sessionEndDefault) / 1000
          : defaultTimeout);
    // A run that is stopping still ends its session: SessionEnd keeps its own budget.
    const signals = [
      AbortSignal.timeout(seconds * 1000),
      budget,
      event === 'SessionEnd' ? undefined : this.options.signal,
    ].filter((signal): signal is AbortSignal => !!signal);
    const signal = AbortSignal.any(signals);
    if (signal.aborted)
      return { code: null, stdout: '', stderr: '', error: 'stopped before it ran' };
    if (hook.type === 'http') return this.http(hook, body, signal, seconds);
    if (hook.type !== 'command' || !hook.command)
      return {
        code: null,
        stdout: '',
        stderr: '',
        error: `irori runs command and http hooks only; this ${hook.type} hook did not run`,
      };
    const env = {
      ...this.options.env,
      CLAUDE_PROJECT_DIR: this.options.cwd,
      IRORI_HOOK_CLI: this.options.agent,
    };
    // The exec form runs the command itself with its arguments; the shell form, in a shell.
    const [file, args] = hook.args
      ? [hook.command, hook.args]
      : hookShell(hook.command, process.platform, this.options.env, hook.shell);
    let child: ChildProcess;
    try {
      child = launch(file, args, this.options.cwd, env);
    } catch (error) {
      return { code: null, stdout: '', stderr: '', error: `could not start: ${String(error)}` };
    }
    this.children.add(child);
    const stdout = collect(child.stdout);
    const stderr = collect(child.stderr);
    child.stdin?.on('error', () => {}); // A hook that does not read its input may exit first.
    child.stdin?.end(body);
    const stop = () => void killTree(child).catch(() => {});
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
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
            budget?.aborted || (event !== 'SessionEnd' && this.options.signal?.aborted)
              ? 'stopped before it finished'
              : `timed out after ${seconds} s`,
        };
      return { code, stdout: stdout(), stderr: stderr() };
    } catch (error) {
      return { code: null, stdout: '', stderr: '', error: `could not start: ${String(error)}` };
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
    const allowed = hook.allowedEnvVars ?? [];
    try {
      const response = await fetch(hook.url, {
        method: 'POST',
        headers: {
          ...Object.fromEntries(
            Object.entries(hook.headers ?? {}).map(([name, value]) => [
              name,
              headerValue(value, allowed, this.options.env),
            ]),
          ),
          'content-type': 'application/json',
        },
        body,
        signal,
        redirect: 'error',
      });
      const text = (await response.text()).slice(0, outputLimit);
      return response.ok
        ? { code: 0, stdout: text, stderr: '' }
        : { code: null, stdout: '', stderr: '', error: `answered HTTP ${response.status}` };
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
