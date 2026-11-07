import path from 'node:path';
import { createHash } from 'node:crypto';
import { chmod, mkdir, readdir, rm } from 'node:fs/promises';
import writeFileAtomic from 'write-file-atomic';
import { commandLaunchers, loopbackServer } from './command-bridge';
import { hookUnreachable, hookUnreachableAfter, hookUnreadable } from '../../prompts';

/**
 * How the tool events of a CLI reach the Schema's hooks irori runs (ADR 058).
 * Pi and OpenCode let a script of theirs see each tool call before and after it
 * runs; irori gives them one from its data directory, never the folder, that
 * asks irori over a loopback URL only that process knows, and does what irori
 * answers: stop the call with a reason the model reads, change its input, add to
 * its result. A call irori cannot be asked about does not run: a hook may be a
 * guard, and a guard that cannot be asked must not be passed.
 */

/** What a CLI's script asks about one event. */
export interface BridgeEvent {
  event:
    | 'PreToolUse'
    | 'PostToolUse'
    | 'PostToolUseFailure'
    | 'PreCompact'
    | 'SubagentStart'
    | 'SubagentStop';
  /** The CLI's own tool name and input. */
  tool?: string;
  input?: unknown;
  /** The call's id, when the CLI gives one. */
  call?: string;
  /** PostToolUse: the tool's result as the CLI holds it. */
  output?: unknown;
  /** PreCompact: `manual` or `auto`, and the compaction's own instructions. */
  trigger?: string;
  instructions?: string;
}

/**
 * The longest event a CLI's script or hook hands irori, in characters: a tool's
 * whole input and output, as Claude Code gives its hooks. A longer one is cut
 * and cannot be read; a PreToolUse event irori cannot read stops its call.
 */
const bridgeBodyLimit = 64_000_000;

/** irori's answer: stop with a reason, a new input, words to add to the result, or a result instead. */
export interface BridgeAnswer {
  block?: string;
  input?: Record<string, unknown>;
  feedback?: string;
  output?: string;
}

const ask = `const ask = async (body) => {
  const response = await fetch(process.env.IRORI_SCHEMA_HOOKS, {
    method: 'POST',
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(3600000),
  });
  if (!response.ok) throw new Error('irori answered ' + response.status);
  return response.json();
};
const unreachable = ${JSON.stringify(hookUnreachable)};
const unreachableAfter = ${JSON.stringify(hookUnreachableAfter)};
const replaceInput = (target, input) => {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, input);
};
`;

export const hookBridgeScripts: Record<'pi' | 'opencode', string> = {
  opencode: '',
  pi: `${ask}
export default function (pi) {
  pi.on('tool_call', async (event) => {
    let reply;
    try {
      reply = await ask({ event: 'PreToolUse', tool: event.toolName, input: event.input, call: event.toolCallId });
    } catch {
      return { block: true, reason: unreachable };
    }
    if (reply.block) return { block: true, reason: reply.block };
    if (reply.input) replaceInput(event.input, reply.input);
  });
  pi.on('tool_result', async (event) => {
    let reply;
    try {
      reply = await ask(
        event.isError
          ? {
              event: 'PostToolUseFailure',
              tool: event.toolName,
              input: event.input,
              call: event.toolCallId,
              output: (event.content || []).map((part) => part.text || '').join('\\n'),
            }
          : { event: 'PostToolUse', tool: event.toolName, input: event.input, call: event.toolCallId, output: event.content },
      );
    } catch {
      return { content: [...event.content, { type: 'text', text: unreachableAfter }], structuredContent: event.structuredContent };
    }
    if (!reply.feedback && reply.output === undefined) return;
    const content = reply.output === undefined ? [...event.content] : [{ type: 'text', text: reply.output }];
    if (reply.feedback) content.push({ type: 'text', text: reply.feedback });
    return reply.output === undefined ? { content, structuredContent: event.structuredContent } : { content };
  });
  pi.on('session_before_compact', async (event) => {
    try {
      const reply = await ask({ event: 'PreCompact', trigger: event.reason === 'manual' ? 'manual' : 'auto', instructions: event.customInstructions });
      if (reply.block) return { cancel: true };
    } catch {
      return { cancel: true };
    }
  });
}
`,
};

