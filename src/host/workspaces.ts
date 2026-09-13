import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { launch, killTree, agentEnv } from '../agents/process';
import { readLocalJson, writeLocalJson } from './local-json';
import type { FileService } from './files';
import type { WorkspaceProfile, RepositoryInfo } from '../domain/types';
const profile = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(120),
  scopeIds: z.array(z.uuid()).min(1).max(100),
});

export class WorkspaceService {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private files: FileService) {}
  async list(): Promise<WorkspaceProfile[]> {
    return z
      .array(profile)
      .parse(await readLocalJson(path.join(this.files.dataDir, 'workspaces.json'), []));
  }
  save(name: string, scopeIds: string[], id?: string) {
    const operation = this.queue.then(async () => {
      scopeIds = [...new Set(scopeIds)];
      const current = await this.list();
      if (id && !current.some((item) => item.id === id)) throw Error('Unknown workspace');
      const previous = current.find((item) => item.id === id);
      // Editing a name must not discard temporarily unavailable repositories.
      scopeIds.forEach((scopeId) => {
        if (!previous?.scopeIds.includes(scopeId)) this.files.get(scopeId);
      });
      const value = profile.parse({ id: id ?? randomUUID(), name, scopeIds });
      if (current.some((item) => item.id !== id && item.name === value.name))
        throw Error('同じ名前のワークスペースがあります。');
      await writeLocalJson(path.join(this.files.dataDir, 'workspaces.json'), [
        ...current.filter((item) => item.id !== id),
        value,
      ]);
      return value;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  remove(id: string) {
    const operation = this.queue.then(async () => {
      const current = await this.list();
      if (!current.some((item) => item.id === id)) throw Error('Unknown workspace');
      await writeLocalJson(
        path.join(this.files.dataDir, 'workspaces.json'),
        current.filter((item) => item.id !== id),
      );
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}

async function git(cwd: string, args: string[]) {
  const env = agentEnv();
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  env.GIT_TERMINAL_PROMPT = '0';
  env.GIT_OPTIONAL_LOCKS = '0';
  const child = launch(
    'git',
    ['--no-optional-locks', '-c', 'core.fsmonitor=false', ...args],
    cwd,
    env,
  );
  return new Promise<string>((resolve, reject) => {
    let stdout = '';
    let stopped = false;
    const timer = setTimeout(() => {
      stopped = true;
      void killTree(child);
      reject(Error('Git inspection timed out'));
    }, 8000);
    child.stdout?.on('data', (b) => {
      stdout += b.toString();
      if (stdout.length > 1024 * 1024 && !stopped) {
        stopped = true;
        void killTree(child);
        reject(Error('Git output exceeds limit'));
      }
    });
    child.stderr?.resume();
    child.stdin?.end();
    child.on('error', () => {
      clearTimeout(timer);
      reject(Error('Gitを起動できません。'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (!stopped)
        code === 0 ? resolve(stdout.trimEnd()) : reject(Error('Git情報を取得できません。'));
    });
  });
}
export function githubRepository(remote: string): string | undefined {
  // Return only an owner/repository identity; never display embedded credentials or query strings.
  const scp = /^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(remote);
  if (scp) return `${scp[1]}/${scp[2]}`;
  try {
    const url = new URL(remote);
    if (url.hostname.toLowerCase() !== 'github.com' || !['https:', 'ssh:'].includes(url.protocol))
      return;
    const parts = /^\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url.pathname);
    if (parts) return `${parts[1]}/${parts[2]}`;
  } catch {
    /* not a supported GitHub remote */
  }
}
export async function inspectRepository(root: string): Promise<RepositoryInfo> {
  try {
    root = await fs.realpath(root);
    if (!(await fs.stat(root)).isDirectory()) throw Error('フォルダを選択してください。');
    let gitRoot: string;
    try {
      gitRoot = await git(root, ['rev-parse', '--show-toplevel']);
    } catch {
      // Distinguish ordinary folders from a broken/untrusted checkout or missing Git installation.
      try {
        await git(root, ['--version']);
      } catch {
        return {
          root,
          kind: 'unavailable',
          detail: 'Gitが見つかりません。Gitをインストールしてください。',
        };
      }
      try {
        await fs.lstat(path.join(root, '.git'));
        return {
          root,
          kind: 'unavailable',
          detail: 'このGitリポジトリを確認できません。所有者・権限を確認してください。',
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      return {
        root,
        kind: 'folder',
        detail: '通常のフォルダです。既存ノートをそのまま登録できます。',
      };
    }
    gitRoot = await fs.realpath(gitRoot);
    if (root !== gitRoot)
      return {
        root: gitRoot,
        kind: 'unavailable',
        detail: 'リポジトリ内のサブフォルダです。表示されたリポジトリのルートを選択してください。',
      };
    const [remote, branch, changes] = await Promise.all([
      git(root, ['config', '--get', 'remote.origin.url']).catch(() => ''),
      git(root, ['symbolic-ref', '--short', 'HEAD']).catch(() => 'detached HEAD'),
      git(root, [
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=normal',
        '--ignore-submodules=all',
      ]),
    ]);
    const repository = githubRepository(remote);
    return { root, kind: repository ? 'github' : 'git', repository, branch, changed: !!changes };
  } catch {
    return {
      root,
      kind: 'unavailable',
      detail: 'フォルダまたはGit情報を確認できません。接続先とアクセス権を確認してください。',
    };
  }
}
