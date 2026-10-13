import type { AgentCommand, AgentId } from '../domain/types';
import { t } from '../domain/i18n';
import { askClaude, askCodex } from './models';
import { version } from './process';
import type { Rpc } from './rpc';

/**
 * What a CLI runs when a request starts with `/name` (ADR 040): Claude Code's
 * commands and skills as its session lists them, and for Codex the skills its
 * app server lists beside the commands irori turns into its methods. Reading
 * them asks the CLI; none of it generates text.
 */

/** Words of the form `/name`, alone or with arguments, not a path: the name and the rest. */
export const commandWords = /^\/([\w:-]+)(?:\s+([\s\S]*))?$/;

/** The commands irori runs through Codex's app server, which takes no `/name` in a turn's text. */
export const codexCommands = (): AgentCommand[] => [
  {
    name: 'compact',
    description: t(
      'これまでの会話を要約して、文脈を空ける',
      'Summarize the conversation so far to free up context',
    ),
  },
  {
    name: 'review',
    description: t(
      'コミットしていない変更をレビューする（続けて書いた指示でもよい）',
      'Review the uncommitted changes, or follow the instructions after it',
    ),
    hint: t('[指示]', '[instructions]'),
  },
];

/** A skill as Codex's `skills/list` gives it, for a `skill` input item. */
export interface CodexSkill {
  name: string;
  description: string;
  path: string;
}

/** The enabled skills in `skills/list`'s answer, each name once. */
export function parseCodexSkills(result: unknown): CodexSkill[] {
  const data = (result as { data?: unknown })?.data;
  const skills: any[] = Array.isArray(data)
    ? data.flatMap((entry) => (Array.isArray(entry?.skills) ? entry.skills : []))
    : [];
  const seen = new Set<string>();
  return skills.flatMap((skill) => {
    if (
      !skill ||
      skill.enabled === false ||
      typeof skill.name !== 'string' ||
      typeof skill.path !== 'string' ||
      !/^[\w:-]+$/.test(skill.name) ||
      seen.has(skill.name)
    )
      return [];
    seen.add(skill.name);
    const description =
      typeof skill.shortDescription === 'string' && skill.shortDescription
        ? skill.shortDescription
        : typeof skill.description === 'string'
          ? skill.description
          : '';
    return [{ name: skill.name, description, path: skill.path }];
  });
}

/** Codex's skills for `cwd`, asked of an app server already running. */
export async function codexSkills(rpc: Rpc, cwd: string) {
  return parseCodexSkills(await rpc.request('skills/list', { cwds: [cwd] }));
}

async function read(agent: AgentId, cwd: string): Promise<AgentCommand[]> {
  if (agent === 'claude') {
    const commands = await askClaude(cwd, ['user', 'project', 'local'], (session) =>
      session.supportedCommands(),
    );
    return commands
      .filter((command) => /^[\w:-]+$/.test(command.name))
      .map((command) => ({
        name: command.name,
        description: command.description,
        ...(command.argumentHint && { hint: command.argumentHint }),
      }));
  }
  if (agent === 'codex') {
    const skills = await askCodex(cwd, (rpc) => codexSkills(rpc, cwd));
    return [
      ...codexCommands(),
      ...skills.map(({ name, description }) => ({ name, description, skill: true })),
    ];
  }
  return []; // OpenCode, Pi and Hermes Agent are not asked (ADR 040).
}

/** How long a folder's list is kept: skills may be added while irori runs. */
const keep = 60_000;

/** The commands each installed CLI offers in a folder, kept a minute per CLI version. */
export class CommandCatalog {
  private lists = new Map<string, { at: number; list: Promise<AgentCommand[]> }>();
  constructor(
    private ask = read,
    private now = () => Date.now(),
  ) {}
  async commands(agent: AgentId, cwd: string): Promise<AgentCommand[]> {
    if (agent !== 'claude' && agent !== 'codex') return [];
    const key = `${agent}\n${cwd}\n${await version(agent)}`;
    const kept = this.lists.get(key);
    if (kept && this.now() - kept.at < keep) return kept.list;
    const list = this.ask(agent, cwd);
    this.lists.set(key, { at: this.now(), list });
    // A failed read is tried again next time.
    list.catch(() => this.lists.delete(key));
    return list;
  }
}
