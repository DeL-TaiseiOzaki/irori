import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { t } from '../domain/i18n';
import { readLocalJson, writeLocalJson } from '../host/local-json';
import { SerialQueue } from '../host/serial-queue';

/**
 * Settings of a repository's own `.git/config` that make Git run a program:
 * hooks and their folder, filters (run by `status`), diff and merge drivers,
 * credential helpers, SSH and signing programs, and includes, which can bring
 * any of these in. A folder irori did not create — synced, unpacked or copied —
 * can carry them, so Git runs there only once the person has seen them.
 */
const runs =
  /^(core\.(hookspath|sshcommand|pager|editor|askpass|fsmonitor|gitproxy|alternaterefscommand)|credential\.(.+\.)?helper|filter\..+\.(clean|smudge|process)|diff\.external|diff\..+\.(command|textconv)|merge\..+\.driver|gpg\.(.+\.)?program|sequence\.editor|uploadpack\.packobjectshook|remote\..+\.(uploadpack|receivepack|vcs)|protocol\.(.+\.)?allow|url\..+\.(insteadof|pushinsteadof)|extensions\.worktreeconfig|include\.path|includeif\..+\.path)$/;

/** Each `key = value` of a Git config file, keys spelled as Git compares them. */
export function configEntries(text: string): [string, string][] {
  const entries: [string, string][] = [];
  let section = '';
  // Join Git's trailing-backslash line continuations before parsing entries.
  const logicalLines: string[] = [];
  let pending = '';
  for (const raw of text.split(/\r?\n/)) {
    const combined = pending ? `${pending}${raw}` : raw;
    let slashes = 0;
    for (let i = combined.length - 1; i >= 0 && combined[i] === '\\'; i--) slashes++;
    if (slashes % 2 === 1) {
      pending = combined.slice(0, -1);
    } else {
      logicalLines.push(combined);
      pending = '';
    }
  }
  if (pending) logicalLines.push(pending);
  for (const raw of logicalLines) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const header = /^\[\s*([^\s"\]]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\]\s*(.*)$/.exec(line);
    if (header) {
      const [name, ...dotted] = header[1].split('.');
      // `[a "Sub"]` keeps the subsection's case; `[a.Sub]` is the old, lowercased spelling.
      const sub = header[2] ?? (dotted.length ? dotted.join('.').toLowerCase() : undefined);
      section = `${name.toLowerCase()}${sub !== undefined ? `.${sub}` : ''}`;
      if (!header[3]) continue;
      const rest = /^([A-Za-z][\w-]*)\s*(?:=\s*(.*))?$/.exec(header[3]);
      if (rest) entries.push([`${section}.${rest[1].toLowerCase()}`, rest[2] ?? 'true']);
      continue;
    }
    const entry = /^([A-Za-z][\w-]*)\s*(?:=\s*(.*))?$/.exec(line);
    if (entry && section)
      entries.push([`${section}.${entry[1].toLowerCase()}`, entry[2] ?? 'true']);
  }
  return entries;
}

/** The repository's own Git folder (common dir) and worktree-specific dir, if any. */
async function gitFolders(cwd: string): Promise<{ folder: string; gitDir: string } | undefined> {
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    const dot = path.join(dir, '.git');
    const info = await fs.stat(dot).catch(() => undefined);
    let gitDir: string | undefined;
    if (info?.isDirectory()) gitDir = dot;
    else if (info?.isFile()) {
      const match = /^gitdir:\s*(.+)$/m.exec(await fs.readFile(dot, 'utf8').catch(() => ''));
      if (match) gitDir = path.resolve(dir, match[1].trim());
    }
    if (gitDir) {
      const common = await fs.readFile(path.join(gitDir, 'commondir'), 'utf8').catch(() => '');
      const folder = common.trim() ? path.resolve(gitDir, common.trim()) : gitDir;
      return { folder, gitDir };
    }
    if (path.dirname(dir) === dir) return undefined;
  }
}

const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

/** What in a repository's own configuration runs a program, with a digest of it. */
export async function gitConfigRuns(cwd: string) {
  const dirs = await gitFolders(cwd);
  if (!dirs) return undefined;
  const { folder, gitDir } = dirs;
  const configFiles = [
    ...new Set([
      path.join(folder, 'config'),
      path.join(gitDir, 'config.worktree'),
      path.join(folder, 'config.worktree'),
    ]),
  ];
  const matched: [string, string][] = [];
  for (const configFile of configFiles) {
    const text = await fs.readFile(configFile, 'utf8').catch(() => '');
    if (!text) continue;
    for (const [key, value] of configEntries(text))
      if (runs.test(key) && key !== 'core.fsmonitor') matched.push([key, value]);
  }
  const found = matched.map(([key, value]) => `${key} = ${value.slice(0, 200)}`);
  const fullValues = matched.map(([key, value]) => `${key} = ${value}`);
  const hooks = path.join(folder, 'hooks');
  const names = await fs.readdir(hooks).catch(() => [] as string[]);
  const hashes: string[] = [];
  for (const name of names.filter((item) => !item.endsWith('.sample')).sort()) {
    const info = await fs.lstat(path.join(hooks, name)).catch(() => undefined);
    if (!info || info.isDirectory()) continue;
    found.push(`hooks/${name}`);
    hashes.push(sha256(await fs.readFile(path.join(hooks, name)).catch(() => '')));
  }
  return found.length
    ? { folder, found, digest: sha256(JSON.stringify([fullValues, hashes])) }
    : undefined;
}

/** Runs Git in a repository only with the person's leave for what its configuration runs. */
export class GitConfigApprovals {
  private queue = new SerialQueue();
  /** Refused this session, so automatic reads do not ask again until it changes. */
  private refused = new Map<string, string>();
  constructor(
    private file: string,
    private ask: (folder: string, found: string[]) => Promise<boolean>,
  ) {}
  private async allowed(): Promise<Record<string, string>> {
    const value = await readLocalJson(this.file, {}).catch(() => ({}));
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, string>)
      : {};
  }
  async check(cwd: string) {
    const runs = await gitConfigRuns(cwd);
    if (!runs) return;
    const refusal = () =>
      Error(
        t(
          `このリポジトリの Git 設定はプログラムを実行します。許可されていないため、Git を実行しませんでした: ${runs.folder}`,
          `This repository's Git configuration runs programs and was not allowed, so Git did not run: ${runs.folder}`,
        ),
      );
    if (this.refused.get(runs.folder) === runs.digest) throw refusal();
    return this.queue.run(async () => {
      const allowed = await this.allowed();
      if (allowed[runs.folder] === runs.digest) return;
      if (this.refused.get(runs.folder) === runs.digest) throw refusal();
      if (!(await this.ask(runs.folder, runs.found))) {
        this.refused.set(runs.folder, runs.digest);
        throw refusal();
      }
      allowed[runs.folder] = runs.digest;
      await writeLocalJson(this.file, allowed);
    });
  }
}

let approvals: GitConfigApprovals | undefined;
/** Set once by the app; tests and tools that never set it run Git as before. */
export function approveGitConfig(value: GitConfigApprovals | undefined) {
  approvals = value;
}
export const gitConfigApprovals = () => approvals;
