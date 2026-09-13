import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import type { ChildProcess } from 'node:child_process';
import { agentEnv, launch } from './process';
import type { NativeContext } from './adapter';

// A fresh authenticated native server per run; never attach to an arbitrary existing server.
export class OpenCodeServer {
  private endpoint = '';
  private password = randomBytes(32).toString('hex');
  private lifetime = new AbortController();
  readonly signal: AbortSignal;
  readonly child: ChildProcess;
  constructor(
    private cwd: string,
    signal: AbortSignal,
    executable = 'opencode',
  ) {
    this.signal = AbortSignal.any([signal, this.lifetime.signal]);
    this.signal.throwIfAborted();
    const env = agentEnv();
    env.OPENCODE_SERVER_USERNAME = 'irori';
    env.OPENCODE_SERVER_PASSWORD = this.password;
    this.child = launch(executable, ['serve', '--hostname=127.0.0.1', '--port=0'], cwd, env);
    this.child.stdin?.end();
    this.child.stderr?.resume();
    this.child.on('error', () => this.stop());
    this.child.on('close', () => this.stop());
  }
  async start() {
    await new Promise<void>((resolve, reject) => {
      let buffer = '';
      const timeout = setTimeout(
        () => done(Error('OpenCodeの起動がタイムアウトしました。')),
        15000,
      );
      const abort = () => done(Error('OpenCode server stopped'));
      const data = (chunk: Buffer) => {
        buffer = (buffer + chunk.toString()).slice(-8192);
        const match = buffer.match(/opencode server listening on (http:\/\/127\.0\.0\.1:\d+)/);
        if (match) {
          this.endpoint = match[1];
          done();
        }
      };
      const done = (error?: Error) => {
        clearTimeout(timeout);
        this.signal.removeEventListener('abort', abort);
        this.child.stdout?.off('data', data);
        this.child.stdout?.resume();
        error ? reject(error) : resolve();
      };
      this.child.stdout!.on('data', data);
      this.signal.addEventListener('abort', abort, { once: true });
      if (this.signal.aborted) abort();
    });
    const health = await this.json('/global/health');
    if (health.healthy !== true) throw Error('OpenCode server health check failed');
    return health;
  }
  async request(route: string, method = 'GET', body?: unknown, long = false) {
    const signal = long ? this.signal : AbortSignal.any([this.signal, AbortSignal.timeout(45000)]);
    const response = await fetch(this.endpoint + route, {
      method,
      redirect: 'error',
      signal,
      headers: {
        Authorization: 'Basic ' + Buffer.from(`irori:${this.password}`).toString('base64'),
        'Content-Type': 'application/json',
        'x-opencode-directory': encodeURIComponent(this.cwd),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw Error(
        `OpenCode操作に失敗しました（HTTP ${response.status}）。ネイティブ設定・ログイン・バージョンを確認してください。`,
      );
    }
    return response;
  }
  async json(route: string, method = 'GET', body?: unknown, long = false) {
    const response = await this.request(route, method, body, long);
    if (response.status === 204) return undefined;
    const reader = response.body!.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 8 * 1024 * 1024) throw Error('OpenCode response exceeds limit');
        chunks.push(value);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
  // Headers are read before prompting, so the event subscription cannot miss first requests.
  async events(incoming: (event: any) => void): Promise<Promise<void>[]> {
    const response = await this.request('/event', 'GET', undefined, true);
    return [this.readEvents(response, incoming)];
  }
  private async readEvents(response: Response, incoming: (event: any) => void) {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) throw Error('OpenCode event stream disconnected');
        buffer += decoder.decode(value, { stream: true });
        if (buffer.length > 8 * 1024 * 1024) throw Error('OpenCode event exceeds limit');
        buffer = buffer.replaceAll('\r\n', '\n');
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = frame
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n');
          if (data) incoming(JSON.parse(data));
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
  stop() {
    this.lifetime.abort();
  }
}

export async function runOpenCode(ctx: NativeContext) {
  const server = new OpenCodeServer(ctx.cwd, ctx.signal);
  ctx.child(server.child);
  let stream: Promise<void> | undefined;
  let failure: Error | undefined;
  let sessionId = '';
  const emitted = new Map<string, string>();
  let finishing = false;
  const assistants = new Set<string>();
  const requests = new Set<string>();
  const jobs = new Set<Promise<void>>();
  const related = new Set<string>();
  const fail = (error: Error) => {
    failure = error;
    server.stop();
  };
  const encode = (id: string) => encodeURIComponent(id);
  const route = () => '/session/' + encode(sessionId);
  async function owns(id: string, depth = 0): Promise<boolean> {
    if (related.has(id)) return true;
    if (depth > 8) return false;
    const session = await server.json('/session/' + encode(id));
    if ((await fs.realpath(session.directory)) !== ctx.cwd || !session.parentID) return false;
    if (!(await owns(session.parentID, depth + 1))) return false;
    related.add(id);
    return true;
  }
  async function dialog(event: any) {
    const p = event.properties;
    if (
      !p ||
      typeof p.id !== 'string' ||
      typeof p.sessionID !== 'string' ||
      !(await owns(p.sessionID))
    )
      return;
    if (requests.has(p.id)) return;
    requests.add(p.id);
    if (event.type === 'permission.asked') {
      const reply = await ctx.ask(`${String(p.permission)} の許可`, p);
      if (!server.signal.aborted)
        await server.json('/permission/' + encode(p.id) + '/reply', 'POST', {
          reply: reply.allow ? 'once' : 'reject',
        });
    } else {
      if (!Array.isArray(p.questions)) {
        await server.json('/question/' + encode(p.id) + '/reject', 'POST', {});
        ctx.event('error', 'OpenCodeの質問形式を読み取れません。要求を拒否しました。');
        return;
      }
      const questions = p.questions.map((q: any, i: number) => ({
        id: String(i),
        title: String(q.question),
        options: q.options?.map((o: any) => String(o.label)),
        multiple: q.multiple === true,
      }));
      const reply = await ctx.ask('OpenCode からの質問', p, questions);
      if (!server.signal.aborted)
        await server.json(
          '/question/' + encode(p.id) + (reply.allow ? '/reply' : '/reject'),
          'POST',
          reply.allow
            ? {
                answers: questions.map((q: { id: string }) => [reply.answers?.[q.id] ?? ''].flat()),
              }
            : {},
        );
    }
  }
  try {
    await server.start();
    const session = ctx.session
      ? await server.json('/session/' + encode(ctx.session))
      : await server.json('/session', 'POST', {});
    if (
      typeof session.id !== 'string' ||
      (ctx.session && session.id !== ctx.session) ||
      (await fs.realpath(session.directory)) !== ctx.cwd
    )
      throw Error('OpenCode session does not belong to this checkout');
    sessionId = session.id;
    related.add(sessionId);
    await ctx.saveSession(sessionId);
    const streams = await server.events((event) => {
      const p = event.properties ?? {};
      if (event.type === 'permission.asked' || event.type === 'question.asked') {
        const job = dialog(event)
          .catch(fail)
          .finally(() => jobs.delete(job));
        jobs.add(job);
        return;
      }
      const id = p.sessionID ?? p.info?.sessionID ?? p.part?.sessionID;
      if (id !== sessionId) return;
      if (event.type === 'message.updated' && p.info?.role === 'assistant')
        assistants.add(p.info.id);
      if (
        event.type === 'message.part.delta' &&
        p.field === 'text' &&
        !finishing &&
        assistants.has(p.messageID)
      ) {
        emitted.set(p.partID, (emitted.get(p.partID) ?? '') + String(p.delta));
        ctx.event('text', String(p.delta));
      }
      if (event.type === 'message.part.updated' && p.part?.type === 'tool')
        ctx.event('tool', String(p.part.tool), {
          details: JSON.stringify(p.part.state).slice(0, 16000),
        });
      if (event.type === 'session.error')
        ctx.event('error', String(p.error?.data?.message ?? p.error?.name ?? 'OpenCode error'));
    });
    stream = streams[0].catch((error) => {
      if (!server.signal.aborted) fail(error);
    });
    const result = await server.json(
      route() + '/message',
      'POST',
      { parts: [{ type: 'text', text: ctx.prompt }] },
      true,
    );
    if (failure) throw failure;
    if (result?.info?.error)
      throw Error(
        String(result.info.error.data?.message ?? result.info.error.name ?? 'OpenCode turn failed'),
      );
    if (result?.info?.role !== 'assistant' || !Array.isArray(result.parts))
      throw Error('OpenCode ended without an assistant result');
    finishing = true;
    for (const part of result.parts)
      if (part.type === 'text') {
        const text = String(part.text);
        const prefix = emitted.get(part.id) ?? '';
        const remaining = text.startsWith(prefix) ? text.slice(prefix.length) : '\n' + text;
        if (remaining) ctx.event('text', remaining);
      }
  } catch (error) {
    throw failure ?? error;
  } finally {
    server.stop();
    await stream;
  }
}
