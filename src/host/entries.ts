import { promises as fs } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { entryNameError, nameKey } from '../domain/connections';
import { t } from '../domain/i18n';
import type { NewEntry } from '../domain/types';

/**
 * What the explorer's own file and folder changes share between the vault's
 * knowledge and its connected folders: names usable on every file system, never
 * replacing an entry, and renames a case-insensitive volume does not lose.
 */

const taken = () =>
  Error(
    t(
      '同じ名前のファイルまたはフォルダがあります。',
      'A file or folder with the same name exists.',
    ),
  );

/** Whether `parent` holds `name` in any case or normalization, other than `except` itself. */
export async function nameTaken(parent: string, name: string, except?: string) {
  const key = nameKey(name);
  return (await fs.readdir(parent)).some(
    (item) => nameKey(item) === key && path.join(parent, item) !== except,
  );
}

/** `name`, or `name 2.ext`, `name 3.ext`… the first that `parent` does not hold. */
export async function freeName(parent: string, name: string) {
  const held = new Set((await fs.readdir(parent)).map(nameKey));
  if (!held.has(nameKey(name))) return name;
  const dot = name.lastIndexOf('.');
  const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  for (let n = 2; n < 10_000; n++) {
    const candidate = `${stem} ${n}${extension}`;
    if (!held.has(nameKey(candidate))) return candidate;
  }
  throw taken();
}

/**
 * Copies the file or folder at `source` into the existing folder `parent` as
 * `name`, or the first free name after it, and returns the name it took. Nothing
 * is replaced. Inside a copied folder, aliases stay behind, and so do hidden
 * entries when `hidden` is false. A copy that fails partway is removed.
 */
export async function copyEntryInto(
  source: string,
  parent: string,
  name: string,
  hidden: boolean,
): Promise<{ name: string; directory: boolean }> {
  const problem = entryNameError(name);
  if (problem) throw Error(problem);
  const info = await fs.lstat(source);
  if (info.isSymbolicLink() || !(info.isFile() || info.isDirectory()))
    throw Error(
      t(
        'alias / シンボリックリンクはコピーできません。',
        'Aliases and symbolic links cannot be copied.',
      ),
    );
  if (!(await fs.stat(parent)).isDirectory())
    throw Error(t('フォルダを指定してください。', 'Choose a folder.'));
  if (info.isDirectory()) {
    const from = await fs.realpath(source);
    const into = await fs.realpath(parent);
    if (into === from || into.startsWith(`${from}${path.sep}`))
      throw Error(
        t(
          'フォルダを自分自身やその中のフォルダにはコピーできません。',
          'A folder cannot be copied into itself or into one of its own folders.',
        ),
      );
  }
  const free = await freeName(parent, name);
  const destination = path.join(parent, free);
  try {
    await fs.cp(source, destination, {
      recursive: true,
      errorOnExist: true,
      force: false,
      filter: async (item) =>
        item === source ||
        ((hidden || !path.basename(item).startsWith('.')) &&
          !(await fs.lstat(item)).isSymbolicLink()),
    });
  } catch (error) {
    // A name taken meanwhile holds someone else's entry; anything else is this copy's.
    if ((error as NodeJS.ErrnoException).code !== 'ERR_FS_CP_EEXIST')
      await fs.rm(destination, { recursive: true, force: true });
    throw error;
  }
  return { name: free, directory: info.isDirectory() };
}

/** Brought-in files still being written, by the id `appendUpload` takes. */
const uploads = new Map<
  string,
  { filename: string; handle: FileHandle; left: number; writing?: boolean }
>();

/**
 * Writes a new file or folder into the existing folder `parent` and returns the
 * name it took. A brought-in entry takes a free name; a new one refuses a taken name.
 * A brought-in file larger than its first piece stays open for the rest under
 * the returned `upload`.
 */
export async function writeNewEntry(
  parent: string,
  entry: NewEntry,
): Promise<{ name: string; upload?: string }> {
  const problem = entryNameError(entry.name);
  if (problem) throw Error(problem);
  if (!(await fs.stat(parent)).isDirectory())
    throw Error(t('フォルダを指定してください。', 'Choose a folder.'));
  const brought = entry.kind === 'file' ? !!entry.bytes : !!entry.brought;
  const name = brought ? await freeName(parent, entry.name) : entry.name;
  if (!brought && (await nameTaken(parent, name))) throw taken();
  const filename = path.join(parent, name);
  try {
    if (entry.kind === 'folder') await fs.mkdir(filename);
    else if (entry.bytes && entry.size !== undefined && entry.size > entry.bytes.length) {
      const handle = await fs.open(filename, 'wx');
      const upload = randomUUID();
      uploads.set(upload, { filename, handle, left: entry.size });
      await appendUpload(upload, entry.bytes);
      return { name, upload };
    } else await fs.writeFile(filename, entry.bytes ?? '', { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw taken();
    throw error;
  }
  return { name };
}

/**
 * Writes the next piece of a brought-in file. The piece that fills the size
 * announced completes it; a piece past that size removes the file.
 */
export async function appendUpload(upload: string, bytes: Uint8Array) {
  const open = uploads.get(upload);
  if (!open || open.writing)
    throw Error(t('追加中のファイルが見つかりません。', 'The file being added is gone.'));
  if (bytes.length > open.left) {
    await discardUpload(upload);
    throw Error(t('ファイルの大きさが変わりました。', 'The file changed size.'));
  }
  open.writing = true;
  try {
    // A handle's writeFile writes on from its position, all of the bytes.
    await open.handle.writeFile(bytes);
  } catch (error) {
    await discardUpload(upload);
    throw error;
  }
  open.writing = false;
  open.left -= bytes.length;
  if (open.left) return;
  uploads.delete(upload);
  await open.handle.close();
}

/** Removes a brought-in file that was not written whole. */
export async function discardUpload(upload: string) {
  const open = uploads.get(upload);
  if (!open) return;
  uploads.delete(upload);
  await open.handle.close().catch(() => {});
  await fs.rm(open.filename, { force: true });
}

/**
 * Renames `actual` to `destination` in place, refusing a name its folder holds in
 * any case or normalization. A change of case or normalization alone goes through
 * a name the volume tells apart, as a case-insensitive one takes both for one entry.
 */
export async function renameEntry(actual: string, destination: string) {
  const parent = path.dirname(destination);
  const name = path.basename(destination);
  if (await nameTaken(parent, name, actual)) throw taken();
  if (destination === actual) return;
  if (path.dirname(actual) === parent && nameKey(path.basename(actual)) === nameKey(name)) {
    const temporary = path.join(parent, `${name}.irori-${randomUUID().slice(0, 8)}`);
    await fs.rename(actual, temporary);
    try {
      await fs.rename(temporary, destination);
    } catch (error) {
      await fs.rename(temporary, actual).catch(() => {});
      throw error;
    }
  } else await fs.rename(actual, destination);
}
