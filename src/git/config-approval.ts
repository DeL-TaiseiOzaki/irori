import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import writeFileAtomic from 'write-file-atomic';
import { t } from '../domain/i18n';

/**
 * Settings of a repository's own `.git/config` that make Git run a program:
 * hooks and their folder, filters (run by `status`), diff and merge drivers,
 * credential helpers, SSH and signing programs, and includes, which can bring
 * any of these in. A folder irori did not create — synced, unpacked or copied —
 * can carry them, so Git runs there only once the person has seen them.
 */
const runs =
  /^(core\.(hookspath|sshcommand|pager|editor|askpass|fsmonitor|gitproxy|alternaterefscommand)|credential\.(.+\.)?helper|filter\..+\.(clean|smudge|process)|diff\.external|diff\..+\.(command|textconv)|merge\..+\.driver|gpg\.(.+\.)?program|sequence\.editor|uploadpack\.packobjectshook|remote\..+\.(uploadpack|receivepack|vcs)|include\.path|includeif\..+\.path)$/;

/** Each `key = value` of a Git config file, keys spelled as Git compares them. */
export function configEntries(text: string): [string, string][] {
  const entries: [string, string][] = [];
  let section = '';
  for (const raw of text.split(/\r?\n/)) {
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

/** The repository's own Git folder (shared by its worktrees) for a working folder, if any. */
async function gitFolder(cwd: string): Promise<string | undefined> {
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    const dot = path.join(dir, '.git');
    const info = await fs.stat(dot).catch(() => undefined);
    let folder: string | undefined;
    if (info?.isDirectory()) folder = dot;
    else if (info?.isFile()) {
      const match = /^gitdir:\s*(.+)$/m.exec(await fs.readFile(dot, 'utf8').catch(() => ''));
      if (match) folder = path.resolve(dir, match[1].trim());
    }
    if (folder) {
      const common = await fs.readFile(path.join(folder, 'commondir'), 'utf8').catch(() => '');
      return common.trim() ? path.resolve(folder, common.trim()) : folder;
    }
    if (path.dirname(dir) === dir) return undefined;
  }
}

const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

/** What in a repository's own configuration runs a program, with a digest of it. */
export async function gitConfigRuns(cwd: string) {
  const folder = await gitFolder(cwd);
  if (!folder) return undefined;
  const text = await fs.readFile(path.join(folder, 'config'), 'utf8').catch(() => '');
  const found = configEntries(text)
    .filter(([key]) => runs.test(key) && key !== 'core.fsmonitor')
    .map(([key, value]) => `${key} = ${value.slice(0, 200)}`);
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
    ? { folder, found, digest: sha256(JSON.stringify([found, hashes])) }
    : undefined;
}

/** Runs Git in a repository only with the person's leave for what its configuration runs. */
export class GitConfigApprovals {
  private queue: Promise<unknown> = Promise.resolve();
  /** Refused this session, so automatic reads do not ask again until it changes. */
  private refused = new Map<string, string>();
  constructor(
    private file: string,
    private ask: (folder: string, found: string[]) => Promise<boolean>,
  ) {}
  private async allowed(): Promise<Record<string, string>> {
    try {
      const value = JSON.parse(await fs.readFile(this.file, 'utf8'));
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
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
    const next = this.queue.then(async () => {
      const allowed = await this.allowed();
      if (allowed[runs.folder] === runs.digest) return;
      if (this.refused.get(runs.folder) === runs.digest) throw refusal();
      if (!(await this.ask(runs.folder, runs.found))) {
        this.refused.set(runs.folder, runs.digest);
        throw refusal();
      }
      allowed[runs.folder] = runs.digest;
      await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
      await writeFileAtomic(this.file, JSON.stringify(allowed, null, 2) + '\n', { mode: 0o600 });
    });
    this.queue = next.catch(() => {});
    return next;
  }
}

let approvals: GitConfigApprovals | undefined;
/** Set once by the app; tests and tools that never set it run Git as before. */
export function approveGitConfig(value: GitConfigApprovals | undefined) {
  approvals = value;
}
export const gitConfigApprovals = () => approvals;
