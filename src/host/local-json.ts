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

const busyCodes = ['EPERM', 'EACCES', 'EBUSY'];
/**
 * Moves a finished temporary file over the one it replaces. Windows refuses the
 * replacement for a moment while another process holds the target open (a file
 * watcher, the search indexer, antivirus), so there a refusal is retried briefly
 * instead of failing the save.
 */
export async function replaceFile(
  temporary: string,
  target: string,
  {
    platform = process.platform,
    rename = fs.rename as (from: string, to: string) => Promise<void>,
  }: { platform?: NodeJS.Platform; rename?: (from: string, to: string) => Promise<void> } = {},
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rename(temporary, target);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (platform !== 'win32' || attempt >= 7 || !busyCodes.includes(code)) throw error;
      // 25 ms doubling: about three seconds in all.
      await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt));
    }
  }
}
