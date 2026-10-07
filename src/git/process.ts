import type { ChildProcess } from 'node:child_process';
import { constants, promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { agentEnv, launch, killTree } from '../agents/process';
import { t } from '../domain/i18n';

const authentication =
  /authentication|permission denied|could not read Username|publickey|terminal prompts disabled/i;
// An HTTPS GitHub remote that refused the credentials Git offered, or had none to offer.
// "Repository not found" is how GitHub answers an account that cannot see a private repository.
const githubRefusal = (diagnostic: string) =>
  /https:\/\/(?:[^/\s@'"]*@)?github\.com[/:'"\s]/i.test(diagnostic) &&
  (authentication.test(diagnostic) ||
    /repository not found|repository '[^']*' not found/i.test(diagnostic));

/** What the GitHub CLI fallback did before this error, which decides the advice. */
export type GitHubFallback = 'unavailable' | 'tried';

/**
 * The last lines of Git's own diagnostic, with credentials and the home directory
 * removed, so a person can see why an operation failed without it leaking a secret.
 */
export function gitDetail(diagnostic: string, home = homedir()) {
  const lines = diagnostic
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^Cloning into /.test(line));
  return lines
    .slice(-4)
    .map((line) =>
      (home ? line.split(home).join('~') : line)
        .replace(/([a-z][\w+.-]*:\/\/)[^/\s@]*@/gi, '$1***@')
        .replace(/\b(?:gh[oprsu]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,})/g, '***')
        .replace(/\b(authorization|password|token|secret)(\s*[:=]\s*)\S+/gi, '$1$2***')
        .slice(0, 300),
    )
    .join('\n');
}

export class GitError extends Error {
  // Kept out of the message and of inspection output; only the host reads it.
  readonly #diagnostic: string;
  constructor(
    readonly code: number | null,
    diagnostic: string,
    github?: GitHubFallback,
  ) {
    const hint = /non-fast-forward|fetch first|rejected/i.test(diagnostic)
      ? t('リモートに受け付けられませんでした。', 'The remote rejected this change.')
      : github === 'tried'
        ? t(
            'GitHub CLI（gh）の認証でもアクセスできませんでした（`gh auth status`）。',
            'GitHub CLI (gh) authentication could not access it either (`gh auth status`).',
          )
        : github === 'unavailable'
          ? t(
              'GitHub の認証を確認できませんでした（`gh auth login`）。',
              'Could not verify GitHub authentication (`gh auth login`).',
            )
          : authentication.test(diagnostic)
            ? t(
                'Git の認証・アクセス権に問題があります。',
                'There is a problem with Git authentication or access.',
              )
            : /unable to auto-detect email|author identity unknown/i.test(diagnostic)
              ? t(
                  'commit の作成者名とメールアドレスが未設定です。',
                  'The commit author name and email are not set.',
                )
              : /index.lock|another git process/i.test(diagnostic)
                ? t('別の Git 操作が実行中です。', 'Another Git operation is running.')
                : /could not resolve|unable to access|connection|repository not found|could not read from remote/i.test(
                      diagnostic,
                    )
                  ? t(
                      '接続先・ネットワーク・アクセス権を確認してから再試行してください。',
                      'Check the remote, network, and access, then try again.',
                    )
                  : t('Git 操作が完了しませんでした。', 'The Git operation did not complete.');
    // Git diagnostics may contain credential-bearing URLs, helper output and machine
    // paths; only the redacted tail travels with the advice, after a blank line.
    const detail = gitDetail(diagnostic);
    super(detail ? `${hint}\n\n${detail}` : hint);
    this.#diagnostic = diagnostic;
  }
  get diagnostic() {
    return this.#diagnostic;
  }
}

/** The GitHub CLI executable on the PATH irori gives child processes, if installed. */
export async function findGitHubCli(env = agentEnv(), platform = process.platform) {
  const search = (platform === 'win32' ? (env.Path ?? env.PATH) : env.PATH) ?? '';
  const names = platform === 'win32' ? ['gh.exe'] : ['gh'];
  for (const directory of search.split(path.delimiter).filter(path.isAbsolute))
    for (const name of names) {
      const candidate = path.join(directory, name);
      try {
        if ((await fs.stat(candidate)).isFile()) {
          await fs.access(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK);
          return candidate;
        }
      } catch {
        // Not here; keep looking.
      }
    }
}

/**
 * One invocation's configuration that makes the GitHub CLI the only credential
 * helper for https://github.com. The empty value clears helpers from every other
 * configuration file for that host only, so a stale keychain entry cannot answer first.
 * Nothing is written to the person's Git configuration, and irori never sees the token.
 */
export function githubCredentialConfig(gh: string) {
  const helper = `!'${gh.replace(/'/g, `'\\''`)}' auth git-credential`;
  return [
    '-c',
    'credential.https://github.com.helper=',
    '-c',
    `credential.https://github.com.helper=${helper}`,
  ];
}

