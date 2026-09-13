import path from 'node:path';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { KnowledgeStore } from '../knowledge/store';
import { pendingWrite, type PendingWrite, type SourceRef } from '../domain/knowledge';
import { readLocalJson, writeLocalJson } from '../host/local-json';
import { SerialQueue } from '../host/serial-queue';
import type { RcloneAPI } from './rclone';

export interface WriteTarget {
  ownerId: string;
  mountId: string;
  folderId: string;
}
export interface Delivery {
  observe(name: string): Promise<{ hash: string; size: number } | null>;
  copy(filename: string, name: string): Promise<void>;
}
/** Staging is independent of the mount path. A missing mount is never a local destination. */
export class CloudOutbox {
  private directory: string;
  private queue = new SerialQueue();
  constructor(
    dataDir: string,
    private knowledge: KnowledgeStore,
  ) {
    this.directory = path.join(dataDir, 'cloud-outbox');
  }
  private filename(ownerId: string, id: string) {
    z.uuid().parse(ownerId);
    z.uuid().parse(id);
    return path.join(this.directory, ownerId, `${id}.json`);
  }
  async list(ownerId: string): Promise<PendingWrite[]> {
    z.uuid().parse(ownerId);
    const names = await fs
      .readdir(path.join(this.directory, ownerId))
      .catch((e: NodeJS.ErrnoException) => {
        if (e.code !== 'ENOENT') throw e;
        return [];
      });
    const entries = await Promise.all(
      names
        .filter((name) => /^[a-f0-9-]{36}\.json$/.test(name))
        .map((name) => readLocalJson(path.join(this.directory, ownerId, name), null)),
    );
    return entries
      .map((value) => pendingWrite.parse(value))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  prepare(target: WriteTarget, ref: SourceRef) {
    return this.queue.run(async () => {
      const source = await this.knowledge.capture(ref);
      const record = pendingWrite.parse({
        ...target,
        id: randomUUID(),
        name: path.posix.basename(ref.path),
        source,
        createdAt: new Date().toISOString(),
        state: 'pending',
      });
      await writeLocalJson(this.filename(record.ownerId, record.id), record);
      return record;
    });
  }
  // The read-only Google host does not expose this operation. A writable capability and
  // exact attachment/account binding must be supplied before integrating native delivery.
  deliver(ownerId: string, id: string, target: WriteTarget, remote: Delivery) {
    return this.queue.run(async () => {
      const filename = this.filename(ownerId, id);
      let record = pendingWrite.parse(await readLocalJson(filename, null));
      if (
        record.ownerId !== target.ownerId ||
        record.mountId !== target.mountId ||
        record.folderId !== target.folderId
      )
        throw Error('送信先の識別情報が変わっています。');
      if (record.state === 'confirmed') return record;
      const persist = async (state: PendingWrite['state'], detail?: string) => {
        record = {
          ...record,
          state,
          detail,
          confirmedAt: state === 'confirmed' ? new Date().toISOString() : undefined,
        };
        await writeLocalJson(filename, record);
        return record;
      };
      try {
        await this.knowledge.bytes(record.source);
        const matches = (value: { hash: string; size: number } | null) =>
          value?.hash === record.source.hash && value.size === record.source.size;
        const existing = await remote.observe(record.name);
        if (matches(existing)) return persist('confirmed'); // A previous uncertain copy completed.
        if (existing) return persist('failed', '送信先に異なる版があります。上書きしていません。');
        await persist('uploading');
        await remote.copy(this.knowledge.blobPath(record.source.hash), record.name);
        if (!matches(await remote.observe(record.name))) throw Error('Remote bytes not confirmed');
        return persist('confirmed');
      } catch {
        return persist('failed', '送信完了を確認できません。元の版を端末に保持しています。');
      }
    });
  }
}
/** Established rclone copy + downloaded checksum; no Google API reimplementation. */
export function rcloneDelivery(rpc: RcloneAPI, remoteFs: string): Delivery {
  return {
    async observe(name) {
      const { item } = await rpc.call('operations/stat', { fs: remoteFs, remote: name });
      if (!item) return null;
      if (item.IsDir) throw Error('Destination is a directory');
      const result = await rpc.call('operations/hashsumfile', {
        fs: remoteFs,
        remote: name,
        hashType: 'sha256',
        download: true,
      });
      return {
        hash: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .parse(result.hash),
        size: z.number().int().nonnegative().parse(item.Size),
      };
    },
    async copy(filename, name) {
      await rpc.call('operations/copyfile', {
        srcFs: path.dirname(filename),
        srcRemote: path.basename(filename),
        dstFs: remoteFs,
        dstRemote: name,
        _config: { Immutable: true },
      });
    },
  };
}