// OpenCode: a thrown error stops a call and is what the model reads as its result;
// the arguments are changed in place, the result by changing its output.
hookBridgeScripts.opencode = `${ask}
export const IroriSchemaHooks = async () => {
  // irori hears that OpenCode loaded the plugin: a tool call before that stops the run.
  await ask({ event: 'Loaded' }).catch(() => {});
  return {
  'tool.execute.before': async (input, output) => {
    let reply;
    try {
      reply = await ask({ event: 'PreToolUse', tool: input.tool, input: output.args, call: input.callID });
    } catch {
      throw new Error(unreachable);
    }
    if (reply.block) throw new Error(reply.block);
    if (reply.input) replaceInput(output.args, reply.input);
  },
  'tool.execute.after': async (input, output) => {
    let reply;
    try {
      reply = await ask({
        event: 'PostToolUse',
        tool: input.tool,
        input: input.args,
        call: input.callID,
        output: typeof output.output === 'string' ? output.output : output.content,
      });
    } catch {
      reply = { feedback: unreachableAfter };
    }
    if (reply.output !== undefined && typeof output.output === 'string') output.output = reply.output;
    if (!reply.feedback) return;
    if (typeof output.output === 'string') output.output = output.output + '\\n\\n' + reply.feedback;
    else if (Array.isArray(output.content)) output.content.push({ type: 'text', text: reply.feedback });
  },
  'experimental.session.compacting': async (input, output) => {
    const reply = await ask({ event: 'PreCompact', trigger: 'auto' }).catch(() => ({}));
    if (reply.feedback && Array.isArray(output.context)) output.context.push(reply.feedback);
  },
  };
};
`;

export type HookBridgeAgent = keyof typeof hookBridgeScripts;

/**
 * Serves one run's hook events. `answer` gets each event as the CLI's script
 * sent it; an event it cannot answer is answered with a stop for the call.
 */
export async function hookBridge(
  dataDir: string,
  agent: HookBridgeAgent,
  answer: (event: BridgeEvent) => Promise<BridgeAnswer>,
  env: NodeJS.ProcessEnv,
) {
  const file = path.join(dataDir, 'agents', `schema-hooks-${agent}.js`);
  await mkdir(path.dirname(file), { recursive: true });
  // Replaced whole: another run's CLI may be loading it at this moment.
  await writeFileAtomic(file, hookBridgeScripts[agent]);
  const state = { heard: false };
  const server = await loopbackServer(bridgeBodyLimit, async (body, response, found) => {
    if (!found) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end('{}');
      return;
    }
    let reply: BridgeAnswer;
    try {
      state.heard = true;
      const event = JSON.parse(body) as BridgeEvent | { event: 'Loaded' };
      reply = event.event === 'Loaded' ? {} : await answer(event);
    } catch (error) {
      reply = { block: `${hookUnreachable} (${String(error)})` };
    }
    if (!response.destroyed) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(reply));
    }
  });
  env = { ...env, IRORI_SCHEMA_HOOKS: server.url };
  if (agent === 'opencode') {
    // OpenCode reads a plugin from an absolute path named in this variable's
    // JSON, merged after its own files; plugins already named there stay.
    const content = JSON.parse(env.OPENCODE_CONFIG_CONTENT ?? '{}');
    env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
      ...content,
      plugin: [...(content.plugin ?? []), file],
    });
  }
  return { env, args: agent === 'pi' ? ['-e', file] : [], state, close: server.close };
}

/** The forwarder answers for itself this long after it started, before `forwardTimeout`. */
const forwardDeadline = 3540;

// Codex and the Antigravity CLI run hooks of their own, configured in files.
// irori gives each run hooks that hand every event to this forwarder, which
// passes it to irori and prints irori's answer in that CLI's shape. irori out of
// reach stops a tool call.
const forwarder = `'use strict';
const http = require('node:http');
const [cli, event, address] = process.argv.slice(2);
const stopped = ${JSON.stringify(hookUnreachable)};
const closed = event !== 'PreToolUse'
  ? '{}'
  : cli === 'codex'
    ? JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: stopped } })
    : JSON.stringify({ decision: 'deny', reason: stopped });
// Answer before the CLI gives up on this hook, which would let a call through.
setTimeout(() => {
  process.stdout.write(closed);
  process.exit(0);
}, ${forwardDeadline * 1000}).unref();
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  const body = JSON.stringify({ event, payload: input });
  const request = http.request(
    address,
    { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } },
    (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => (text += chunk));
      response.on('end', () => process.stdout.write(response.statusCode === 200 && text ? text : closed));
    },
  );
  request.on('error', () => process.stdout.write(closed));
  request.end(body);
});
`;

/**
 * How long a CLI gives irori's forwarding hook for a tool event (seconds), and
 * how long the forwarder waits for irori before it stops the call itself: a CLI
 * whose hook timed out would let the call run (ADR 058).
 */
export const forwardTimeout = 3600;

