import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { t } from '../domain/i18n';
import { routineFolder } from '../domain/routines';
import { within } from '../domain/scopes';
import { utf8Text } from './files';

/**
 * The irori agent's routines kept beside the saved environment (ADR 043):
 * each routine folder in the agent's `routines/` with its files. A vault's
 * routines travel with the vault's repository and are not kept here.
 */

/** GitHub's contents API gives no content for a file over 1 MB. */
const fileBudget = 900 * 1024;
const filesPerRoutine = 100;
const depthLimit = 8;
/** Files the system writes into folders it shows. */
export const systemFiles = new Set(['.DS_Store']);

export const relativeFile = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (value) =>
      !/[\\\0:]/.test(value) &&
      value.split('/').every((part) => part && part !== '.' && part !== '..'),
  );
export const storedFile = z.union([
  z.object({ path: relativeFile, text: z.string(), executable: z.boolean().optional() }).strict(),
  z.object({ path: relativeFile, base64: z.base64(), executable: z.boolean().optional() }).strict(),
]);
const storedRoutine = z.object({
  folder: routineFolder,
  name: z.string().trim().min(1).max(120),
  files: z
    .array(storedFile)
    .min(1)
    .max(filesPerRoutine)
    .refine((files) => files.some((file) => file.path === 'routine.yaml'))
    .refine((files) => new Set(files.map((file) => file.path)).size === files.length),
});
export const storedRoutines = z.object({
  schemaVersion: z.literal(1),
  savedAt: z.iso.datetime(),
  routines: z
    .array(storedRoutine)
    .max(500)
    .refine((items) => new Set(items.map((item) => item.folder)).size === items.length),
});
export type StoredRoutine = z.infer<typeof storedRoutine>;
export type StoredRoutines = z.infer<typeof storedRoutines>;

const routinesDir = (agentRoot: string) => path.join(agentRoot, 'routines');

/** A routine's name from its `routine.yaml`, or its folder's when it has none. */
function routineName(text: string | undefined, folder: string) {
  try {
    const name = (parse(text ?? '') as { name?: unknown } | null)?.name;
    if (typeof name === 'string' && name.trim()) return name.trim().slice(0, 120);
  } catch {
    // An unreadable routine.yaml still travels; its folder names it.
  }
  return folder;
}

/** One routine folder's files, or undefined when it holds a link or too many files. */
async function readRoutine(dir: string, folder: string): Promise<StoredRoutine | undefined> {
  const files: StoredRoutine['files'] = [];
  const walk = async (rel: string, depth: number): Promise<boolean> => {
    for (const entry of await fs.readdir(path.join(dir, rel), { withFileTypes: true })) {
      if (systemFiles.has(entry.name)) continue;
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (depth >= depthLimit || !(await walk(child, depth + 1))) return false;
        continue;
      }
      // A link or anything but a file cannot be run as a routine either.
      if (!entry.isFile() || files.length >= filesPerRoutine) return false;
      const file = path.join(dir, child);
      const [bytes, stat] = await Promise.all([fs.readFile(file), fs.stat(file)]);
      const text = utf8Text(bytes);
      const executable = (stat.mode & 0o111) !== 0;
      const base =
        text === undefined
          ? { path: child, base64: bytes.toString('base64') }
          : { path: child, text };
      files.push(executable ? { ...base, executable } : base);
    }
    return true;
  };
  if (!(await walk('', 0))) return undefined;
  files.sort((a, b) => (a.path < b.path ? -1 : 1));
  const yaml = files.find((file) => file.path === 'routine.yaml');
  return {
    folder,
    name: routineName(yaml && 'text' in yaml ? yaml.text : undefined, folder),
    files,
  };
}

/** The routine folders in the irori agent's `routines/`, sorted by folder. */
async function routineFolders(agentRoot: string) {
  const dir = routinesDir(agentRoot);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const folders: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !routineFolder.safeParse(entry.name).success) continue;
    const yaml = await fs.lstat(path.join(dir, entry.name, 'routine.yaml')).catch(() => undefined);
    if (yaml?.isFile()) folders.push(entry.name);
  }
  return folders.sort();
}

/**
 * The irori agent's routines as they would be saved: those that fit in one
 * file of the settings repository, and the names of those left out.
 */
export async function packRoutines(agentRoot: string) {
  const routines: StoredRoutine[] = [];
  const left: string[] = [];
  // The envelope of routines.json: its version and the time it was saved.
  let size = 100;
  for (const folder of await routineFolders(agentRoot)) {
    const routine = await readRoutine(path.join(routinesDir(agentRoot), folder), folder).catch(
      () => undefined,
    );
    const length = routine ? Buffer.byteLength(JSON.stringify(routine, null, 2)) + 2 : Infinity;
    if (!routine || !storedRoutine.safeParse(routine).success || size + length > fileBudget) {
      left.push(routine?.name ?? folder);
      continue;
    }
    size += length;
    routines.push(routine);
  }
  return { routines, left };
}

/** Whether the irori agent's folder has something at this routine folder's place. */
export const routineHere = (agentRoot: string, folder: string) =>
  fs
    .lstat(path.join(routinesDir(agentRoot), folder))
    .then(() => true)
    .catch(() => false);

/**
 * Adds a saved routine to the irori agent's folder. It writes only a folder
 * that did not exist; the routine runs on this device after its review.
 */
export async function addRoutine(agentRoot: string, routine: StoredRoutine) {
  const dir = routinesDir(agentRoot);
  await fs.mkdir(dir, { recursive: true });
  if (!within(await fs.realpath(agentRoot), await fs.realpath(dir)))
    throw Error(
      t(
        'routines フォルダが irori agent のフォルダの外にあります。',
        "The routines folder leaves the irori agent's folder.",
      ),
    );
  const target = path.join(dir, routine.folder);
  try {
    await fs.mkdir(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw Error(t(`${target} はすでにあります。`, `${target} already exists.`));
    throw error;
  }
  for (const file of routine.files) {
    const destination = path.join(target, ...file.path.split('/'));
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(
      destination,
      'text' in file ? file.text : Buffer.from(file.base64, 'base64'),
      { flag: 'wx', mode: file.executable ? 0o755 : 0o644 },
    );
  }
}
