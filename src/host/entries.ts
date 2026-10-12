import { promises as fs } from 'node:fs';
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
 * Writes a new file or folder into the existing folder `parent` and returns the
 * name it took. A brought-in entry takes a free name; a new one refuses a taken name.
 */
export async function writeNewEntry(parent: string, entry: NewEntry) {
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
    else await fs.writeFile(filename, entry.bytes ?? '', { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw taken();
    throw error;
  }
  return name;
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
