import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  draftKey,
  draftValue,
  draftRevision,
  type DraftKey,
  type DraftValue,
  type DraftRecord,
} from '../domain/drafts';
import { FileService, hash } from './files';
import { SerialQueue } from './serial-queue';
import { writeLocalJson } from './local-json';

const storedDraft = draftValue
  .extend({
    schemaVersion: z.literal(1),
    identity: z.string().regex(/^[a-f0-9]{64}$/),
    revision: z.uuid(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
const maxRecordBytes = 13 * 1024 * 1024; // JSON may escape every character; text itself is bounded to 2 MiB.

export class DraftService {
  private queue = new SerialQueue();
  constructor(private files: Pick<FileService, 'dataDir' | 'get'>) {}
  idle() {
    return this.queue.idle();
  }
  private async target(raw: DraftKey) {
    const key = draftKey.parse(raw);
    const root = await fs.realpath(this.files.get(key.scopeId).root);
    const identity = hash(
      JSON.stringify([
        root,
        key.scopeId,
        key.kind,
        key.kind === 'composer' ? key.agent : key.kind === 'git-resolution' ? key.path : '',
      ]),
    );
    const directory = path.join(this.files.dataDir, 'drafts');
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    if (!(await fs.lstat(directory)).isDirectory())
      throw Error('Draft storage must be an ordinary directory');
    return { key, identity, filename: path.join(directory, `${identity}.json`) };
  }
  private async readTarget(
    target: Awaited<ReturnType<DraftService['target']>>,
  ): Promise<DraftRecord | null> {
    try {
      const stat = await fs.lstat(target.filename);
      if (!stat.isFile() || stat.size > maxRecordBytes) throw Error('Invalid draft record');
      const record = storedDraft.parse(JSON.parse(await fs.readFile(target.filename, 'utf8')));
      if (record.identity !== target.identity) throw Error('Draft identity mismatch');
      if (record.text !== null && Buffer.byteLength(record.text) > 2 * 1024 * 1024)
        throw Error('Draft is too large');
      if (target.key.kind === 'git-resolution' && record.text !== null && !record.baseVersion)
        throw Error('Conflict draft has no base version');
      return {
        text: record.text,
        baseVersion: record.baseVersion,
        revision: record.revision,
        updatedAt: record.updatedAt,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  read(key: DraftKey) {
    return this.queue.run(async () => this.readTarget(await this.target(key)));
  }
  write(rawKey: DraftKey, rawValue: DraftValue, expectedRevision: string | null) {
    return this.queue.run(async () => {
      const target = await this.target(rawKey);
      const value = draftValue.parse(rawValue);
      draftRevision.parse(expectedRevision);
      if (value.text !== null && Buffer.byteLength(value.text) > 2 * 1024 * 1024)
        throw Error('Draft is too large');
      if (target.key.kind === 'git-resolution' && value.text !== null && !value.baseVersion)
        throw Error('Conflict draft requires its base version');
      const existing = await this.readTarget(target);
      if ((existing?.revision ?? null) !== expectedRevision)
        throw Error(
          '別の操作で下書きが更新されました。入力を保持したまま、保存を再試行してください。',
        );
      const record: DraftRecord = {
        ...value,
        revision: randomUUID(),
        updatedAt: new Date().toISOString(),
      };
      await writeLocalJson(target.filename, {
        schemaVersion: 1,
        identity: target.identity,
        ...record,
      });
      return record;
    });
  }
}
