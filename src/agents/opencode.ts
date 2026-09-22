import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import type { ChildProcess } from 'node:child_process';
import { createParser } from 'eventsource-parser';
import { boundedResponse } from '../host/http';
import type { OpencodeClient, Event, PermissionRuleset } from '@opencode-ai/sdk/v2/client';
import { agentEnv, launch } from './process';
import type { NativeContext } from './adapter';

// A fresh authenticated native server per run; never attach to an arbitrary existing server.
export class OpenCodeServer {
  private endpoint = '';
  private password = randomBytes(32).toString('hex');
  private lifetime = new AbortController();
  readonly signal: AbortSignal;
  readonly child: ChildProcess;
  client!: OpencodeClient;
  constructor(
    private cwd: string,
    signal: AbortSignal,
    executable = 'opencode',
    env = agentEnv(),
  ) {
    this.signal = AbortSignal.any([signal, this.lifetime.signal]);
    this.signal.throwIfAborted();
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
    const { createOpencodeClient } = await import('@opencode-ai/sdk/v2/client');
    this.client = createOpencodeClient({
      baseUrl: this.endpoint,
      directory: this.cwd,
      headers: this.headers(),
      throwOnError: true,
      fetch: async (request) => boundedResponse(await this.fetch(request)),
    });
    const health = await data(this.client.global.health());
    if (health.healthy !== true) throw Error('OpenCode server health check failed');
    return health;
  }
  private headers() {
    return {
      Authorization: 'Basic ' + Buffer.from(`irori:${this.password}`).toString('base64'),
      'x-opencode-directory': encodeURIComponent(this.cwd),
    };
  }
  async fetch(input: RequestInfo | URL, long = false) {
    const request = new Request(input);
    const signal = AbortSignal.any([
      this.signal,
      request.signal,
      ...(long ? [] : [AbortSignal.timeout(45000)]),
    ]);
    const response = await fetch(request, { redirect: 'error', signal });
    if (!response.ok) {
      await response.body?.cancel();
      throw Error(
        `OpenCode操作に失敗しました（HTTP ${response.status}）。ネイティブ設定・ログイン・バージョンを確認してください。`,
      );
    }
    return response;
  }
  request(route: string, long = false) {
    return this.fetch(new Request(this.endpoint + route, { headers: this.headers() }), long);
  }
  // Headers are read before prompting, so the event subscription cannot miss first requests.
  async events(incoming: (event: Event) => void): Promise<Promise<void>[]> {
    const response = await this.request('/event', true);
    return [this.readEvents(response, incoming)];
  }
  private async readEvents(response: Response, incoming: (event: Event) => void) {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const parser = createParser({
      maxBufferSize: 8 * 1024 * 1024,
      onEvent: ({ data }) => {
        if (data) incoming(JSON.parse(data));
      },
      onError: (error) => {
        if (error.type === 'max-buffer-size-exceeded') throw Error('OpenCode event exceeds limit');
      },
    });
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) throw Error('OpenCode event stream disconnected');
        parser.feed(decoder.decode(value, { stream: true }));
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
  const server = new OpenCodeServer(ctx.cwd, ctx.signal, 'opencode', ctx.env);
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
  async function owns(id: string, depth = 0): Promise<boolean> {
    if (related.has(id)) return true;
    if (depth > 8) return false;
    const session = await data(server.client.session.get({ sessionID: id }));
    if ((await fs.realpath(session.directory)) !== ctx.cwd || !session.parentID) return false;
    if (!(await owns(session.parentID, depth + 1))) return false;
    related.add(id);
    return true;
  }
  async function dialog(event: Extract<Event, { type: 'permission.asked' | 'question.asked' }>) {
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
      const reply = await ctx.ask(`${String(event.properties.permission)} の許可`, p);
      if (!server.signal.aborted)
        await data(
          server.client.permission.reply({
            requestID: p.id,
            reply: reply.allow ? 'once' : 'reject',
          }),
        );
    } else {
      const p = event.properties;
      if (!Array.isArray(p.questions)) {
        await data(server.client.question.reject({ requestID: p.id }));
        ctx.event('error', 'OpenCodeの質問形式を読み取れません。要求を拒否しました。');
        return;
      }
      const questions = p.questions.map((q, i) => ({
        id: String(i),
        title: String(q.question),
        options: q.options?.map((o) => String(o.label)),
        multiple: q.multiple === true,
      }));
      const reply = await ctx.ask('OpenCode からの質問', p, questions);
      if (!server.signal.aborted) {
        if (reply.allow)
          await data(
            server.client.question.reply({
              requestID: p.id,
              answers: questions.map((q) => [reply.answers?.[q.id] ?? ''].flat()),
            }),
          );
        else await data(server.client.question.reject({ requestID: p.id }));
      }
    }
  }
  try {
    await server.start();
    const permission: PermissionRuleset | undefined =
      ctx.access === 'full-access'
        ? [{ permission: '*', pattern: '*', action: 'allow' }]
        : undefined;
    let session = ctx.session
      ? await data(server.client.session.get({ sessionID: ctx.session }))
      : await data(server.client.session.create(permission ? { permission } : undefined));
    if (
      typeof session.id !== 'string' ||
      (ctx.session && session.id !== ctx.session) ||
      (await fs.realpath(session.directory)) !== ctx.cwd
    )
      throw Error('OpenCode session does not belong to this checkout');
    if (permission) {
      const confirmed = () => {
        const last = session.permission?.at(-1);
        return last?.permission === '*' && last.pattern === '*' && last.action === 'allow';
      };
      // Native updates append rules; the last matching rule wins. Do not add
      // the same wildcard on every resumed turn.
      if (ctx.session && !confirmed())
        session = await data(server.client.session.update({ sessionID: session.id, permission }));
      if (!confirmed())
        throw Error(
          'OpenCodeが選択したアクセス設定を確認できません。更新またはCLIの設定を選んでください。',
        );
    }
    sessionId = session.id;
    related.add(sessionId);
    await ctx.saveSession(sessionId);
    const streams = await server.events((event) => {
      if (event.type === 'permission.asked' || event.type === 'question.asked') {
        const job = dialog(event)
          .catch(fail)
          .finally(() => jobs.delete(job));
        jobs.add(job);
        return;
      }
      if (
        event.type !== 'message.updated' &&
        event.type !== 'message.part.updated' &&
        event.type !== 'message.part.delta' &&
        event.type !== 'session.error'
      )
        return;
      const id =
        event.type === 'message.updated'
          ? event.properties.info.sessionID
          : event.type === 'message.part.updated'
            ? event.properties.part.sessionID
            : event.properties.sessionID;
      if (id !== sessionId) return;
      if (event.type === 'message.updated' && event.properties.info.role === 'assistant')
        assistants.add(event.properties.info.id);
      if (
        event.type === 'message.part.delta' &&
        event.properties.field === 'text' &&
        !finishing &&
        assistants.has(event.properties.messageID)
      ) {
        const p = event.properties;
        emitted.set(p.partID, (emitted.get(p.partID) ?? '') + String(p.delta));
        ctx.event('text', String(p.delta));
      }
      if (event.type === 'message.part.updated' && event.properties.part.type === 'tool') {
        const part = event.properties.part;
        ctx.event('tool', part.tool, { details: JSON.stringify(part.state).slice(0, 16000) });
      }
      if (event.type === 'session.error') ctx.event('error', errorMessage(event.properties.error));
    });
    stream = streams[0].catch((error) => {
      if (!server.signal.aborted) fail(error);
    });
    const result = await data(
      server.client.session.prompt(
        {
          sessionID: sessionId,
          parts: [{ type: 'text', text: ctx.prompt }],
        },
        { fetch: async (request) => boundedResponse(await server.fetch(request, true)) },
      ),
    );
    if (failure) throw failure;
    if (result?.info?.error) throw Error(errorMessage(result.info.error));
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

// SDK response envelopes remain host-local; errors never expose native response bodies.
export async function data<T>(response: Promise<{ data?: T }>): Promise<T> {
  const result = await response;
  if (result.data === undefined) throw Error('OpenCode returned no result');
  return result.data;
}
function errorMessage(error: { name: string; data: object } | undefined) {
  return error?.data && 'message' in error.data
    ? String(error.data.message)
    : (error?.name ?? 'OpenCode error');
}
