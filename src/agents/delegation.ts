import path from 'node:path';
import { handToVaultAgent, outsideIroriAgent } from '../../prompts';
import { within } from '../domain/scopes';

/**
 * What your AI may reach in one run: its own folder, and the brains handed to
 * it, each worked on by its vault agent through `irori call` (ADR 050).
 */
export interface Delegation {
  /** Your AI's folder, its working directory. */
  you: string;
  /** `work`: the folder work on that brain keeps its scratch in, when it has one. */
  brains: { scopeId: string; name: string; agent: string; root: string; work?: string }[];
}

export type Decision = { allow: true } | { allow: false; reason: string };

/** The brain a path lies in, if any. */
export function brainOfPath(delegation: Delegation, file: string) {
  const absolute = path.resolve(delegation.you, file);
  return delegation.brains.find((brain) => within(brain.root, absolute));
}

/**
 * Where a file tool of your AI's run may write, its own sub-agents' too: its
 * own folder, and a brain's work folder, scratch rather than the brain's
 * material. Work in a brain goes to that brain's vault agent with
 * `irori call`, which runs inside the brain with its Schema (ADR 050).
 */
export function writeDecision(delegation: Delegation, file: string): Decision {
  const absolute = path.resolve(delegation.you, file);
  if (delegation.brains.some((item) => item.work && within(item.work, absolute)))
    return { allow: true };
  if (within(delegation.you, absolute)) return { allow: true };
  const target = brainOfPath(delegation, absolute);
  return { allow: false, reason: target ? handToVaultAgent(target) : outsideIroriAgent };
}

/** The first of `keys` in a tool call's input that holds a string. */
function fileOf(input: unknown, keys: string[]) {
  const value = (input ?? {}) as Record<string, unknown>;
  return keys.map((key) => value[key]).find((file): file is string => typeof file === 'string');
}
/** The file a Claude Code write tool names: `file_path`, or NotebookEdit's `notebook_path`. */
export const toolFile = (input: unknown) => fileOf(input, ['file_path', 'notebook_path']);
/** The file a file tool names: `file_path` for Claude Code, `filePath` for OpenCode, `path` for Pi. */
export const editedPath = (input: unknown) => fileOf(input, ['file_path', 'filePath', 'path']);

/** Claude Code's tools that write a file, as its hook matcher names them. */
export const writeToolMatcher = 'Write|Edit|MultiEdit|NotebookEdit';
export const writeTools = new RegExp(`^(${writeToolMatcher})$`);

/**
 * The handed vault `irori call` names: by its vault agent name, or by its
 * name when only one handed vault has it. Any other is refused, with the names
 * this run may use.
 */
export function vaultOf(delegation: Delegation, name: string) {
  const fold = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  const byAgent = delegation.brains.find((brain) => brain.agent === name);
  if (byAgent) return byAgent;
  const byName = delegation.brains.filter((brain) => fold(brain.name) === fold(name));
  if (byName.length === 1) return byName[0];
  const names = delegation.brains.map((brain) => `${brain.agent} (${brain.name})`).join(', ');
  throw Error(
    byName.length
      ? `More than one vault is named ${JSON.stringify(name)}. Use its vault agent name: ${names}.`
      : `No vault named ${JSON.stringify(name)} was handed to this request. Use one of: ${names || 'none'}.`,
  );
}
