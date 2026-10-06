import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { SerialQueue } from './serial-queue';
import { GitProcess } from '../git/process';
import { readLocalJson, writeLocalJson } from './local-json';
import type { FileService } from './files';
import type { HibachiGroup, WorkspaceProfile, RepositoryInfo } from '../domain/types';
import { normalizeGroups } from '../domain/hibachi-groups';
import { t } from '../domain/i18n';
const group = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(120),
  scopeIds: z.array(z.uuid()).max(100),
  open: z.boolean(),
});
export const workspaceProfile = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(120),
  scopeIds: z.array(z.uuid()).max(100),
  groups: z.array(group).max(100).optional(),
});

export class WorkspaceService {
  private queue = new SerialQueue();
  constructor(private files: FileService) {}
  async list(): Promise<WorkspaceProfile[]> {
    return z
      .array(workspaceProfile)
      .parse(await readLocalJson(path.join(this.files.dataDir, 'workspaces.json'), []));
  }
  save(name: string, scopeIds: string[], id?: string) {
    return this.queue.run(async () => {
      scopeIds = [...new Set(scopeIds)];
      const current = await this.list();
      if (id && !current.some((item) => item.id === id)) throw Error('Unknown workspace');
      const previous = current.find((item) => item.id === id);
      // Editing a name must not discard temporarily unavailable repositories.
      scopeIds.forEach((scopeId) => {
        if (!previous?.scopeIds.includes(scopeId)) this.files.get(scopeId);
      });
      // Groups follow the hibachis that stay; one left empty goes.
      const groups = normalizeGroups(previous?.groups ?? [], scopeIds);
      const value = workspaceProfile.parse({
        id: id ?? randomUUID(),
        name,
        scopeIds,
        ...(groups.length && { groups }),
      });
      if (current.some((item) => item.id !== id && item.name === value.name))
        throw Error(
          t('同じ名前のワークスペースがあります。', 'A workspace with the same name exists.'),
        );
      await writeLocalJson(path.join(this.files.dataDir, 'workspaces.json'), [
        ...current.filter((item) => item.id !== id),
        value,
      ]);
      return value;
    });
  }
  saveGroups(id: string, groups: HibachiGroup[]) {
    return this.queue.run(async () => {
      const current = await this.list();
      const previous = current.find((item) => item.id === id);
      if (!previous) throw Error('Unknown workspace');
      const kept = normalizeGroups(z.array(group).max(100).parse(groups), previous.scopeIds);
      const { name, scopeIds } = previous;
      const value = workspaceProfile.parse({
        id,
        name,
        scopeIds,
        ...(kept.length && { groups: kept }),
      });
      await writeLocalJson(
        path.join(this.files.dataDir, 'workspaces.json'),
        current.map((item) => (item.id === id ? value : item)),
      );
      return value;
    });
  }
  /** Takes a removed hibachi out of every workspace and its groups. */
  forget(scopeId: string) {
    return this.queue.run(async () => {
      const current = await this.list();
      if (!current.some((item) => item.scopeIds.includes(scopeId))) return;
      await writeLocalJson(
        path.join(this.files.dataDir, 'workspaces.json'),
        current.map((item) => {
          if (!item.scopeIds.includes(scopeId)) return item;
          const { groups: previous = [], ...rest } = item;
          const scopeIds = item.scopeIds.filter((id) => id !== scopeId);
          const groups = normalizeGroups(previous, scopeIds);
          return workspaceProfile.parse({ ...rest, scopeIds, ...(groups.length && { groups }) });
        }),
      );
    });
  }
  /**
   * Takes in workspaces saved on another device (ADR 026). A workspace this
   * device has under the same id keeps its own hibachis beside the saved ones;
   * a different workspace with the same name keeps its name and the saved one
   * gets a numbered name. Hibachis not on this device stay as unavailable.
   * Returns how many workspaces were added or changed.
   */
  adopt(saved: WorkspaceProfile[]) {
    return this.queue.run(async () => {
      const current = await this.list();
      let changed = 0;
      for (const incoming of saved) {
        const index = current.findIndex((item) => item.id === incoming.id);
        const previous = current[index];
        const scopeIds = [...new Set([...incoming.scopeIds, ...(previous?.scopeIds ?? [])])].slice(
          0,
          100,
        );
        const groups = normalizeGroups(
          [...(incoming.groups ?? []), ...(previous?.groups ?? [])],
          scopeIds,
        );
        let name = previous?.name ?? incoming.name;
        const taken = (candidate: string) =>
          current.some((item) => item.id !== incoming.id && item.name === candidate);
        for (let n = 2; taken(name); n++) name = `${incoming.name.slice(0, 110)} (${n})`;
        const value = workspaceProfile.parse({
          id: incoming.id,
          name,
          scopeIds,
          ...(groups.length && { groups }),
        });
        if (JSON.stringify(value) === JSON.stringify(previous)) continue;
        if (previous) current[index] = value;
        else current.push(value);
        changed++;
      }
      if (changed) await writeLocalJson(path.join(this.files.dataDir, 'workspaces.json'), current);
      return changed;
    });
  }
  remove(id: string) {
    return this.queue.run(async () => {
      const current = await this.list();
      if (!current.some((item) => item.id === id)) throw Error('Unknown workspace');
      await writeLocalJson(
        path.join(this.files.dataDir, 'workspaces.json'),
        current.filter((item) => item.id !== id),
      );
    });
  }
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
  const runner = new GitProcess();
  const git = async (cwd: string, args: string[]) =>
    (await runner.run(cwd, args, { inspection: true })).trimEnd();
  try {
    root = await fs.realpath(root);
    if (!(await fs.stat(root)).isDirectory())
      throw Error(t('フォルダを選択してください。', 'Choose a folder.'));
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
          detail: t('Gitが見つかりません。', 'Git was not found.'),
        };
      }
      try {
        await fs.lstat(path.join(root, '.git'));
        return {
          root,
          kind: 'unavailable',
          detail: t('このGitリポジトリを確認できません。', 'Could not check this Git repository.'),
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      return {
        root,
        kind: 'folder',
        detail: t('通常のフォルダです。', 'An ordinary folder.'),
      };
    }
    gitRoot = await fs.realpath(gitRoot);
    if (root !== gitRoot)
      return {
        root: gitRoot,
        kind: 'unavailable',
        detail: t('リポジトリ内のサブフォルダです。', 'This is a subfolder of a repository.'),
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
      detail: t(
        'フォルダまたはGit情報を確認できません。',
        'Could not read the folder or its Git information.',
      ),
    };
  } finally {
    await runner.close();
  }
}
