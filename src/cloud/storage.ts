import type { CloudRoot } from '../domain/types';

/** The hibachis whose contents hold connected folders, as the file service lists them. */
export interface CloudStorage {
  readonly dataDir: string;
  get(id: string): CloudRoot | Promise<CloudRoot>;
  list(): CloudRoot[] | Promise<CloudRoot[]>;
  resolve(id: string, relative: string): Promise<string>;
}
