import { promises as fs, type Dirent } from 'node:fs';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';
import { matchFrontMatter } from '../domain/schema-settings';
import type { AgentId } from '../domain/types';

/**
 * Sub-agent definitions a folder keeps in its Schema, in the three formats CLIs
 * load them from (ADR 050). Each CLI reads only its own: Claude Code
 * `.claude/agents/*.md`, Codex `.codex/agents/*.toml`, OpenCode
 * `.opencode/agents/*.md`. irori reads all three, so that a folder's sub-agents
 * work whichever CLI runs in it, and gives a CLI the ones it does not read itself.
 */
export type DefinitionFormat = 'claude' | 'codex' | 'opencode';
export const definitionFolders: Record<DefinitionFormat, { dir: string; ext: string }> = {
  claude: { dir: '.claude/agents', ext: '.md' },
  codex: { dir: '.codex/agents', ext: '.toml' },
  opencode: { dir: '.opencode/agents', ext: '.md' },
};
const formats = Object.keys(definitionFolders) as DefinitionFormat[];

/**
 * The name of a vault's definition of its own agent: the agent the irori agent
 * hands the vault's work to. The vault's other definitions are that agent's sub-agents.
 */
export const vaultAgentName = 'vault-agent';

export type AgentDefinition = {
  name: string;
  format: DefinitionFormat;
  /** The file, relative to the folder, with forward slashes. */
  file: string;
  description: string;
  instructions: string;
  /** The model the definition names, in its own CLI's terms. */
  model?: string;
};
export type DefinitionProblem = { file: string; message: string };

/** Names every format accepts as an agent's: letters, digits, `-` and `_`. */
const definitionName = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const maxDefinitions = 50;
const maxDefinitionBytes = 64 * 1024;

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : undefined);

/**
 * One file's definition; the file name gives the name when the file does not.
 * An OpenCode agent that is not a sub-agent (`mode: primary`) gives none.
 */
export function parseDefinition(format: DefinitionFormat, file: string, source: string) {
  const stem = path.basename(file, definitionFolders[format].ext);
  let fields: Record<string, unknown>;
  let body: string | undefined;
  if (format === 'codex') {
    fields = parseToml(source) as Record<string, unknown>;
    body = text(fields.developer_instructions);
  } else {
    const match = matchFrontMatter(source);
    if (!match) throw Error('A definition must begin with --- front matter');
    const parsed: unknown = parseYaml(match[1], { logLevel: 'error' });
    fields = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    body = (match[2] ?? '').trim();
    if (format === 'opencode' && fields.mode === 'primary') return undefined;
  }
  const name = text(fields.name) || stem;
  if (!definitionName.test(name)) throw Error(`The name ${JSON.stringify(name)} is not usable`);
  const description = text(fields.description);
  if (!description) throw Error('A definition needs a description');
  if (!body) throw Error('A definition has no instructions');
  const model = text(fields.model);
  const definition: AgentDefinition = { name, format, file, description, instructions: body };
  if (model) definition.model = model;
  return definition;
}

/**
 * The definitions in a folder's three agent folders. A link, a file over the
 * size limit or one that does not parse is left out and named as a problem.
 */
export async function readAgentDefinitions(root: string) {
  const definitions: AgentDefinition[] = [];
  const problems: DefinitionProblem[] = [];
  for (const format of formats) {
    const { dir, ext } = definitionFolders[format];
    const entries = await fs
      .readdir(path.join(root, dir), { withFileTypes: true })
      .catch(() => [] as Dirent[]);
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.name.endsWith(ext)) continue;
      const file = `${dir}/${entry.name}`;
      if (!entry.isFile()) {
        if (entry.isSymbolicLink()) problems.push({ file, message: 'Links are not read' });
        continue;
      }
      if (definitions.length >= maxDefinitions) {
        problems.push({ file, message: `Only the first ${maxDefinitions} definitions are read` });
        continue;
      }
      try {
        const stat = await fs.stat(path.join(root, file));
        if (stat.size > maxDefinitionBytes)
          throw Error(`A definition is at most ${maxDefinitionBytes} bytes`);
        const source = await fs.readFile(path.join(root, file), 'utf8');
        const found = parseDefinition(format, file, source);
        if (found) definitions.push(found);
      } catch (error) {
        problems.push({ file, message: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  return { definitions, problems };
}

/** Whether a CLI loads sub-agents from one of these formats itself. */
export const readsDefinitions = (agent: AgentId): agent is DefinitionFormat =>
  (formats as string[]).includes(agent);

/**
 * The definitions `agent` does not load itself: those in another format, the
 * first of a name winning, leaving out a name it has in its own format and
 * the names `skip` refuses. Pi and Hermes Agent load no sub-agents, so none.
 */
export function foreignDefinitions(
  definitions: AgentDefinition[],
  agent: AgentId,
  skip: (name: string) => boolean,
) {
  if (!readsDefinitions(agent)) return [];
  const own = new Set(definitions.filter((item) => item.format === agent).map((item) => item.name));
  const chosen = new Map<string, AgentDefinition>();
  for (const item of definitions)
    if (item.format !== agent && !own.has(item.name) && !skip(item.name) && !chosen.has(item.name))
      chosen.set(item.name, item);
  return [...chosen.values()];
}

/** A vault's definition of its own agent: the one in the running CLI's format first. */
export function vaultAgentDefinition(definitions: AgentDefinition[], agent: AgentId) {
  const candidates = definitions.filter((item) => item.name === vaultAgentName);
  return candidates.find((item) => item.format === agent) ?? candidates[0];
}

/** The definition's model, when it is in this CLI's terms and names one rather than the parent's. */
export function definitionModel(definition: AgentDefinition | undefined, agent: AgentId) {
  const model = definition?.format === agent ? definition.model : undefined;
  return model && model !== 'inherit' && /^\w[\w./:@[\]-]{0,199}$/.test(model) ? model : undefined;
}

/**
 * Codex takes a sub-agent role as configuration: a description and a file of
 * the role's own settings. irori writes each role's file into its data
 * directory, `codex-agents/<run>/<name>.toml`, and removes it when the run ends.
 */
const rolesRoot = (dataDir: string) => path.join(dataDir, 'codex-agents');
export async function writeCodexRoles(dataDir: string, runId: string, roles: AgentDefinition[]) {
  if (!roles.length) return undefined;
  const folder = path.join(rolesRoot(dataDir), runId);
  await fs.mkdir(folder, { recursive: true });
  const config: Record<string, string> = {};
  for (const role of roles) {
    const file = path.join(folder, `${role.name}.toml`);
    // A JSON string is a valid TOML basic string.
    await fs.writeFile(file, `developer_instructions = ${JSON.stringify(role.instructions)}\n`);
    config[`agents.${role.name}.description`] = role.description;
    config[`agents.${role.name}.config_file`] = file;
  }
  return config;
}
export async function removeCodexRoles(dataDir: string, runId: string) {
  await fs.rm(path.join(rolesRoot(dataDir), runId), { recursive: true, force: true });
}
/** Removes the role files of runs that ended without removing them, keeping `active`. */
export async function pruneCodexRoles(dataDir: string, active: (runId: string) => boolean) {
  for (const runId of await fs.readdir(rolesRoot(dataDir)).catch(() => [] as string[]))
    if (!active(runId)) await removeCodexRoles(dataDir, runId);
}
