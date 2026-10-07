import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import writeFileAtomic from 'write-file-atomic';
import { t } from '../domain/i18n';

export function isMissing(error: unknown) {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}
/** What `read` finds, or undefined when nothing is there. */
export async function ifPresent<T>(read: Promise<T>) {
  try {
    return await read;
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}
/** A declaration file's JSON, a leading BOM allowed. */
export const parseJsonText = (text: string): unknown => JSON.parse(text.replace(/^\uFEFF/, ''));
/** The first problems a schema found in a declaration, for the message naming its file. */
export function issueSummary(issues: readonly { path: PropertyKey[]; message: string }[]) {
  return issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

export async function writeLocalJson(filename: string, value: unknown) {
  await writeLocalFile(filename, JSON.stringify(value, null, 2) + '\n');
}
export async function writeLocalFile(filename: string, text: string | Buffer) {
  await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  // The library follows an existing symlink; device records must remain ordinary files.
  const existing = await fs.lstat(filename).catch((error) => {
    if (!isMissing(error)) throw error;
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
    if (isMissing(error)) return fallback;
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

/** Creates a file that must not exist yet and flushes its bytes before closing it. */
export async function writeExclusive(filename: string, data: string | Uint8Array, mode?: number) {
  const file = await fs.open(filename, 'wx', mode);
  try {
    await file.writeFile(data);
    await file.sync();
  } finally {
    await file.close();
  }
}

/**
 * Replaces `target` through a temporary file beside it, made with `mode`. `check`
 * runs once the new bytes are on disk, so a target changed meanwhile is refused
 * rather than overwritten.
 */
export async function replaceChecked(
  target: string,
  data: string,
  mode: number,
  check: () => Promise<void>,
) {
  const temp = path.join(path.dirname(target), `.irori-save-${randomUUID()}.tmp`);
  try {
    await writeExclusive(temp, data, mode);
    await check();
    await replaceFile(temp, target);
  } finally {
    await fs.rm(temp, { force: true });
  }
}

/**
 * The sha256 of a regular file's bytes, streamed so a large file is never held
 * in memory; `changed` is thrown when the file changes while it is read. `chunk`
 * sees each piece and the size read so far.
 */
export async function stableHash(
  filename: string,
  changed: () => Error,
  chunk?: (bytes: Buffer, size: number) => void,
) {
  const digest = createHash('sha256');
  const file = await fs.open(filename, 'r');
  try {
    const before = await file.stat();
    if (!before.isFile())
      throw Error(
        t('生成先が通常のファイルではありません。', 'The output is not an ordinary file.'),
      );
    let size = 0;
    for await (const bytes of file.createReadStream({ autoClose: false, end: before.size })) {
      digest.update(bytes);
      size += bytes.length;
      chunk?.(bytes, size);
    }
    const after = await file.stat();
    if (size !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs)
      throw changed();
    return { hash: digest.digest('hex'), size };
  } finally {
    await file.close();
  }
}

/**
 * Walks the folders of `relative` one at a time, making a missing one when
 * `create` is set. Each must be an ordinary folder, not a link or a file, that
 * `resolve` finds where `location` says it is.
 */
export async function ordinaryFolders(
  relative: string,
  create: boolean,
  check: {
    location(prefix: string): string;
    resolve(prefix: string): Promise<string>;
    notFolder(): Error;
    moved(): Error;
  },
) {
  let prefix = '';
  for (const part of relative.split('/').filter(Boolean)) {
    prefix = prefix ? `${prefix}/${part}` : part;
    const filename = check.location(prefix);
    let stat = await fs.lstat(filename).catch((error) => {
      if (!isMissing(error) || !create) throw error;
    });
    if (!stat) {
      await fs.mkdir(filename);
      stat = await fs.lstat(filename);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw check.notFolder();
    if ((await check.resolve(prefix)) !== filename) throw check.moved();
  }
}
