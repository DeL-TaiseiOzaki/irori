import type { AgentId } from './types';
import { subAgentPrompt } from '../../prompts';

/**
 * The irori agent (formerly "your AI"): the person's own agent, run from its own
 * folder (its Schema), which hands work in each hibachi (a brain) to that
 * hibachi's agent, a sub-agent irori defines for it.
 */
export interface YourAi {
  /** The id its runs, conversations and sessions are kept under. */
  id: string;
  /** Its folder on this device. */
  root: string;
  /** `missing` until the folder holds an AGENTS.md. */
  state: 'missing' | 'ready';
}

/** A file or folder in your AI's folder, as the Your AI screen lists it. */
export interface YourAiEntry {
  path: string;
  name: string;
  directory: boolean;
}

/** The brains of one request, as your AI is told them. */
export interface BrainAgent {
  scopeId: string;
  name: string;
  category?: string;
  /** The sub-agent name its definitions carry, `hibachi-<slug>`. */
  agent: string;
  root: string;
  /** The definition files of that sub-agent in your AI's folder, one per CLI that has one. */
  definitions: { cli: SubAgentCli; path: string }[];
}

/** The CLIs that load sub-agents from files, and so get one per brain from irori. */
export type SubAgentCli = 'claude' | 'codex' | 'opencode';

/** Where each such CLI loads a sub-agent definition from, relative to your AI's folder. */
export const subAgentFiles: Record<SubAgentCli, (agent: string) => string> = {
  claude: (agent) => `.claude/agents/${agent}.md`,
  codex: (agent) => `.codex/agents/${agent}.toml`,
  opencode: (agent) => `.opencode/agents/${agent}.md`,
};

export function hasSubAgents(agent: AgentId): agent is SubAgentCli {
  return Object.hasOwn(subAgentFiles, agent);
}

/**
 * A stable sub-agent name for a brain: `hibachi-` and lowercase letters, digits
 * and hyphens as Claude Code asks, from the brain's name when it has Latin
 * letters, otherwise from its id. Names already taken get the id's first
 * characters.
 */
export function brainAgentNames(spaces: { scopeId: string; name: string }[]) {
  const names = new Map<string, string>();
  const taken = new Set<string>();
  for (const space of spaces) {
    const slug = space.name
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    const short = space.scopeId.replace(/-/g, '').slice(0, 8);
    let name = `hibachi-${slug || short}`;
    if (taken.has(name)) name = `${name}-${short}`;
    taken.add(name);
    names.set(space.scopeId, name);
  }
  return names;
}

/**
 * The definition irori writes for a brain's sub-agent on one CLI, when the file
 * is absent. Values are quoted as JSON, which is valid YAML and TOML.
 */
export function subAgentDefinition(
  cli: SubAgentCli,
  brain: { name: string; agent: string; root: string },
) {
  const { description, instructions: prompt } = subAgentPrompt(brain);
  const q = JSON.stringify;
  if (cli === 'codex')
    return `name = ${q(brain.agent)}\ndescription = ${q(description)}\ndeveloper_instructions = ${q(prompt)}\n`;
  if (cli === 'opencode')
    return `---\ndescription: ${q(description)}\nmode: subagent\n---\n\n${prompt}`;
  return `---\nname: ${brain.agent}\ndescription: ${q(description)}\ntools: Read, Write, Edit, Glob, Grep\n---\n\n${prompt}`;
}
