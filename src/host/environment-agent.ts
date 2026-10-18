import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { t } from '../domain/i18n';
import { within } from '../domain/scopes';
import { sharedSchemaFolder } from '../domain/you';
import { iroriAgentSkills, yourAiStarter } from '../../prompts';
import { utf8Text } from './files';
import { isMissing } from './local-json';
import { storedFile, systemFiles } from './environment-routines';

/**
 * The irori agent's own files kept beside the saved environment (ADR 048):
 * every file in its folder, its Schema and the shared Schema first, so a new
 * device has them without the folder being a repository. Its routines have
 * their own file (ADR 043); what irori writes for this device alone is left
 * out.
 */

/** GitHub's contents API gives no content for a file over 1 MB. */
const fileBudget = 900 * 1024;
const fileLimit = 2000;
const depthLimit = 12;
/** Folders that never travel: Git's own, installed packages and the routines (saved apart). */
const skippedFolders = new Set(['.git', 'node_modules']);
const skippedTop = new Set(['routines']);
/**
 * Files written for this device: a vault's sub-agent definition names the
 * vault's folder here, and irori writes it again where it is absent.
 * `settings.local.json` is Claude Code's settings for one machine.
 */
const deviceFile = (rel: string) =>
  rel === '.claude/settings.local.json' ||
  /^\.(claude|opencode)\/agents\/(vault|hibachi)-[^/]+\.md$/.test(rel) ||
  /^\.codex\/agents\/(vault|hibachi)-[^/]+\.toml$/.test(rel);

export const storedAgentFiles = z.object({
  schemaVersion: z.literal(1),
  savedAt: z.iso.datetime(),
  files: z
    .array(storedFile)
    .max(fileLimit)
    .refine((files) => new Set(files.map((file) => file.path)).size === files.length),
});
export type StoredAgentFile = z.infer<typeof storedFile>;
export type StoredAgentFiles = z.infer<typeof storedAgentFiles>;

/** The order files are kept in when not all fit: the shared Schema, the Schema, the rest. */
const rank = (rel: string) =>
  rel.startsWith(`${sharedSchemaFolder}/`)
    ? 0
    : rel === 'AGENTS.md' || /^\.(agents|claude|codex|opencode)\//.test(rel)
      ? 1
      : 2;

/** Whether the folder holds the irori agent: its `AGENTS.md`. */
export const agentReady = (root: string) =>
  fs
    .stat(path.join(root, 'AGENTS.md'))
    .then((stat) => stat.isFile())
    .catch(() => false);

/** Every file path under the folder that may travel, and the ones that cannot (links, too deep). */
async function agentPaths(root: string) {
  const paths: string[] = [];
  const left: string[] = [];
  const walk = async (rel: string, depth: number) => {
    const entries = await fs.readdir(path.join(root, rel), { withFileTypes: true });
    for (const entry of entries) {
      if (systemFiles.has(entry.name)) continue;
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (skippedFolders.has(entry.name) || (!rel && skippedTop.has(entry.name))) continue;
        if (depth >= depthLimit) left.push(`${child}/`);
        else await walk(child, depth + 1);
      } else if (entry.isFile()) {
        if (!deviceFile(child)) paths.push(child);
      } else left.push(child);
    }
  };
  await walk('', 0);
  return { paths, left };
}

/**
 * The irori agent's files as they would be saved: those that fit in one file
 * of the settings repository, and the paths of those left out. Nothing where
 * the irori agent is not set up.
 */
