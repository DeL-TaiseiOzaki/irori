import spawn from 'cross-spawn';
import treeKill from 'tree-kill';
import { execFile, execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ChildProcess } from 'node:child_process';
export function agentEnv(source = process.env, platform = process.platform): NodeJS.ProcessEnv {
  // Preserve native provider authentication/configuration. Never inspect tokens.
  const env = { ...source };
  delete env.IRORI_GOOGLE_CLIENT_ID;
  delete env.IRORI_GOOGLE_CLIENT_SECRET;
  delete env.IRORI_BUILD_GOOGLE_CLIENT_ID;
  delete env.IRORI_BUILD_GOOGLE_CLIENT_SECRET;
  // Windows inherits its native Path. Adding a separate PATH would shadow it in child_process.
  if (platform === 'win32') return env;
  const extra = [
    path.join(homedir(), '.local', 'bin'),
    path.join(homedir(), '.cargo', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
  env.PATH = [env.PATH, ...extra].filter(Boolean).join(path.delimiter);
  return env;
}

/**
 * The children launched here that have not exited. When this process ends they are
 * killed at once, so a crash of irori leaves no CLI or `opencode serve` behind.
 * Node runs the handler for `process.exit`, a normal end and the default end
 * after an uncaught exception; a SIGKILL of irori itself runs no handler and
 * cannot be covered.
 */
const live = new Set<ChildProcess>();
/** The children launched here that are still running, for tests and diagnostics. */
export const liveChildren = (): readonly ChildProcess[] => [...live];
process.on('exit', () => {
  for (const child of live) killNow(child.pid);
  live.clear();
});
/** Kills a child's process tree without waiting, as an exit handler must. */
function killNow(pid: number | undefined) {
  if (!pid) return;
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        timeout: 2000,
      });
    } catch {
      // The process may have ended already.
    }
    return;
  }
  // Descendants first: once the group is dead, `ps` no longer ties them to it.
  let others: number[] = [];
  try {
    others = descendantsOf(
      pid,
      execFileSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8', timeout: 1000 }),
    );
  } catch {
    // Without `ps`, the group alone is killed.
  }
  for (const target of [-pid, ...others]) signal(target, 'SIGKILL');
}

export function launch(command: string, args: string[], cwd: string, env = agentEnv()) {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: 'pipe',
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
  live.add(child);
  child.once('exit', () => live.delete(child));
  child.once('error', () => {
    if (child.pid === undefined) live.delete(child);
  });
  return child;
}

/** How long a SIGTERM'd CLI gets to stop its own servers before what is left is killed. */
const grace = 2500;
function signal(pid: number, name: 'SIGTERM' | 'SIGKILL') {
  try {
    process.kill(pid, name);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e;
  }
}
/** The pids under `pid` in a `ps -A -o pid=,ppid=` listing, children before grandchildren. */
export function descendantsOf(pid: number, listing: string) {
  const children = new Map<number, number[]>();
  for (const line of listing.split('\n')) {
    const [child, parent] = line.trim().split(/\s+/).map(Number);
    if (!child || Number.isNaN(parent)) continue;
    children.set(parent, [...(children.get(parent) ?? []), child]);
  }
  const found: number[] = [];
  for (const queue = [pid]; queue.length;) {
    const next = queue.shift()!;
    for (const child of children.get(next) ?? [])
      if (child !== pid && !found.includes(child)) {
        found.push(child);
        queue.push(child);
      }
  }
  return found;
}
async function descendants(pid: number) {
  try {
    const { stdout } = await promisify(execFile)('ps', ['-A', '-o', 'pid=,ppid='], {
      timeout: 2000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return descendantsOf(pid, stdout);
  } catch {
    return [];
  }
}
/** Resolves when the child has exited, or after `ms`. */
function exited(child: ChildProcess, ms: number) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      child.off('exit', done);
      resolve();
    }
    child.once('exit', done);
  });
}
/**
 * Stops a child and everything it started. On POSIX the child's process group is
 * signalled together with the descendants found first, since a command a CLI
 * detached into its own session (a dev server, an MCP server) is not in the group
 * and is reparented once the CLI dies. SIGTERM comes first, and what is still
 * there when the child has exited, or after the grace period, is killed.
 */
export async function killTree(child: ChildProcess): Promise<void> {
  if (!child.pid) return;
  const pid = child.pid;
  if (process.platform === 'win32') {
    const kill = (name: 'SIGTERM' | 'SIGKILL') =>
      new Promise<void>((resolve) => treeKill(pid, name, () => resolve()));
    await kill('SIGTERM');
    await exited(child, grace);
    await kill('SIGKILL');
    return;
  }
  const others = await descendants(pid);
  for (const target of [-pid, ...others]) signal(target, 'SIGTERM');
  await exited(child, grace);
  for (const target of [-pid, ...others]) signal(target, 'SIGKILL');
}

/** A `--version` answer is kept while the executable it came from stays the same, and this long at most. */
const versionTtl = 5 * 60 * 1000;
const versions = new Map<
  string,
  { file: string; mtimeMs: number; size: number; at: number; value: Promise<string> }
>();
/** The file `command` runs as, on the PATH the CLIs get; undefined when none is found. */
async function executable(command: string, env = agentEnv()) {
  if (path.isAbsolute(command)) return stat(command);
  const suffixes =
    process.platform === 'win32'
      ? ['', ...(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').toLowerCase().split(';')]
      : [''];
  for (const dir of (env.PATH ?? '').split(path.delimiter))
    if (dir)
      for (const suffix of suffixes) {
        const found = await stat(path.join(dir, command + suffix));
        if (found) return found;
      }
  return undefined;
}
async function stat(file: string) {
  const info = await fs.stat(file).catch(() => undefined);
  return info?.isFile() ? { file, mtimeMs: info.mtimeMs, size: info.size } : undefined;
}
/** The CLI's `--version` output; asked once per installed executable rather than per run. */
export async function version(command: string): Promise<string> {
  const found = await executable(command);
  const cached = found && versions.get(command);
  if (
    cached &&
    cached.file === found.file &&
    cached.mtimeMs === found.mtimeMs &&
    cached.size === found.size &&
    Date.now() - cached.at < versionTtl
  )
    return cached.value;
  const value = askVersion(command);
  if (found) {
    versions.set(command, { ...found, at: Date.now(), value });
    // A failure is asked again next time.
    value.catch(() => {
      if (versions.get(command)?.value === value) versions.delete(command);
    });
  }
  return value;
}
function askVersion(command: string): Promise<string> {
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
