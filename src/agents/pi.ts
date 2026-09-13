import { promises as fs } from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { ChildProcess } from 'node:child_process';
import { launch, version } from './process';
import type { NativeContext } from './adapter';

// Pi uses LF-delimited JSON, not JSON-RPC. Bound partial records before parsing.
export class PiRpc {
  private next = 0;
  private pending = new Map<
    string,
    { resolve(v: any): void; reject(e: Error): void; timer: NodeJS.Timeout }
  >();
  private dead = false;
  constructor(
    readonly child: ChildProcess,
    incoming: (event: any) => void,
    failure: (error: Error) => void,
    signal: AbortSignal,
  ) {
    let buffer = '';
    const decoder = new StringDecoder('utf8');
    const fail = (error: Error) => {
      if (!this.dead) {
        this.fail(error);
        failure(error);
      }
    };
    child.stdout!.on('data', (chunk: Buffer) => {
      if (this.dead) return;
      buffer += decoder.write(chunk);
      if (buffer.length > 8 * 1024 * 1024) return fail(Error('Pi protocol record exceeds limit'));
      let index: number;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, '');
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        try {
          const event = JSON.parse(line);
          if (!event || typeof event.type !== 'string') throw Error('Missing event type');
          if (event.type === 'response') {
            const pending = this.pending.get(event.id);
            if (pending) {
              this.pending.delete(event.id);
              clearTimeout(pending.timer);
              event.success === true
                ? pending.resolve(event.data)
                : pending.reject(Error(String(event.error ?? 'Pi request failed')));
            }
          } else incoming(event);
        } catch {
          fail(Error('Pi returned an invalid protocol record'));
          return;
        }
      }
    });
    child.stderr?.resume();
    child.on('error', fail);
    child.stdin!.on('error', fail);
    child.on('close', (code) => fail(Error(`Pi exited before completion (${code})`)));
    signal.addEventListener('abort', () => fail(Error('Pi run cancelled')), { once: true });
    if (signal.aborted) fail(Error('Pi run cancelled'));
  }
  send(value: unknown) {
    if (!this.dead) this.child.stdin!.write(JSON.stringify(value) + '\n');
  }
  request(type: string, values: Record<string, unknown> = {}): Promise<any> {
    if (this.dead) return Promise.reject(Error('Pi process has stopped'));
    const id = String(++this.next);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(id);
          reject(Error(`Pi request timed out: ${type}`));
        },
        type === 'prompt' ? 600000 : 45000,
      );
      this.pending.set(id, { resolve, reject, timer });
      this.send({ ...values, id, type });
    });
  }
  fail(error: Error) {
    this.dead = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export async function runPi(ctx: NativeContext) {
  const installed = (await version('pi')).match(/(?:^|\s)(\d+)\.(\d+)\.(\d+)/);
  if (!installed || (Number(installed[1]) === 0 && Number(installed[2]) < 85))
    throw Error('Pi 0.85以降が必要です。ネイティブCLIを更新してください。');
  // Exact files only: never let a missing saved path create a fresh native session.
  if (ctx.session) {
    if (!path.isAbsolute(ctx.session)) throw Error('Invalid saved Pi session path');
    const file = await fs.open(ctx.session, 'r');
    try {
      const bytes = Buffer.alloc(16384);
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
      const header = JSON.parse(bytes.subarray(0, bytesRead).toString('utf8').split('\n')[0]);
      if (
        header.type !== 'session' ||
        typeof header.cwd !== 'string' ||
        (await fs.realpath(header.cwd)) !== ctx.cwd
      )
        throw Error('Pi session belongs to a different checkout');
    } finally {
      await file.close();
    }
  }
  ctx.signal.throwIfAborted();
  const child = launch(
    'pi',
    ['--mode', 'rpc', ...(ctx.session ? ['--session', ctx.session] : [])],
    ctx.cwd,
  );
  ctx.child(child);
  let finish!: () => void;
  const completed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let failure: Error | undefined;
  let streamed = false;
  let started = false;
  let sawAgentStart = false;
  let settled = false;
  let sessionFile = ctx.session;
  const fail = (error: Error) => {
    failure = error;
    finish();
  };
  const rpc = new PiRpc(
    child,
    (event) => {
      if (event.type === 'agent_start') sawAgentStart = true;
      if (event.type === 'message_start') streamed = false;
      if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
        streamed = true;
        ctx.event('text', String(event.assistantMessageEvent.delta));
      }
      if (event.type === 'message_end' && event.message?.role === 'assistant') {
        if (event.message.stopReason === 'error' || event.message.stopReason === 'aborted')
          failure = Error(String(event.message.errorMessage ?? 'Pi response failed'));
        else failure = undefined; // A successful automatic retry supersedes its failed attempt.
        if (!streamed)
          for (const block of event.message.content ?? [])
            if (block.type === 'text') ctx.event('text', String(block.text));
      }
      if (event.type === 'tool_execution_start' || event.type === 'tool_execution_end')
        ctx.event('tool', String(event.toolName ?? 'Pi tool'), {
          details: JSON.stringify(event).slice(0, 16000),
        });
      if (event.type === 'auto_retry_start') ctx.event('status', 'Pi がネイティブの再試行を実行中');
      if (event.type === 'extension_error') {
        ctx.event('error', String(event.error));
        fail(Error('Pi extension failed'));
      }
      if (event.type === 'extension_ui_request') void dialog(event).catch(fail);
      if (event.type === 'agent_settled' && started) {
        settled = true;
        finish();
      }
    },
    fail,
    ctx.signal,
  );
  async function dialog(event: any) {
    if (['notify', 'setStatus', 'setWidget', 'setTitle'].includes(event.method)) {
      ctx.event(
        event.notifyType === 'error' ? 'error' : 'status',
        String(
          event.message ?? event.statusText ?? event.title ?? event.widgetLines?.join('\n') ?? '',
        ),
      );
      return;
    }
    if (!['select', 'input', 'editor', 'confirm'].includes(event.method)) {
      rpc.send({ type: 'extension_ui_response', id: event.id, cancelled: true });
      ctx.event('error', `未対応のPi拡張UI: ${String(event.method)}`);
      return;
    }
    const reply = await ctx.ask(
      String(event.title ?? 'Pi からの確認'),
      event,
      event.method === 'confirm'
        ? undefined
        : [
            {
              id: event.id,
              title: String(event.title ?? 'Pi からの質問'),
              options: event.method === 'select' ? event.options : undefined,
            },
          ],
    );
    const answer = reply.answers?.[event.id] ?? '';
    const value = Array.isArray(answer) ? answer.join('\n') : answer;
    rpc.send({
      type: 'extension_ui_response',
      id: event.id,
      ...(!reply.allow || (event.method === 'select' && !event.options?.includes(value))
        ? { cancelled: true }
        : event.method === 'confirm'
          ? { confirmed: true }
          : { value }),
    });
  }
  try {
    const state = await rpc.request('get_state');
    if (!state || typeof state.sessionFile !== 'string' || !path.isAbsolute(state.sessionFile))
      throw Error('Pi did not provide a persistent session');
    if (ctx.session && path.resolve(state.sessionFile) !== path.resolve(ctx.session))
      throw Error('Pi did not resume the requested session');
    if (state.isStreaming || state.isCompacting) throw Error('Pi session is already busy');
    sessionFile = state.sessionFile;
    // Observe native persistence after execution too: new session files may not exist until a response.
    started = true;
    await rpc.request('prompt', { message: ctx.prompt });
    if (!sawAgentStart) {
      const current = await rpc.request('get_state');
      // Native extension commands may finish without starting an agent/model turn.
      if (
        !sawAgentStart &&
        !current.isStreaming &&
        !current.isCompacting &&
        !current.pendingMessageCount
      ) {
        settled = true;
        finish();
      }
    }
    await completed;
    if (failure) throw failure;
    if (!settled) throw Error('Pi ended before its run settled');
  } finally {
    if (!ctx.signal.aborted) {
      try {
        const state = await rpc.request('get_state');
        if (typeof state?.sessionFile === 'string') sessionFile = state.sessionFile;
      } catch (error) {
        if (settled && !failure) {
          rpc.fail(Error('Run finished'));
          throw error;
        }
      }
    }
    rpc.fail(Error('Run finished'));
    if (sessionFile) {
      try {
        await fs.access(sessionFile);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !ctx.session)
          sessionFile = undefined;
        else if (!failure && !ctx.signal.aborted) throw error;
      }
      if (sessionFile) await ctx.saveSession(sessionFile);
    }
  }
}