export async function packAgentFiles(root: string) {
  const files: StoredAgentFile[] = [];
  if (!(await agentReady(root))) return { files, left: [] as string[] };
  const { paths, left } = await agentPaths(root);
  paths.sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1));
  // The envelope of the file: its version and the time it was saved.
  let size = 100;
  for (const rel of paths) {
    const file = path.join(root, ...rel.split('/'));
    const stat = await fs.stat(file).catch(() => undefined);
    // A file that cannot fit even as plain text is not read.
    if (!stat || files.length >= fileLimit || size + stat.size > fileBudget) {
      left.push(rel);
      continue;
    }
    const bytes = await fs.readFile(file).catch(() => undefined);
    if (!bytes) {
      left.push(rel);
      continue;
    }
    const text = utf8Text(bytes);
    const base =
      text === undefined ? { path: rel, base64: bytes.toString('base64') } : { path: rel, text };
    const stored = stat.mode & 0o111 ? { ...base, executable: true } : base;
    const length = Buffer.byteLength(JSON.stringify(stored, null, 2)) + 2;
    if (!storedFile.safeParse(stored).success || size + length > fileBudget) {
      left.push(rel);
      continue;
    }
    size += length;
    files.push(stored);
  }
  files.sort((a, b) => (a.path < b.path ? -1 : 1));
  return { files, left: left.sort() };
}

/** Whether something is at a saved file's place in the folder. */
export const agentFileHere = (root: string, rel: string) =>
  fs
    .lstat(path.join(root, ...rel.split('/')))
    .then(() => true)
    .catch(() => false);

/** The text irori itself writes at a path when it sets the folder up, if any. */
function starterText(rel: string) {
  if (Object.hasOwn(yourAiStarter, rel)) return yourAiStarter[rel];
  const skill = /^\.agents\/skills\/([^/]+)\/SKILL\.md$/.exec(rel)?.[1];
  return skill && Object.hasOwn(iroriAgentSkills, skill) ? iroriAgentSkills[skill] : undefined;
}

const bytesOf = (file: StoredAgentFile) =>
  'text' in file ? Buffer.from(file.text, 'utf8') : Buffer.from(file.base64, 'base64');

/**
 * Adds the saved files to the irori agent's folder: an absent file is written,
 * and a file irori set up and nobody changed since gives way to the saved one.
 * Any other file here is left as it is and named in `kept`. A folder that holds
 * files but no irori agent is not written into, as setting it up would refuse it.
 */
export async function restoreAgentFiles(root: string, saved: StoredAgentFile[]) {
  const added: string[] = [];
  const kept: string[] = [];
  if (!(await agentReady(root))) {
    const entries = await fs.readdir(root).catch((error) => {
      if (isMissing(error)) return [];
      throw error;
    });
    if (entries.length)
      throw Error(t(`${root} にはすでにファイルがあります。`, `${root} already holds files.`));
  }
  await fs.mkdir(root, { recursive: true });
  const real = await fs.realpath(root);
  // AGENTS.md last: until it is written the folder is not the irori agent's.
  const order = [...saved].sort(
    (a, b) => Number(a.path === 'AGENTS.md') - Number(b.path === 'AGENTS.md'),
  );
  for (const file of order) {
    const destination = path.join(root, ...file.path.split('/'));
    const bytes = bytesOf(file);
    const mode = file.executable ? 0o755 : 0o644;
    const here = await fs.lstat(destination).catch((error) => {
      if (isMissing(error)) return undefined;
      throw error;
    });
    if (here) {
      if (!here.isFile()) {
        kept.push(file.path);
        continue;
      }
      const current = await fs.readFile(destination);
      if (current.equals(bytes)) continue;
      const starter = starterText(file.path);
      if (starter === undefined || !current.equals(Buffer.from(starter, 'utf8'))) {
        kept.push(file.path);
        continue;
      }
    }
    await fs.mkdir(path.dirname(destination), { recursive: true });
    // A link on the way would lead the write out of the folder.
    if (!within(real, await fs.realpath(path.dirname(destination)))) {
      kept.push(file.path);
      continue;
    }
    if (here) await fs.writeFile(destination, bytes, { mode });
    else await fs.writeFile(destination, bytes, { flag: 'wx', mode });
    added.push(file.path);
  }
  return { added, kept: kept.sort() };
}
