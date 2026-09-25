import path from 'node:path';

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
      : {
          allow: false,
          reason: `The ${brain.name} brain's AI works only inside that brain (${brain.root}). Report what else is needed instead.`,
        };
  if (within(delegation.you, absolute)) return { allow: true };
  const target = brainOfPath(delegation, absolute);
  return {
    allow: false,
    reason: target
      ? `Hand work in the ${target.name} brain to its sub-agent "${target.agent}", which reads that brain's Schema first.`
      : 'Your AI writes only in its own folder or, through their sub-agents, in the brains handed to it.',
  };
}

/** The file a file tool's input names, if it names one. */
export function toolFile(input: unknown) {
  const value = input as { file_path?: unknown; notebook_path?: unknown; path?: unknown };
  const file = value?.file_path ?? value?.notebook_path;
  return typeof file === 'string' ? file : undefined;
}

export const writeTools = /^(Write|Edit|MultiEdit|NotebookEdit)$/;
