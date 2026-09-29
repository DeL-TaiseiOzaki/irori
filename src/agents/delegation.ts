import path from 'node:path';
import { handToSubAgent, outsideHibachi, outsideIroriAgent } from '../../prompts';

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

function within(root: string, file: string) {
  const relative = path.relative(root, file);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

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

/** The file a file tool's input names, if it names one. */
export function toolFile(input: unknown) {
  const value = input as { file_path?: unknown; notebook_path?: unknown; path?: unknown };
  const file = value?.file_path ?? value?.notebook_path;
  return typeof file === 'string' ? file : undefined;
}

export const writeTools = /^(Write|Edit|MultiEdit|NotebookEdit)$/;

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
