import type { FileService } from './files';
import type { WorkspaceService } from './workspaces';
import type { Space } from '../domain/types';
import { within } from '../domain/scopes';
import { t } from '../domain/i18n';

export interface RemoveSpaceHost {
  files: FileService;
  workspaces: WorkspaceService;
  /** Folders that never go to the trash with a hibachi: the irori agent's and irori's own data. */
  keep: () => Promise<string[]>;
  /**
   * Lets go of the hibachi's folder: its terminals, connected folders and watcher.
   * Returns how to take it up again if the folder cannot be moved.
   */
  release: (space: Space) => Promise<() => Promise<void>>;
  trash: (folder: string) => Promise<void>;
}

/**
 * Removes a hibachi from this device's list and from every workspace. With
 * `trash`, its folder also goes to the system trash, where it can be restored;
 * otherwise the folder stays as it is and can be registered again.
 */
export async function removeSpace(host: RemoveSpaceHost, scopeId: string, trash: boolean) {
  const space = host.files.get(scopeId);
  if (trash) {
    const nested = host.files
      .list()
      .filter((item) => item.scopeId !== scopeId && within(space.root, item.root));
    if (nested.length) {
      const names = nested.map((item) => item.name).join(t('・', ', '));
      throw Error(
        t(
          `${names} のフォルダが中にあるため、ゴミ箱に移せません。`,
          `The folder holds ${names}, so it cannot go to the trash.`,
        ),
      );
    }
    const kept = (await host.keep()).find((folder) => within(space.root, folder));
    if (kept)
      throw Error(
        t(
          `${kept} が中にあるため、ゴミ箱に移せません。`,
          `The folder holds ${kept}, so it cannot go to the trash.`,
        ),
      );
  }
  const takeUp = await host.release(space);
  let moved = false;
  try {
    if (trash) {
      await host.trash(space.root).catch((error: Error) => {
        throw Error(
          t(
            `フォルダをゴミ箱に移せませんでした: ${error.message}`,
            `The folder could not be moved to the trash: ${error.message}`,
          ),
        );
      });
      moved = true;
    }
    await host.files.unregister(scopeId);
  } catch (error) {
    // A hibachi whose folder is still there stays as it was.
    if (!moved) await takeUp().catch(() => {});
    throw error;
  }
  await host.workspaces.forget(scopeId);
}
