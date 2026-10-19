import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { launch } from './process';
import { Tail } from './tail';
import type { NativeContext } from './adapter';
import { t } from '../domain/i18n';

/** A conversation id the CLI printed, safe to hand back to it as an argument. */
const conversationId = /^\w[\w.:-]{0,199}$/;

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/**
 * The arguments of one Antigravity CLI (`agy`) turn. `--input-format
 * stream-json` reads the prompt from stdin, so it has no command-line length
 * limit and is never shell-interpreted. `--add-dir` makes the checkout the
 * workspace: without it the CLI's tools work in its own scratch folder.
 * `--disable-slash-commands` keeps a prompt starting with `/` from ending the
 * session. Standard access is `--mode accept-edits` (workspace file edits;
 * commands are denied, since a headless run cannot ask) and full access
 * `--dangerously-skip-permissions`.
 */
export function antigravityArgs(
  ctx: Pick<NativeContext, 'cwd' | 'session' | 'model' | 'access' | 'attached'>,
) {
  // An attached file outside the checkout is read through its own folder.
  const folders = [
    ...new Set(
      (ctx.attached ?? []).map((file) => path.dirname(file.path)).filter((dir) => dir !== ctx.cwd),
    ),
  ];
  return [
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--disable-slash-commands',
    '--add-dir',
    ctx.cwd,
    ...folders.flatMap((dir) => ['--add-dir', dir]),
    ...(ctx.model ? ['--model', ctx.model] : []),
    ...(ctx.access === 'full-access'
      ? ['--dangerously-skip-permissions']
      : ['--mode', 'accept-edits']),
    ...(ctx.session ? ['--conversation', ctx.session] : []),
  ];
}

/**
 * One Antigravity CLI turn. stdin carries one `user` event and is then closed,
 * so the CLI runs that turn and exits. stdout is one JSON object per line: an
 * `init` (`conversation_id`), `step_update`s (`text_delta` for the reply,
 * `tool_info` for a tool call) and one final `result` (`status`, `response`,
 * `denied_actions`); stderr carries diagnostics such as a sign-in request.
 */
export async function runAntigravity(ctx: NativeContext) {
  if (ctx.session && !conversationId.test(ctx.session))
    throw Error('Invalid saved Antigravity conversation');
  ctx.signal.throwIfAborted();
  const child = launch('agy', antigravityArgs(ctx), ctx.cwd, ctx.env);
  ctx.child(child);
  let saved = ctx.session;
  let saving = Promise.resolve();
  // The conversation this turn is in; a sub-agent's steps carry another id.
  let own: string | undefined;
  const save = (value: unknown) => {
    if (typeof value !== 'string' || !conversationId.test(value)) return;
    own ??= value;
    if (value !== own || value === saved) return;
    saved = value;
    saving = saving.then(() => ctx.saveSession(value));
  };
  let streamed = false;
  let result: Record<string, unknown> | undefined;
  const stderr = new Tail(6000);
  child.stderr!.on('data', (chunk) => stderr.add(String(chunk)));
  const receive = (line: string) => {
    let event: Record<string, unknown> | undefined;
    try {
      event = record(JSON.parse(line));
    } catch {
      return; // Not a protocol record; stdout is meant to hold only records.
    }
    if (!event) return;
    if (event.event === 'init') save(event.conversation_id);
    const step = record(event.step_update);
    if (event.event === 'step_update' && step) {
      save(step.conversation_id);
      if (step.conversation_id !== undefined && step.conversation_id !== own) return;
      if (step.step_type === 'agent_response' && typeof step.text_delta === 'string') {
        if (step.text_delta) {
          streamed = true;
          ctx.event('text', step.text_delta);
        }
      }
      const tool = record(step.tool_info);
      if (step.step_type === 'tool' && tool) {
        const name = tool.name ?? step.tool_name;
        ctx.event('tool', String(name ?? t('Antigravity のツール', 'Antigravity tool')), {
          details: JSON.stringify(tool),
          call: typeof step.step_index === 'number' ? `step-${step.step_index}` : undefined,
          result: step.state !== 'ACTIVE' || undefined,
        });
      }
    }
    const final = record(event.result);
    if (event.event === 'result' && final) {
      result = final;
      save(final.conversation_id);
    }
  };
  const exit = await new Promise<number | null>((resolve, reject) => {
    const decoder = new StringDecoder('utf8');
    let buffer = '';
    child.stdout!.on('data', (chunk: Buffer) => {
      buffer += decoder.write(chunk);
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) receive(line);
      }
      if (buffer.length > 8 * 1024 * 1024) {
        buffer = '';
        reject(Error('Agent protocol record exceeds limit'));
      }
    });
    child.on('error', reject);
    child.on('close', (code) => {
      const rest = (buffer + decoder.end()).trim();
      if (rest) receive(rest);
      resolve(code);
    });
    child.stdin!.on('error', () => {}); // A process that exits early closes its stdin.
    child.stdin!.end(JSON.stringify({ event: 'user', message: { content: ctx.prompt } }) + '\n');
  });
  await saving;
  ctx.signal.throwIfAborted();
  const diagnostics = stderr.toString().trim();
  // Headless runs use the sign-in of an earlier interactive `agy`; without one they end at once.
  if (
    /authentication required|please sign in|authentication failed/i.test(
      `${diagnostics}\n${typeof result?.error === 'string' ? result.error : ''}`,
    )
  )
    throw Error(
      t(
        'Antigravity CLI にサインインしていません。ターミナルで `agy` を一度起動し、Google アカウントでサインインしてください。',
        'The Antigravity CLI is not signed in. Run `agy` once in a terminal and sign in with your Google account.',
      ),
    );
  if (!result)
    throw Error(
      t(
        `Antigravity CLI が結果を返さずに終了しました（${exit}）: ${diagnostics}`,
        `The Antigravity CLI ended without a result (${exit}): ${diagnostics}`,
      ),
    );
  // The final answer is shown when no delta carried it.
  if (!streamed && typeof result.response === 'string' && result.response)
    ctx.event('text', result.response);
  // A headless run cannot ask: what it was not allowed to do, it left undone.
  const denied = Array.isArray(result.denied_actions)
    ? [
        ...new Set(
          result.denied_actions
            .map((item) => record(item)?.display_name ?? record(item)?.action)
            .filter((name): name is string => typeof name === 'string' && !!name),
        ),
      ]
    : [];
  if (denied.length)
    ctx.event(
      'status',
      t(
        `許可されていない操作は行いませんでした: ${denied.join(', ')}。フルアクセスにするか、Antigravity CLI の permissions.allow で許可してください。`,
        `Actions it was not allowed to take were left undone: ${denied.join(', ')}. Choose full access, or allow them in the Antigravity CLI's permissions.allow.`,
      ),
    );
  if (result.status !== 'SUCCESS' || (exit !== 0 && exit !== null))
    throw Error(
      typeof result.error === 'string' && result.error
        ? result.error
        : t(
            `Antigravity CLI が失敗しました（${String(result.status)}, ${exit}）`,
            `The Antigravity CLI failed (${String(result.status)}, ${exit})`,
          ),
    );
}