type RunOptions = { input?: string; network?: boolean; codes?: number[]; inspection?: boolean };
type ProcessSlots = {
  limit: number;
  running: number;
  waiting: { owner: GitProcess; resolve: () => void; reject: (e: Error) => void }[];
};

export class GitProcess {
  // Network operations can wait for 90 seconds. Separate global limits leave
  // local status and repository inspection runnable throughout those waits.
  private static local: ProcessSlots = { limit: 4, running: 0, waiting: [] };
  private static network: ProcessSlots = { limit: 2, running: 0, waiting: [] };
  private closed = false;
  private children = new Set<ChildProcess>();
  constructor(
    private command = 'git',
    private githubCli: () => Promise<string | undefined> = () => findGitHubCli(),
  ) {}
  async run(cwd: string, args: string[], options: RunOptions = {}) {
    try {
      return await this.once(cwd, args, options);
    } catch (error) {
      // A person signed in with `gh auth login` often has not also run `gh auth setup-git`.
      // Network operations against an HTTPS GitHub remote then retry once with gh's
      // credentials, without changing their Git configuration.
      if (!options.network || !(error instanceof GitError) || !githubRefusal(error.diagnostic))
        throw error;
      const gh = await this.githubCli();
      if (!gh) throw new GitError(error.code, error.diagnostic, 'unavailable');
      try {
        return await this.once(cwd, [...githubCredentialConfig(gh), ...args], options);
      } catch (retry) {
        if (retry instanceof GitError && githubRefusal(retry.diagnostic))
          throw new GitError(retry.code, retry.diagnostic, 'tried');
        throw retry;
      }
    }
  }
  private acquire(slots: ProcessSlots) {
    if (this.closed) return Promise.reject(Error('Git process is closed'));
    if (slots.running < slots.limit) {
      slots.running++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      slots.waiting.push({ owner: this, resolve, reject });
    });
  }
  private async once(cwd: string, args: string[], options: RunOptions) {
    const slots = options.network ? GitProcess.network : GitProcess.local;
    await this.acquire(slots);
    try {
      if (this.closed) throw Error('Git process is closed');
      return await this.execute(cwd, args, options);
    } finally {
      const next = slots.waiting.shift();
      if (next) next.resolve();
      else slots.running--;
    }
  }
  private execute(cwd: string, args: string[], options: RunOptions) {
    const env = agentEnv();
    for (const key of Object.keys(env))
      if (
        key.startsWith('GIT_') &&
        (options.inspection ||
          ![
            'GIT_SSH',
            'GIT_SSH_COMMAND',
            'GIT_ASKPASS',
            'GIT_CONFIG_GLOBAL',
            'GIT_CONFIG_SYSTEM',
            'GIT_CONFIG_NOSYSTEM',
          ].includes(key))
      )
        delete env[key];
    env.GIT_TERMINAL_PROMPT = '0';
    env.GIT_OPTIONAL_LOCKS = '0';
    env.GIT_MERGE_AUTOEDIT = 'no';
    env.GIT_PAGER = 'cat';
    env.LC_ALL = 'C';
    const child = launch(
      this.command,
      ['--no-pager', '-c', 'core.fsmonitor=false', '-c', 'color.ui=false', ...args],
      cwd,
      env,
    );
    this.children.add(child);
    const limit = (options.inspection ? 1 : 4) * 1024 * 1024;
    return new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0,
        diagnostic = '',
        failure: Error | undefined;
      let stopping: Promise<void> | undefined;
      const stop = (error: Error) => {
        failure ??= error;
        stopping ??= killTree(child);
        void stopping.catch(() => {});
      };
      const timer = setTimeout(
        () => stop(Error(t('Git 操作が時間切れになりました。', 'The Git operation timed out.'))),
        options.inspection ? 8000 : options.network ? 90000 : 30000,
      );
      child.stdout?.on('data', (bytes: Buffer) => {
        size += bytes.length;
        if (size > limit)
          stop(Error(t('Git の表示上限を超えました。', "This exceeds Git's display limit.")));
        else chunks.push(bytes);
      });
      child.stderr?.on('data', (bytes: Buffer) => {
        diagnostic = (diagnostic + bytes.toString()).slice(-16000);
      });
      child.stdin?.on('error', () => {});
      child.on('error', () => {
        failure ??= Error(t('Git を起動できません。', 'Could not start Git.'));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        void (async () => {
          await stopping;
          if (failure) throw failure;
          if (!(options.codes ?? [0]).includes(code ?? -1)) throw new GitError(code, diagnostic);
          return Buffer.concat(chunks).toString('utf8');
        })()
          .finally(() => this.children.delete(child))
          .then(resolve, reject);
      });
      child.stdin?.end(options.input);
    });
  }
  async close() {
    this.closed = true;
    for (const slots of [GitProcess.local, GitProcess.network])
      slots.waiting = slots.waiting.filter((entry) => {
        if (entry.owner !== this) return true;
        entry.reject(Error('Git process is closed'));
        return false;
      });
    await Promise.all([...this.children].map(killTree));
  }
}
