import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  endsWithWritten,
  pathCandidates,
  type AgentPathQuery,
  type PathRoot,
  type PathTarget,
} from '../domain/path-links';
import type { Space, WorkspaceProfile } from '../domain/types';
import type { YourAiService } from './you';

/** How many files a search by name looks at before it stops, and how many it returns. */
const walkLimit = 20000;
const matchLimit = 20;
const skipped = new Set(['.git', 'node_modules']);

/**
 * Finds the file a path in an agent's reply names (ADR 044). The folders are
 * the workspace's vaults, the irori agent's folder for that workspace, and each
 * connected folder's real place, which stands for its path inside the vault. A
 * path is looked for where its writer works first; a name alone, or the tail of
 * a path, is looked for by name when no folder has it as written.
 */
export class AgentPaths {
  constructor(
    private deps: {
      files: {
        list(): Space[];
        resolve(scopeId: string, rel: string): Promise<string>;
        cloud?: { linkedFolders?(scopeId: string): { path: string; target: string }[] };
      };
      you: Pick<YourAiService, 'load' | 'rootOf' | 'schemaFolder'>;
      workspaces: () => Promise<WorkspaceProfile[]>;
    },
  ) {}
  private async vaults(workspaceId?: string) {
    const spaces = this.deps.files.list();
    if (!workspaceId) return spaces;
    const profile = (await this.deps.workspaces()).find((item) => item.id === workspaceId);
    if (!profile) return spaces;
    return profile.scopeIds.flatMap((id) => spaces.filter((space) => space.scopeId === id));
  }
  /** The folders a path in a reply may land in, for a workspace or every vault without one. */
  async roots(workspaceId?: string): Promise<PathRoot[]> {
    const { id } = await this.deps.you.load();
    const roots: PathRoot[] = [];
    for (const space of await this.vaults(workspaceId)) {
      roots.push({ scopeId: space.scopeId, root: space.root });
      for (const folder of this.deps.files.cloud?.linkedFolders?.(space.scopeId) ?? [])
        roots.push({ scopeId: space.scopeId, root: folder.target, prefix: folder.path });
    }
    const you = this.deps.you.rootOf(id, workspaceId);
    if (you) roots.push({ scopeId: id, root: await fs.realpath(you).catch(() => you) });
    return roots;
  }
  /** Whether a file is there, through each folder's own guards. */
  private async exists(target: PathTarget, workspaceId: string | undefined, you: string) {
    try {
      const file =
        target.scopeId === you
          ? await (await this.deps.you.schemaFolder(workspaceId)).resolve(target.path)
          : await this.deps.files.resolve(target.scopeId, target.path);
      return (await fs.stat(file)).isFile();
    } catch {
      return false;
    }
  }
  /**
   * The file a written path names: the first candidate that is there, or else
   * every file whose path ends as written, the writer's own first. Empty when
   * none is.
   */
  async locate(query: AgentPathQuery): Promise<PathTarget[]> {
    const { id } = await this.deps.you.load();
    const roots = await this.roots(query.workspaceId);
    for (const target of pathCandidates(query.path, roots, query.from))
      if (await this.exists(target, query.workspaceId, id)) return [target];
    if (path.isAbsolute(query.path) || /^[a-z]:[\\/]/i.test(query.path)) return [];
    const starts = roots.filter((root) => !root.prefix);
    const order = [
      ...starts.filter((root) => root.scopeId === query.from),
      ...starts.filter((root) => root.scopeId !== query.from),
    ];
    const found: PathTarget[] = [];
    const tails = [query.path, ...(/^[ab]\/./.test(query.path) ? [query.path.slice(2)] : [])];
    let budget = walkLimit;
    for (const root of order) {
      // Another vault's folder inside this one is that vault's to search.
      const inner = new Set(
        starts
          .filter((other) => other !== root && other.root.startsWith(`${root.root}${path.sep}`))
          .map((other) => other.root),
      );
      const queue = [''];
      while (queue.length && budget > 0 && found.length < matchLimit) {
        const rel = queue.shift()!;
        const dir = path.join(root.root, ...rel.split('/').filter(Boolean));
        if (rel && inner.has(dir)) continue;
        const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
          if (--budget < 0) break;
          if (skipped.has(entry.name)) continue;
          const child = rel ? `${rel}/${entry.name}` : entry.name;
          // Links lead out of the folder, connected folders among them.
          if (entry.isDirectory()) queue.push(child);
          else if (entry.isFile() && tails.some((tail) => endsWithWritten(child, tail))) {
            const target = { scopeId: root.scopeId, path: child };
            if (await this.exists(target, query.workspaceId, id)) found.push(target);
            if (found.length >= matchLimit) break;
          }
        }
      }
    }
    return found;
  }
}
