import { randomUUID } from 'node:crypto';
import treeKill from 'tree-kill';
import type { IPty } from 'node-pty';
import type { FileService } from '../host/files';
import type { TerminalEvent, TerminalSession, TerminalShell } from '../domain/types';
import { agentEnv } from '../agents/process';
import { detectShells } from './shells';
import { SerialQueue } from '../host/serial-queue';

type Running = { info: TerminalSession; pty: IPty; pending: number };
const highWater = 100000,
  lowWater = 50000;

export class TerminalService {
  private running = new Map<string, Running>();
  private shells?: TerminalShell[];
  private queue = new SerialQueue();
  constructor(
    private files: FileService,
    private emit: (event: TerminalEvent) => void,
  ) {}
  get busy() {
    return this.running.size > 0 || this.queue.busy;
  }
  async available() {
    return (this.shells ??= await detectShells());
  }
  async open(scopeId: string, shellId: string, cols: number, rows: number) {
    return this.queue.run(async () => {
      if (this.running.size >= 4) throw Error('ターミナルは同時に4つまで開けます。');
      const shell = (await this.available()).find((item) => item.id === shellId);
      if (!shell) throw Error('検出済みのシェルを選択してください。');
      const space = await this.files.get(scopeId);
      const cwd = await this.files.resolve(scopeId, '', true);
      const env = agentEnv();
      delete env.ELECTRON_RUN_AS_NODE;
      delete env.NODE_OPTIONS;
      const { spawn } = await import('node-pty');
      const pty = spawn(shell.id, process.platform === 'win32' ? [] : ['-l'], {
        cwd,
        cols,
        rows,
        name: 'xterm-256color',
        env: env as Record<string, string>,
      });
      const info = { id: randomUUID(), scopeId: space.scopeId, shell, cwd };
      const session: Running = { info, pty, pending: 0 };
      this.running.set(info.id, session);
      pty.onData((data) => {
        if (!this.running.has(info.id)) return;
        session.pending += data.length;
        if (session.pending >= highWater) pty.pause();
        this.emit({ id: info.id, type: 'data', data });
      });
      pty.onExit(({ exitCode }) => {
        this.running.delete(info.id);
        this.emit({ id: info.id, type: 'exit', code: exitCode });
      });
      return info;
    });
  }
  write(id: string, data: string) {
    const session = this.running.get(id);
    if (!session) throw Error('ターミナルは終了しています。');
    session.pty.write(data);
  }
  resize(id: string, cols: number, rows: number) {
    this.running.get(id)?.pty.resize(cols, rows);
  }
  acknowledge(id: string, length: number) {
    const session = this.running.get(id);
    if (!session) return;
    const before = session.pending;
    session.pending = Math.max(0, before - length);
    if (before >= lowWater && session.pending < lowWater) session.pty.resume();
  }
  async close(id: string) {
    const session = this.running.get(id);
    if (!session) return;
    this.running.delete(id);
    // Reuse process-tree termination for foreground commands as well as the shell.
    await new Promise<void>((resolve) => treeKill(session.pty.pid, 'SIGKILL', () => resolve()));
    try {
      session.pty.kill();
    } catch {
      /* The process may already have exited. */
    }
  }
  async closeAll() {
    await this.queue.run(async () => {
      await Promise.all([...this.running.keys()].map((id) => this.close(id)));
    });
  }
}
