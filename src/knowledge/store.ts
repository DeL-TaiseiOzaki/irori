import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { hash } from '../host/files';
import { readLocalJson, writeLocalFile, writeLocalJson } from '../host/local-json';
import { SerialQueue } from '../host/serial-queue';
import {
  sourceRef,
  sourceVersion,
  runRecord,
  artifactRecord,
  type SourceRef,
  type SourceVersion,
  type RunRecord,
  type KnowledgeHistory,
} from '../domain/knowledge';
import type { StartRun } from '../domain/types';

/** Private immutable bytes and observations. No transcripts or cross-KB metadata are published. */
export class KnowledgeStore {
  readonly directory: string;
  private queue = new SerialQueue();
  constructor(
    dataDir: string,
    private resolve: (ref: SourceRef) => Promise<string>,
  ) {
    this.directory = path.join(dataDir, 'knowledge');
  }
  blobPath(digest: string) {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw Error('Invalid source version');
    return path.join(this.directory, 'blobs', digest);
  }
  async bytes(version: SourceVersion) {
    const bytes = await fs.readFile(this.blobPath(version.hash));
    if (bytes.length !== version.size || hash(bytes) !== version.hash)
      throw Error('保持した資料の整合性を確認できません。');
    return bytes;
  }
  capture(ref: SourceRef): Promise<SourceVersion> {
    return this.queue.run(async () => {
      sourceRef.parse(ref);
      const filename = await this.resolve(ref);
      const stat = await fs.stat(filename);
      if (!stat.isFile() || stat.size > 64 * 1024 * 1024)
        throw Error('保持できる資料は 64 MiB 以下のファイルです。');
      const bytes = await fs.readFile(filename);
      if (bytes.length > 64 * 1024 * 1024) throw Error('資料のサイズ上限を超えています。');
      const digest = hash(bytes);
      // Re-read to reject a file that changed while being observed (no filesystem snapshot claim).
      if (hash(await fs.readFile(filename)) !== digest)
        throw Error('資料が変更中です。保存完了後に再試行してください。');
      const indexFile = path.join(this.directory, `index-${ref.scopeId}.json`);
      const index = z.record(z.string(), z.uuid()).parse(await readLocalJson(indexFile, {}));
      const known = Object.hasOwn(index, ref.path);
      const id = known ? index[ref.path] : randomUUID();
      if (!known) {
        index[ref.path] = id;
        await writeLocalJson(indexFile, index);
      }
      const blob = this.blobPath(digest);
      try {
        if (hash(await fs.readFile(blob)) !== digest) throw Error('保持した資料が破損しています。');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        await writeLocalFile(blob, bytes);
      }
      return { ...ref, id, hash: digest, size: bytes.length, capturedAt: new Date().toISOString() };
    });
  }
  async begin(id: string, input: StartRun) {
    const references = [
      ...(input.sources ?? []),
      ...(input.notePath ? [{ scopeId: input.scopeId, path: input.notePath }] : []),
    ];
    const unique = references.filter(
      (ref, i) =>
        references.findIndex(
          (other) => other.scopeId === ref.scopeId && other.path === ref.path,
        ) === i,
    );
    const sources: SourceVersion[] = [];
    for (const ref of unique) sources.push(await this.capture(ref));
    const record = runRecord.parse({
      id,
      scopeId: input.scopeId,
      agent: input.agent,
      createdAt: new Date().toISOString(),
      sources,
    });
    await this.immutable(path.join(this.directory, 'runs', input.scopeId, `${id}.json`), record);
    return record;
  }
  async finish(record: RunRecord, outcome: NonNullable<RunRecord['outcome']>) {
    await this.immutable(
      path.join(this.directory, 'outcomes', record.scopeId, `${record.id}.json`),
      { outcome },
    );
  }
  private async immutable(filename: string, record: unknown) {
    try {
      await fs.access(filename);
      throw Error('An immutable record already exists');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await writeLocalJson(filename, record);
  }
  async history(scopeId: string): Promise<KnowledgeHistory> {
    z.uuid().parse(scopeId);
    const readRecords = async (kind: string) => {
      const dir = path.join(this.directory, kind, scopeId);
      const names = await fs.readdir(dir).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== 'ENOENT') throw e;
        return [];
      });
      return Promise.all(
        names
          .filter((name) => /^[a-f0-9-]{36}\.json$/.test(name))
          .map((name) => readLocalJson(path.join(dir, name), null)),
      );
    };
    const runs = (await readRecords('runs')).map((value) => runRecord.parse(value));
    const enriched: RunRecord[] = [];
    for (const run of runs) {
      const state = await readLocalJson(
        path.join(this.directory, 'outcomes', scopeId, `${run.id}.json`),
        null,
      );
      enriched.push({
        ...run,
        outcome: state
          ? z.object({ outcome: z.enum(['completed', 'failed', 'cancelled']) }).parse(state).outcome
          : undefined,
      });
    }
    return {
      runs: enriched.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100),
      artifacts: (await readRecords('artifacts'))
        .map((value) => artifactRecord.parse(value))
        .sort((a, b) => b.registeredAt.localeCompare(a.registeredAt))
        .slice(0, 100),
    };
  }
  async artifact(ref: SourceRef, runId: string) {
    sourceRef.parse(ref);
    z.uuid().parse(runId);
    const run = runRecord.parse(
      await readLocalJson(path.join(this.directory, 'runs', ref.scopeId, `${runId}.json`), null),
    );
    if (run.scopeId !== ref.scopeId) throw Error('成果物は実行したスペースで登録してください。');
    const source = await this.capture(ref);
    const record = artifactRecord.parse({
      id: randomUUID(),
      runId,
      source,
      registeredAt: new Date().toISOString(),
      evidence: 'manual-registration',
    });
    await this.immutable(
      path.join(this.directory, 'artifacts', ref.scopeId, `${record.id}.json`),
      record,
    );
    return record;
  }
  async sourceText(version: SourceVersion) {
    sourceVersion.parse(version);
    if (version.size > 2 * 1024 * 1024)
      throw Error('この資料のプレビューは 2 MiB を超えています。');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(await this.bytes(version));
    if (text.includes('\0')) throw Error('この資料はバイナリ形式です。');
    return text;
  }
  rebind(previous: SourceVersion, next: SourceRef) {
    return this.queue.run(async () => {
      sourceVersion.parse(previous);
      sourceRef.parse(next);
      if (previous.scopeId !== next.scopeId)
        throw Error('資料 ID は同じスペース内で再接続してください。');
      const filename = await this.resolve(next);
      if (hash(await fs.readFile(filename)) !== previous.hash)
        throw Error('移動先の版が一致しません。');
      const indexFile = path.join(this.directory, `index-${next.scopeId}.json`);
      const index = z.record(z.string(), z.uuid()).parse(await readLocalJson(indexFile, {}));
      if (index[previous.path] !== previous.id || index[next.path])
        throw Error('資料の登録状態が変わっています。');
      delete index[previous.path];
      index[next.path] = previous.id;
      await writeLocalJson(indexFile, index);
    });
  }
}
