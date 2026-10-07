import { StringDecoder } from 'node:string_decoder';
import { launch } from './process';
import { Tail } from './tail';
import type { NativeContext } from './adapter';
import { t } from '../domain/i18n';

/** A session id Hermes printed, safe to hand back to it as an argument. */
const sessionId = /^\w[\w.:-]{0,199}$/;

/** The text a stream-json record carries, under whichever name it uses. */
function textOf(event: Record<string, unknown>) {
  const value = event.text ?? event.delta ?? event.content;
  return typeof value === 'string' ? value : '';
}

/**
 * One Hermes Agent turn: `hermes chat --query-file - --format stream-json`.
 * The prompt goes through stdin, which has no command-line length limit and is
 * never shell-interpreted. stdout is one JSON object per line (`system` init,
 * `text` deltas, `tool_use`, `tool_result`, one final `result`); stderr carries
 * diagnostics. A one-shot run cannot ask the person: dangerous commands follow
 * Hermes's `approvals.single_query_mode`, or run with `--yolo` in full access.
 */
export async function runHermes(ctx: NativeContext) {
  if (ctx.session && !sessionId.test(ctx.session)) throw Error('Invalid saved Hermes session');
  ctx.signal.throwIfAborted();
  const child = launch(
    'hermes',
    [
      'chat',
      '--query-file',
      '-',
      '--format',
      'stream-json',
      ...(ctx.session ? ['--resume', ctx.session] : []),
      ...(ctx.model ? ['-m', ctx.model] : []),
      ...(ctx.access === 'full-access' ? ['--yolo'] : []),
    ],
    ctx.cwd,
    ctx.env,
  );
  ctx.child(child);
  let saved = ctx.session;
  let saving = Promise.resolve();
  const save = (value: unknown) => {
    if (typeof value !== 'string' || !sessionId.test(value) || value === saved) return;
    saved = value;
    saving = saving.then(() => ctx.saveSession(value));
  };
  let streamed = false;
  let result: Record<string, unknown> | undefined;
  const stderr = new Tail(6000);
  child.stderr!.on('data', (chunk) => stderr.add(String(chunk)));
  const receive = (line: string) => {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line);
    } catch {
      return; // Not a protocol record; stdout is meant to hold only records.
    }
    if (!event || typeof event !== 'object' || Array.isArray(event)) return;
    if (event.type === 'system' && event.subtype === 'init') save(event.session_id);
    if (event.type === 'text') {
      const text = textOf(event);
      if (text) {
        streamed = true;
        ctx.event('text', text);
      }
    }
    if (event.type === 'tool_use' || event.type === 'tool_result')
      ctx.event('tool', String(event.name ?? t('Hermes のツール', 'Hermes tool')), {
        details: JSON.stringify(event),
        call: typeof event.tool_call_id === 'string' ? event.tool_call_id : undefined,
        result: event.type === 'tool_result' || undefined,
      });
    if (event.type === 'result') {
      result = event;
      save(event.session_id);
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
    child.stdin!.end(ctx.prompt);
  });
  await saving;
  ctx.signal.throwIfAborted();
  if (!result)
    throw Error(
      t(
        `Hermes Agent が結果を返さずに終了しました（${exit}）: ${stderr.toString().trim()}`,
        `Hermes Agent ended without a result (${exit}): ${stderr.toString().trim()}`,
      ),
    );
  // The final answer is shown when no delta carried it.
  const final = textOf(result);
  if (!streamed && final) ctx.event('text', final);
  const code = typeof result.exit_code === 'number' ? result.exit_code : exit;
  if (result.error || code !== 0)
    throw Error(
      typeof result.error === 'string' && result.error
        ? result.error
        : t(`Hermes Agent が失敗しました（${code}）`, `Hermes Agent failed (${code})`),
    );
}
