import { promises as fs } from 'node:fs';
import path from 'node:path';
import { iroriAgentSkills } from '../../prompts';
import { isMissing, readLocalJson, writeLocalJson } from './local-json';

/**
 * ADR 033: what irori called a hibachi is a vault. Data an earlier irori wrote
 * under the old name is renamed once per device, before anything reads it. The
 * old name is read nowhere else, except in what reaches this device later: an
 * environment saved on GitHub (`fromSavedEnvironment`) and a routine's
 * `routine.yaml` (`routineWithVaultKeys`).
 */

/** A text irori wrote, with the old name as the new one in each case it was written. */
export const toVault = (text: string) =>
  text
    .replace(/HIBACHI/g, 'VAULT')
    .replace(/Hibachi/g, 'Vault')
    .replace(/hibachi/g, 'vault');

type Fields = Record<string, unknown>;
const isFields = (value: unknown): value is Fields =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Moves `from` to `to` unless `to` is there already; whether anything changed. */
function moveKey(value: Fields, from: string, to: string) {
  if (!Object.hasOwn(value, from)) return false;
  if (!Object.hasOwn(value, to)) value[to] = value[from];
  delete value[from];
  return true;
}

/** An environment saved on GitHub before the rename, with the keys this version reads. */
export function fromSavedEnvironment(value: unknown) {
  if (!isFields(value)) return value;
  const next = { ...value };
  moveKey(next, 'hibachis', 'vaults');
  if (isFields(next.preferences)) {
    const preferences = { ...next.preferences };
    moveKey(preferences, 'hibachiAgent', 'vaultAgent');
    next.preferences = preferences;
  }
  return next;
}

/**
 * A `routine.yaml` with the old keys as the new ones: `hibachis:` becomes
 * `vaults:` and `agent: hibachi` becomes `agent: vault`. Everything else,
 * comments and layout included, stays as written.
 */
export function routineWithVaultKeys(text: string) {
  return text
    .replace(/^(\s*(?:-\s+)?)hibachis(\s*:)/gm, '$1vaults$2')
    .replace(/^(\s*(?:-\s+)?agent\s*:\s*)(["']?)hibachi\2(?=\s*(?:#|$))/gm, '$1$2vault$2');
}

async function entries(dir: string) {
  return fs.readdir(dir, { withFileTypes: true }).catch((error) => {
    if (isMissing(error)) return [];
    throw error;
  });
}
const present = (file: string) =>
  fs.lstat(file).then(
    () => true,
    () => false,
  );

/** Rewrites a regular file with the new name; a link or folder in its place is left alone. */
async function renameWords(file: string) {
  const stat = await fs.lstat(file).catch(() => undefined);
  if (!stat?.isFile()) return;
  const text = await fs.readFile(file, 'utf8');
  const next = toVault(text);
  if (next !== text) await fs.writeFile(file, next);
}

async function deviceSettings(dataDir: string) {
  const file = path.join(dataDir, 'device-settings.json');
  const value = await readLocalJson(file, undefined);
  if (isFields(value) && moveKey(value, 'hibachiAgent', 'vaultAgent'))
    await writeLocalJson(file, value);
}

async function conversations(dataDir: string) {
  const folder = path.join(dataDir, 'conversations');
  for (const entry of await entries(folder)) {
    if (!entry.isDirectory()) continue;
    const file = path.join(folder, entry.name, 'meta.json');
    const meta = await readLocalJson(file, undefined).catch(() => undefined);
    if (!isFields(meta)) continue;
    let changed = moveKey(meta, 'hibachis', 'vaults');
    if (isFields(meta.owner) && meta.owner.kind === 'hibachi') {
      meta.owner = { ...meta.owner, kind: 'vault' };
      changed = true;
    }
    if (changed) await writeLocalJson(file, meta);
  }
}

async function routineRuns(dataDir: string) {
  const runs = path.join(dataDir, 'routines', 'runs');
  for (const folder of await entries(runs)) {
    if (!folder.isDirectory()) continue;
    for (const entry of await entries(path.join(runs, folder.name))) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const file = path.join(runs, folder.name, entry.name);
      const run = await readLocalJson(file, undefined).catch(() => undefined);
      if (!isFields(run) || !Array.isArray(run.steps)) continue;
      let changed = false;
      for (const step of run.steps)
        if (
          isFields(step) &&
          typeof step.label === 'string' &&
          toVault(step.label) !== step.label
        ) {
          step.label = toVault(step.label);
          changed = true;
        }
      if (changed) await writeLocalJson(file, run);
    }
  }
}

/** The standard skills whose folder names held the old name. */
const renamedSkills: Record<string, string> = {
  'add-hibachis': 'add-vaults',
  'new-hibachi': 'new-vault',
};

/**
 * The irori agent's folder: the sub-agent definitions irori wrote take their
 * new names (`vault-<name>`), and its `AGENTS.md` and standard skills say vault.
 * A definition or skill whose new name is taken already is left as it is.
 */
async function agentFolder(root: string) {
  // Where irori wrote the definitions before 0.2.34, which no longer writes them (ADR 050).
  for (const sample of ['.claude/agents/x.md', '.codex/agents/x.toml', '.opencode/agents/x.md']) {
    const dir = path.join(root, path.dirname(sample));
    const extension = path.extname(sample);
    for (const entry of await entries(dir)) {
      const name = entry.name;
      if (!entry.isFile() || !name.startsWith('hibachi-') || !name.endsWith(extension)) continue;
      const target = path.join(dir, toVault(name));
      if (await present(target)) continue;
      const text = await fs.readFile(path.join(dir, name), 'utf8');
      await fs.writeFile(target, toVault(text), { flag: 'wx' });
      await fs.rm(path.join(dir, name));
    }
  }
  const skills = path.join(root, '.agents', 'skills');
  for (const [from, to] of Object.entries(renamedSkills)) {
    const stat = await fs.lstat(path.join(skills, from)).catch(() => undefined);
    if (stat?.isDirectory() && !(await present(path.join(skills, to))))
      await fs.rename(path.join(skills, from), path.join(skills, to));
  }
  await renameWords(path.join(root, 'AGENTS.md'));
  for (const name of Object.keys(iroriAgentSkills))
    await renameWords(path.join(skills, name, 'SKILL.md'));
}

/**
 * Renames this device's records and the irori agent's folder, once. Every step
 * can run again without harm, so a failure leaves no marker and the next start
 * repeats them all; the steps that failed are returned.
 */
export async function migrateToVault(dataDir: string, agentRoot: string) {
  const marker = path.join(dataDir, 'vault-migrated.json');
  if (await present(marker)) return undefined;
  const steps: [string, () => Promise<void>][] = [
    ['device settings', () => deviceSettings(dataDir)],
    ['conversations', () => conversations(dataDir)],
    ['routine runs', () => routineRuns(dataDir)],
    ["the irori agent's folder", () => agentFolder(agentRoot)],
  ];
  const failed: string[] = [];
  for (const [name, step] of steps)
    await step().catch((error) => {
      failed.push(name);
      console.warn(`Could not rename hibachi to vault in ${name}`, String(error));
    });
  if (!failed.length)
    await writeLocalJson(marker, { schemaVersion: 1, at: new Date().toISOString() });
  return failed;
}
