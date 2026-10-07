import path from 'node:path';
import { handToSubAgent, outsideHibachi, outsideIroriAgent } from '../../prompts';
import { within } from '../domain/scopes';

/**
 * What your AI may reach in one run: its own folder, and the brains handed to
 * it, each worked on by the sub-agent named after that brain.
 */
export interface Delegation {
  /** Your AI's folder, its working directory. */
  you: string;
  brains: { scopeId: string; name: string; agent: string; root: string }[];
}

export type Decision = { allow: true } | { allow: false; reason: string };

/** The brain a sub-agent works for, by the name its definition carries. */
export function brainOfAgent(delegation: Delegation, agentType?: string) {
  return agentType ? delegation.brains.find((brain) => brain.agent === agentType) : undefined;
}

/** The brain a path lies in, if any. */
export function brainOfPath(delegation: Delegation, file: string) {
  const absolute = path.resolve(delegation.you, file);
  return delegation.brains.find((brain) => within(brain.root, absolute));
}

/**
 * Where a file tool may write. Your AI keeps to its own folder; a brain's
 * sub-agent keeps to its brain; any other agent (a built-in one, or one a brain
 * defines for itself) keeps to your AI's folder. Work in a brain therefore goes
 * through that brain's sub-agent, which has read the brain's Schema.
 */
export function writeDecision(
  delegation: Delegation,
  agentType: string | undefined,
  file: string,
): Decision {
  const absolute = path.resolve(delegation.you, file);
  const brain = brainOfAgent(delegation, agentType);
  if (brain)
    return within(brain.root, absolute)
      ? { allow: true }
      : { allow: false, reason: outsideHibachi(brain) };
  if (within(delegation.you, absolute)) return { allow: true };
  const target = brainOfPath(delegation, absolute);
  return {
    allow: false,
    reason: target ? handToSubAgent(target) : outsideIroriAgent,
  };
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
 * The handed hibachi a `hibachi` command names: by its sub-agent name, or by its
 * name when only one handed hibachi has it. Any other is refused, with the names
 * this run may use.
 */
export function hibachiOf(delegation: Delegation, name: string) {
  const fold = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  const byAgent = delegation.brains.find((brain) => brain.agent === name);
  if (byAgent) return byAgent;
  const byName = delegation.brains.filter((brain) => fold(brain.name) === fold(name));
  if (byName.length === 1) return byName[0];
  const names = delegation.brains.map((brain) => `${brain.agent} (${brain.name})`).join(', ');
  throw Error(
    byName.length
      ? `More than one hibachi is named ${JSON.stringify(name)}. Use its sub-agent name: ${names}.`
      : `No hibachi named ${JSON.stringify(name)} was handed to this request. Use one of: ${names || 'none'}.`,
  );
}
