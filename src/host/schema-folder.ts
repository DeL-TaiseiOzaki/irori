import type { Entry, Layer } from '../domain/types';
import { classify } from '../domain/scopes';
import type { FileService } from './files';

/**
 * A folder whose Schema the settings read and write: a hibachi's checkout, or
 * the irori agent's own folder. Each says where it is and how a path in it is
 * resolved, so the same rules (setting paths, no alias on the way, hash-checked
 * writes) hold for both.
 */
export interface SchemaFolder {
  /** The folder's real path. */
  root: string;
  /**
   * Whether its knowledge folders may hold their own `AGENTS.md` (a hibachi).
   * The irori agent's folder has instructions only at its root.
   */
  knowledge: boolean;
  layer(relative: string): Layer;
  /** One folder's entries; a link is listed as blocked. */
  entries(relative: string): Promise<Pick<Entry, 'path' | 'name' | 'directory' | 'blocked'>[]>;
  /** The real file a path names, refused when it or an alias on the way leaves the folder. */
  resolve(relative: string): Promise<string>;
  read(relative: string): Promise<string>;
}

/** A hibachi's checkout, through the file service and its own boundary checks. */
export function spaceFolder(files: FileService, scopeId: string): SchemaFolder {
  const space = files.get(scopeId);
  return {
    root: space.root,
    knowledge: true,
    layer: (relative) => classify(space, relative),
    entries: (relative) => files.entries(scopeId, relative),
    resolve: (relative) => files.resolve(scopeId, relative),
    read: async (relative) => (await files.read(scopeId, relative)).text,
  };
}
