import type { ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

// Codex and Pi have different envelopes, but share bounded JSONL and request lifetimes.
export class JsonLineConnection {
  private next = 0;
  private dead = false;
  private pending = new Map<
    string,
    {
      resolve(value: any): void;
      reject(error: Error): void;
      timer: NodeJS.Timeout;
    }
  >();
  private cleanup: () => void = () => {};
  constructor(
    private child: ChildProcess,
    incoming: (message: any) => void,
    private failure: (error: Error) => void,
    signal?: AbortSignal,
  ) {
    let buffer = '',
      size = 0;
    const decoder = new StringDecoder('utf8');
    const receive = (chunk: Buffer) => {
      if (this.dead) return;
      for (let offset = 0; offset < chunk.length;) {
        const newline = chunk.indexOf(10, offset);
        const end = newline < 0 ? chunk.length : newline + 1;
        size += end - offset;
        if (size > 8 * 1024 * 1024) return this.fail(Error('Agent protocol record exceeds limit'));
        buffer += decoder.write(chunk.subarray(offset, end));
        offset = end;
        if (newline < 0) continue;
        const line = buffer.trim();
        buffer = '';
        size = 0;
        if (!line) continue;
        try {
          const message = JSON.parse(line);
          if (!message || typeof message !== 'object' || Array.isArray(message)) throw Error();
          incoming(message);
        } catch {
          return this.fail(Error('Invalid agent protocol message'));
        }
        if (this.dead) return;
      }
    };
    const abort = () => this.fail(Error('Agent run cancelled'));
    child.stdout!.on('data', receive);
    child.stderr?.resume();
    child.stdin!.on('error', (error) => this.fail(error));
    child.on('error', (error) => this.fail(error));
    child.on('close', (code) => this.fail(Error(`Agent process exited (${code})`)));
    this.cleanup = () => {
      signal?.removeEventListener('abort', abort);
      child.stdout!.off('data', receive).resume();
      buffer = '';
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  }
  send(message: unknown) {
    if (!this.dead) this.child.stdin!.write(JSON.stringify(message) + '\n');
  }
  request(message: Record<string, unknown>, timeout = 45000, numericId = false): Promise<any> {
    if (this.dead) return Promise.reject(Error('Agent process has stopped'));
    const id = String(++this.next);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error(`Agent request timed out: ${message.method ?? message.type}`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ ...message, id: numericId ? Number(id) : id });
    });
  }
  accept(id: unknown, value: unknown, error?: string) {
    if (typeof id !== 'number' && typeof id !== 'string') return;
    const pending = this.pending.get(String(id));
    if (!pending) return;
    this.pending.delete(String(id));
    clearTimeout(pending.timer);
    error === undefined ? pending.resolve(value) : pending.reject(Error(error));
  }
  fail(error: Error) {
    if (this.dead) return;
    this.dead = true;
    this.cleanup();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.failure(error);
  }
}
