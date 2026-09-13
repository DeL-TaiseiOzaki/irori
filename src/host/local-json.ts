import { promises as fs } from 'node:fs';
import path from 'node:path';
import writeFileAtomic from 'write-file-atomic';

export async function writeLocalJson(filename: string, value: unknown) {
  await writeLocalFile(filename, JSON.stringify(value, null, 2) + '\n');
}
export async function writeLocalFile(filename: string, text: string | Buffer) {
  await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  // The library follows an existing symlink; device records must remain ordinary files.
  const existing = await fs.lstat(filename).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (existing && !existing.isFile()) throw Error('Local metadata must be a regular file');
  await writeFileAtomic(filename, text, {
    mode: 0o600,
    fsync: true,
  });
}
export async function readLocalJson(filename: string, fallback: unknown) {
  try {
    if ((await fs.stat(filename)).size > 2 * 1024 * 1024)
      throw Error('Local metadata is too large');
    return JSON.parse(await fs.readFile(filename, 'utf8')) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw error;
  }
}
