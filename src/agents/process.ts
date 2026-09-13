import spawn from 'cross-spawn';
import treeKill from 'tree-kill';
import { homedir } from 'node:os';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
export function agentEnv(): NodeJS.ProcessEnv {
  // Preserve native provider authentication/configuration. Never inspect tokens.
  const env = { ...process.env };
  delete env.IRORI_GOOGLE_CLIENT_ID;
  delete env.IRORI_GOOGLE_CLIENT_SECRET;
  delete env.IRORI_BUILD_GOOGLE_CLIENT_ID;
  delete env.IRORI_BUILD_GOOGLE_CLIENT_SECRET;
  const extra = [
    path.join(homedir(), '.local', 'bin'),
    path.join(homedir(), '.cargo', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
  env.PATH = [env.PATH, ...extra].filter(Boolean).join(path.delimiter);
  return env;
}
export function launch(command: string, args: string[], cwd: string, env = agentEnv()) {
  return spawn(command, args, {
    cwd,
    env,
    stdio: 'pipe',
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
}
export async function killTree(child: ChildProcess): Promise<void> {
  if (!child.pid) return;
  const pid = child.pid;
  const kill = async (signal: 'SIGTERM' | 'SIGKILL') => {
    if (process.platform !== 'win32') {
      try {
        process.kill(-pid, signal);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e;
      }
    } else await new Promise<void>((resolve) => treeKill(pid, signal, () => resolve()));
  };
  await kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 300));
  await kill('SIGKILL');
}
export async function version(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = launch(command, ['--version'], process.cwd());
    let output = '';
    const timer = setTimeout(() => {
      void killTree(p);
      reject(Error('CLI version check timed out'));
    }, 8000);
    p.stdout?.on('data', (b) => {
      output = (output + b).slice(-1000);
    });
    p.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(output.trim()) : reject(Error('CLI unavailable'));
    });
    p.stdin?.end();
  });
}
