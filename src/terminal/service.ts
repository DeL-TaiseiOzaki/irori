import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import treeKill from 'tree-kill';
import type { IPty } from 'node-pty';
import type { FileService } from '../host/files';
import type { TerminalEvent, TerminalSession, TerminalShell } from '../domain/types';
import { agentEnv } from '../agents/process';
import { detectShells } from './shells';
import { SerialQueue } from '../host/serial-queue';
import { t } from '../domain/i18n';

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
    /** The irori agent's folder when `scopeId` is its id; a hibachi's id resolves through the files. */
    private agentRoot: (scopeId: string) => string | undefined = () => undefined,
  ) {}
  get busy() {
    return this.running.size > 0 || this.queue.busy;
  }
  async available() {
    return (this.shells ??= await detectShells());
  }
  async open(scopeId: string, shellId: string, cols: number, rows: number) {
    return this.queue.run(async () => {
      if (this.running.size >= 4)
        throw Error(
          t('ターミナルは同時に4つまで開けます。', 'Up to 4 terminals can be open at once.'),
        );
      const shell = (await this.available()).find((item) => item.id === shellId);
      if (!shell) throw Error(t('シェルが見つかりません。', 'Shell not found.'));
      const own = this.agentRoot(scopeId);
      const cwd = own
        ? await fs.realpath(own).catch(() => {
            throw Error(
              t(
                'irori agent のフォルダがまだありません。',
                "The irori agent's folder doesn't exist yet.",
              ),
            );
          })
        : await this.files.resolve(scopeId, '', true);
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
      const info = { id: randomUUID(), scopeId, shell, cwd };
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
    if (!session) throw Error(t('ターミナルは終了しています。', 'The terminal has exited.'));
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
  /** Closes the terminals open in a hibachi, before it is removed. */
  async closeScope(scopeId: string) {
    await this.queue.run(async () => {
      const ids = [...this.running.values()]
        .filter((session) => session.info.scopeId === scopeId)
        .map((session) => session.info.id);
      await Promise.all(ids.map((id) => this.close(id)));
    });
  }
  async closeAll() {
    await this.queue.run(async () => {
      await Promise.all([...this.running.keys()].map((id) => this.close(id)));
    });
  }
}
