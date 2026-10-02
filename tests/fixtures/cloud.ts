// Shared fixtures for the cloud service: a hibachi with a folder outside it, standing
// for one a sync app keeps on this device, connected the way irori connects it, through
// a real link at `contents/<name>` (ADR 019). A Google Drive declaration from before
// 0.1.67 can be written beside it to stand for a retired connection (ADR 023).
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileService } from '../../src/host/files';
import { CloudService } from '../../src/cloud/service';
import type { CloudAttachment, Space } from '../../src/domain/types';

export const connectionName = 'Connected fixture';
export const connectionRoot = `contents/${connectionName}`;

/** A hibachi and a cloud service whose trash records each entry and removes it. */
export async function fixture(t: any) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori cloud 日本語 '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const root = path.join(base, 'KB');
  await mkdir(root);
  const space = await files.register(root, 'Personal', 'personal');
  const trashed: string[] = [];
  const trash = async (filename: string) => {
    trashed.push(filename);
    await rm(filename, { recursive: true });
  };
  const cloud = new CloudService(files, trash);
  files.cloud = cloud;
  return { base, files, space, cloud, trash, trashed };
}

/** A folder outside the hibachi, as a sync app keeps one, by its real path. */
export async function syncedFolder(base: string, name = 'Shared folder') {
  const folder = path.join(base, 'Sync 同期', name);
  await mkdir(folder, { recursive: true });
  return realpath(folder);
}

/**
 * A folder on this device registered and connected at `contents/Connected fixture`.
 * `target` is the folder itself; `entry` is the link irori made in contents.
 */
export async function connectedFixture(t: any, { writable = false } = {}) {
  const value = await fixture(t);
  const { base, cloud, space } = value;
  const target = await syncedFolder(base);
  const connection = await cloud.addLocal({
    scopeId: space.scopeId,
    path: target,
    contentsRoot: 'contents',
    name: connectionName,
    access: writable ? 'read-write' : 'read-only',
  });
  await cloud.connect(space.scopeId, connection.mountId);
  const entry = path.join(space.root, 'contents', connectionName);
  return { ...value, connection, target, entry };
}

/** A Google Drive declaration as irori wrote it before 0.1.67, valid for its schema. */
export function retiredDeclaration(
  space: Pick<Space, 'scopeId'>,
  overrides: Partial<CloudAttachment> = {},
): CloudAttachment {
  return {
    schemaVersion: 1,
    mountId: randomUUID(),
    scopeId: space.scopeId,
    provider: 'google-drive',
    folderId: 'folder-one',
    parentId: 'root',
    folderName: 'Drive original name',
    contentsRoot: 'contents',
    name: 'Drive',
    access: 'read-write',
    ...overrides,
  };
}

/** Adds retired declarations to a hibachi's `.irori/cloud-mounts.json`. */
export async function writeRetired(space: Pick<Space, 'root'>, ...records: CloudAttachment[]) {
  const filename = path.join(space.root, '.irori', 'cloud-mounts.json');
  const existing = JSON.parse(await readFile(filename, 'utf8').catch(() => '[]'));
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, JSON.stringify([...existing, ...records]));
}