/** Writes the forwarder and its launcher once; returns the launcher as a quoted shell word. */
async function forwarderCommand(dataDir: string, runtime: string) {
  const tools = path.join(dataDir, 'agents', 'schema-hooks-forward');
  await mkdir(tools, { recursive: true, mode: 0o700 });
  const script = path.join(tools, 'forward.cjs');
  // Replaced whole: another run's CLI may be starting from them at this moment.
  await writeFileAtomic(script, forwarder, { mode: 0o600 });
  const launchers = commandLaunchers('hands a CLI hook event to irori.', runtime, script);
  const windows = process.platform === 'win32';
  const launcher = path.join(tools, windows ? 'forward.cmd' : 'forward');
  await writeFileAtomic(launcher, windows ? launchers.windows : launchers.posix, { mode: 0o700 });
  if (!windows) await chmod(launcher, 0o700);
  return windows ? `"${launcher}"` : `'${launcher.replaceAll("'", `'\\''`)}'`;
}

/** Codex's names for the events irori hands it, as its hook trust keys spell them. */
const codexLabels: Record<string, string> = {
  UserPromptSubmit: 'user_prompt_submit',
  PreToolUse: 'pre_tool_use',
  PostToolUse: 'post_tool_use',
  PreCompact: 'pre_compact',
  SubagentStart: 'subagent_start',
  SubagentStop: 'subagent_stop',
};

/** JSON with every object's keys sorted, as Codex fingerprints a hook. */
function sortedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${sortedJson((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

/**
 * The trust Codex keeps for one hook given through a run's configuration: the
 * key it files the hook under and the hash of the hook as it normalizes it
 * (codex-rs hooks/src/engine/discovery.rs, `hook_hash`; 0.160 to 0.167). irori
 * checks with `hooks/list` that Codex took them as trusted before a turn starts.
 */
export function codexHookTrust(
  event: string,
  handler: { type: 'command'; command: string; timeout: number },
  platform: NodeJS.Platform = process.platform,
  matcher?: string,
) {
  const label = codexLabels[event];
  const source =
    platform === 'win32' ? 'C:\\<session-flags>\\config.toml' : '/<session-flags>/config.toml';
  const identity = {
    event_name: label,
    ...(matcher !== undefined && { matcher }),
    hooks: [{ ...handler, async: false }],
  };
  return {
    key: `${source}:${label}:0:0`,
    hash: `sha256:${createHash('sha256').update(sortedJson(identity)).digest('hex')}`,
  };
}

/**
 * Codex's configuration for one run: a hook per event that hands it to irori,
 * each marked trusted by its own hash, so Codex runs them without passing over
 * the trust it keeps for every other hook. `trust` replaces the computed trust
 * with what Codex reported (`hooks/list`), when it computes it otherwise.
 */
export function codexHookConfig(
  launcher: string,
  url: string,
  events: string[],
  trust?: Map<string, { key: string; hash: string }>,
) {
  const hooks: Record<string, unknown> = {};
  const state: Record<string, { trusted_hash: string }> = {};
  for (const event of events) {
    const handler = {
      type: 'command' as const,
      command: `${launcher} codex ${event} ${url}`,
      timeout: event === 'UserPromptSubmit' ? 60 : forwardTimeout,
    };
    hooks[event] = [{ hooks: [handler] }];
    const known = trust?.get(event) ?? codexHookTrust(event, handler);
    state[known.key] = { trusted_hash: known.hash };
  }
  return { hooks: { ...hooks, state } };
}

const isRecord = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** irori's side of the events a CLI's own hooks hand it (Codex, the Antigravity CLI). */
export class ForwardedHooks {
  /** The CLI has handed irori an event in this run: its hooks are loaded. */
  heard = false;
  private pending: string[] = [];
  constructor(
    private cli: 'codex' | 'antigravity',
    private answer: (event: BridgeEvent) => Promise<BridgeAnswer>,
  ) {}
  async handle(event: string, payload: string): Promise<Record<string, unknown>> {
    this.heard = true;
    let data: Record<string, any> = {};
    try {
      const parsed: unknown = payload.trim() ? JSON.parse(payload) : {};
      if (isRecord(parsed)) data = parsed;
    } catch {
      // An event irori cannot read changes nothing but a tool call, which it stops.
      return event === 'PreToolUse' ? this.deny(hookUnreadable) : {};
    }
    return this.cli === 'codex' ? this.codex(event, data) : this.antigravity(event, data);
  }
  private deny(reason: string) {
    return this.cli === 'codex'
      ? {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: reason,
          },
        }
      : { decision: 'deny', reason };
  }
  private async codex(event: string, data: Record<string, any>) {
    const call = typeof data.tool_use_id === 'string' ? data.tool_use_id : undefined;
    if (event === 'PreToolUse') {
      const reply = await this.answer({
        event,
        tool: data.tool_name,
        input: data.tool_input,
        call,
      });
      if (reply.block) return this.deny(reply.block);
      return reply.input
        ? {
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'allow',
              updatedInput: reply.input,
            },
          }
        : {};
    }
    if (event === 'PostToolUse') {
      const reply = await this.answer({
        event,
        tool: data.tool_name,
        input: data.tool_input,
        call,
        output: data.tool_response,
      });
      return reply.feedback
        ? {
            hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: reply.feedback },
          }
        : {};
    }
    if (event === 'PreCompact') {
      await this.answer({ event, trigger: data.trigger, instructions: data.custom_instructions });
      return {};
    }
    if (event === 'SubagentStop') {
      const reply = await this.answer({ event, input: data });
      return reply.block ? { decision: 'block', reason: reply.block } : {};
    }
    if (event === 'SubagentStart') {
      const reply = await this.answer({ event, input: data });
      return reply.feedback
        ? {
            hookSpecificOutput: {
              hookEventName: 'SubagentStart',
              additionalContext: reply.feedback,
            },
          }
        : {};
    }
    return {};
  }
  private async antigravity(event: string, data: Record<string, any>) {
    const call = isRecord(data.toolCall) ? data.toolCall : {};
    const id = data.stepIdx === undefined ? undefined : String(data.stepIdx);
    if (event === 'PreToolUse') {
      const reply = await this.answer({ event, tool: call.name, input: call.args, call: id });
      if (reply.block) return this.deny(reply.block);
      return { decision: 'allow', ...(reply.input && { overwrite: reply.input }) };
    }
    if (event === 'PostToolUse') {
      const reply = await this.answer({
        event,
        tool: call.name,
        input: call.args,
        call: id,
        output: { error: typeof data.error === 'string' ? data.error : '' },
      });
      // The CLI takes nothing back after a tool; the words go before the next model call.
      if (reply.feedback) this.pending.push(reply.feedback);
      return {};
    }
    if (event === 'PreInvocation') {
      const words = this.pending.splice(0);
      return words.length ? { injectSteps: words.map((text) => ({ ephemeralMessage: text })) } : {};
    }
    return {};
  }
}

/**
 * Serves the events one run's CLI hooks hand irori. `launcher` is the forwarder
 * the CLI's hooks run; the CLI is given hooks that name it with `url`.
 */
export async function forwardedHookBridge(
  dataDir: string,
  cli: 'codex' | 'antigravity',
  answer: (event: BridgeEvent) => Promise<BridgeAnswer>,
  runtime = process.execPath,
) {
  const state = new ForwardedHooks(cli, answer);
  const launcher = await forwarderCommand(dataDir, runtime);
  const server = await loopbackServer(bridgeBodyLimit, async (body, response, found) => {
    let reply: Record<string, unknown> = {};
    let status = 200;
    try {
      if (!found) throw Error('Not found');
      const { event, payload } = JSON.parse(body) as { event?: unknown; payload?: unknown };
      reply = await state.handle(String(event), typeof payload === 'string' ? payload : '');
    } catch {
      status = 404;
    }
    if (!response.destroyed) {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(reply));
    }
  });
  return { state, launcher, url: server.url, close: server.close };
}

/**
 * The Antigravity CLI reads hooks from a workspace folder's `.agents/hooks.json`
 * and takes none for one run; irori makes the run a folder of its own in its data
 * directory, given with `--add-dir` (the CLI reads `.agents/` in every workspace
 * folder), whose hooks hand each event to the forwarder.
 */
export async function antigravityHookFolder(
  dataDir: string,
  runId: string,
  launcher: string,
  url: string,
) {
  const folder = path.join(dataDir, 'agy-hooks', runId);
  await mkdir(path.join(folder, '.agents'), { recursive: true, mode: 0o700 });
  const hook = (event: string, timeout: number, matcher?: string) => [
    {
      ...(matcher && { matcher }),
      hooks: [{ type: 'command', command: `${launcher} antigravity ${event} ${url}`, timeout }],
    },
  ];
  await writeFileAtomic(
    path.join(folder, '.agents', 'hooks.json'),
    JSON.stringify(
      {
        'irori-schema-hooks': {
          SessionStart: hook('SessionStart', 60),
          PreInvocation: hook('PreInvocation', 60),
          PreToolUse: hook('PreToolUse', forwardTimeout, '.*'),
          PostToolUse: hook('PostToolUse', forwardTimeout, '.*'),
        },
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  return folder;
}

/** Removes the folders of hooks runs left that did not end (a crash); `live` says which runs go on. */
export async function pruneAntigravityHookFolders(
  dataDir: string,
  live: (runId: string) => boolean,
) {
  const root = path.join(dataDir, 'agy-hooks');
  for (const name of await readdir(root).catch(() => [] as string[]))
    if (!live(name)) await rm(path.join(root, name), { recursive: true, force: true });
}
