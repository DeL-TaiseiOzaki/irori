import { mkdir, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { CloudRoot } from '../domain/types';
import { within } from '../domain/scopes';
import type { FileService } from '../host/files';
import type { WorkspaceService } from '../host/workspaces';

export interface CloudStorage {
  readonly dataDir: string;
  get(id: string): CloudRoot | Promise<CloudRoot>;
  list(): CloudRoot[] | Promise<CloudRoot[]>;
  resolve(id: string, relative: string): Promise<string>;
}

// Workspace attachment roots are device-local and never registered as Git KBs.
// Legacy KB declarations remain readable in place; nothing is moved on upgrade.
export class WorkspaceCloudStorage implements CloudStorage {
  readonly dataDir: string;
  constructor(
    private files: FileService,
    private workspaces: WorkspaceService,
  ) {
    this.dataDir = files.dataDir;
  }
  async list(): Promise<CloudRoot[]> {
    const profiles = await this.workspaces.list();
    return [
      ...this.files.list(),
      ...profiles.map((profile) => ({
        scopeId: profile.id,
        name: profile.name,
        root: path.join(this.dataDir, 'workspace-cloud', profile.id),
        contents: ['contents'],
        workspace: true,
      })),
    ];
  }
  async get(id: string) {
    const matches = (await this.list()).filter((item) => item.scopeId === id);
    if (matches.length !== 1) throw Error('Unknown or ambiguous cloud owner');
    const root = matches[0];
    if (root.workspace) {
      const base = await realpath(this.dataDir);
      let directory = this.dataDir;
      for (const part of ['workspace-cloud', id]) {
        directory = path.join(directory, part);
        await mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'EEXIST') throw error;
        });
        const info = await lstat(directory);
        if (
          !info.isDirectory() ||
          info.isSymbolicLink() ||
          !within(base, await realpath(directory))
        )
          throw Error('Workspace cloud storage must not be an alias');
      }
      root.root = await realpath(root.root);
    }
    return root;
  }
  async resolve(id: string, relative: string) {
    const root = await this.get(id);
    if (!root.workspace) return this.files.resolve(id, relative);
    if (relative !== '.irori') throw Error('Only cloud metadata is resolved by this storage');
    const directory = path.join(root.root, relative);
    await mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw Error('Cloud metadata must not be an alias');
    return directory;
  }
}
