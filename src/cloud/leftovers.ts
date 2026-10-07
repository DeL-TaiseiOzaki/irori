import path from 'node:path';
import { promises as fs } from 'node:fs';
import { z } from 'zod';
import { pendingWrite, type CloudWriteRecovery, type PendingWrite } from '../domain/knowledge';
import { isMissing, readLocalJson, writeLocalJson } from '../host/local-json';
import { SerialQueue } from '../host/serial-queue';

// rclone's VFS cache keeps each file's state beside its data: `vfsMeta/<fs>/<path>`
// is JSON whose `Dirty` is true until the file has been uploaded, and
// `vfs/<fs>/<path>` holds the bytes (rclone 1.75, checked on 2026-10-02).
const cacheItem = z.object({ ModTime: z.string(), Size: z.number(), Dirty: z.boolean() });
const exported = z.object({ items: z.array(z.string()).max(100000) });

/**
 * What Google Drive connections left on this device when irori stopped connecting
 * to Drive itself (ADR 023): changes that never reached Drive, still in rclone's
 * write cache, and the copies once prepared for upload. Both can be saved to a
 * folder the person chooses; nothing here deletes them.
 */
export class DriveLeftovers {
  private cache: string;
  private outbox: string;
  private marker: string;
  private queue = new SerialQueue();
  constructor(dataDir: string) {
    this.cache = path.join(dataDir, 'rclone', 'cache');
    this.outbox = path.join(dataDir, 'cloud-outbox');
    this.marker = path.join(dataDir, 'rclone', 'unsent-exported.json');
  }
  /** Changed files that never reached Drive and have not been saved elsewhere yet. */
  async unsent(): Promise<{ path: string; key: string }[]> {
    const meta = path.join(this.cache, 'vfsMeta');
    const done = new Set(
      exported.safeParse(await readLocalJson(this.marker, { items: [] }).catch(() => null)).data
        ?.items ?? [],
    );
    const found: { path: string; key: string }[] = [];
    const walk = async (directory: string): Promise<void> => {
      const items = await fs.readdir(directory, { withFileTypes: true }).catch((error) => {
        if (!isMissing(error)) throw error;
        return [];
      });
      for (const item of items) {
        const filename = path.join(directory, item.name);
        if (item.isDirectory()) await walk(filename);
        else if (item.isFile()) {
          const info = cacheItem.safeParse(await readLocalJson(filename, null).catch(() => null));
          if (!info.success || !info.data.Dirty) continue;
          const rel = path.relative(meta, filename).split(path.sep).join('/');
          const key = `${rel}@${info.data.ModTime}`;
          if (!done.has(key)) found.push({ path: rel, key });
        }
      }
    };
    await walk(meta);
    return found.sort((a, b) => a.path.localeCompare(b.path));
  }
  /**
   * Copies the unsent files into `destination`, keeping their folders, and
   * remembers them so they are not offered again. An existing file is never replaced.
   */
  exportUnsent(destination: string) {
    return this.queue.run(async () => {
      const items = await this.unsent();
      const root = path.resolve(destination);
      for (const item of items) {
        const source = path.join(this.cache, 'vfs', ...item.path.split('/'));
        const target = path.join(root, ...item.path.split('/'));
        if (!target.startsWith(root + path.sep)) throw Error('Invalid cache path');
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.copyFile(source, target, fs.constants.COPYFILE_EXCL);
      }
      const previous =
        exported.safeParse(await readLocalJson(this.marker, { items: [] }).catch(() => null)).data
          ?.items ?? [];
      await writeLocalJson(this.marker, { items: [...previous, ...items.map((item) => item.key)] });
      return items.length;
    });
  }
  /** The copies once prepared for upload, restorable to a separate file. */
  async prepared(): Promise<CloudWriteRecovery> {
    const entries: PendingWrite[] = [];
    let unreadable = 0;
    const owners = await fs.readdir(this.outbox, { withFileTypes: true }).catch((error) => {
      if (!isMissing(error)) throw error;
      return [];
    });
    for (const owner of owners) {
      if (!owner.isDirectory() || !z.uuid().safeParse(owner.name).success) continue;
      try {
        const directory = path.join(this.outbox, owner.name);
        for (const file of await fs.readdir(directory, { withFileTypes: true })) {
          if (!file.name.endsWith('.json') || !z.uuid().safeParse(file.name.slice(0, -5)).success)
            continue;
          try {
            if (!file.isFile()) throw Error('Recovery metadata must be a regular file');
            const record = pendingWrite.parse(
              await readLocalJson(path.join(directory, file.name), null),
            );
            if (record.ownerId !== owner.name || `${record.id}.json` !== file.name)
              throw Error('Recovery identity does not match its container');
            entries.push(record);
          } catch {
            unreadable++;
          }
        }
      } catch {
        unreadable++;
      }
    }
    return { entries: entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), unreadable };
  }
}
