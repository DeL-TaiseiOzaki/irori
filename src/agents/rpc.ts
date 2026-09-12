import { createInterface } from 'node:readline';
import type { ChildProcess } from 'node:child_process';
// Protocol JSON is validated by the provider. Unrecognized requests fail closed.
export type Message = {
  id?: string | number;
  method?: string;
  params?: any;
  result?: any;
  error?: { message: string; code: number };
};
export class Rpc {
  private next = 1;
  private pending = new Map<
    number,
    { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  private dead = false;
  constructor(
    readonly child: ChildProcess,
    readonly incoming: (message: Message) => void,
    private onFailure: (error: Error) => void = () => {},
  ) {
    const lines = createInterface({ input: child.stdout! });
    lines.on('line', (line) => {
      if (line.length > 8 * 1024 * 1024) {
        this.fail(Error('Agent message too large'));
        return;
      }
      try {
        const message: Message = JSON.parse(line);
        if (message.id !== undefined && !message.method) {
          const pending = this.pending.get(Number(message.id));
          if (pending) {
            this.pending.delete(Number(message.id));
            clearTimeout(pending.timer);
            message.error
              ? pending.reject(Error(message.error.message))
              : pending.resolve(message.result);
          }
        } else incoming(message);
      } catch (e) {
        this.fail(Error(`Invalid agent protocol message: ${String(e)}`));
      }
    });
    child.stdin!.on('error', (e) => this.fail(e));
    child.on('error', (e) => this.fail(e));
    child.on('close', (code) => {
      lines.close();
      this.fail(Error(`Agent process exited (${code})`));
    });
  }
  send(message: Message) {
    if (!this.dead) this.child.stdin!.write(JSON.stringify(message) + '\n');
  }
  request(method: string, params: unknown): Promise<any> {
    if (this.dead) return Promise.reject(Error('Agent process has stopped'));
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error(`Agent request timed out: ${method}`));
      }, 45000);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, method, params });
    });
  }
  fail(error: Error) {
    if (this.dead) return;
    this.dead = true;
    this.onFailure(error);
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
  }
}
