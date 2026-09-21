import type { AgentId } from './types';

/**
 * Where each harness looks for skills when irori launches it at the KB root, and
 * what it does when a user-scope skill carries the same name. The sources and
 * versions behind each row are in docs/SKILLS.md; the reach view renders this.
 */
export type ReachRule = {
  /** Whether the CLI itself finds the KB's `.agents/skills`. */
  native: 'reads' | 'trusted' | 'ignores';
  /** Home-relative directories the CLI also reads. */
  user: string[];
  /** The KB skill's fate when a user-scope skill has the same name. */
  clash: 'user-wins' | 'both' | 'unspecified';
};
export const skillReachRules: Record<AgentId, ReachRule> = {
  codex: { native: 'reads', user: ['~/.agents/skills', '~/.codex/skills'], clash: 'both' },
  claude: { native: 'ignores', user: ['~/.claude/skills'], clash: 'user-wins' },
  opencode: {
    native: 'reads',
    user: ['~/.agents/skills', '~/.claude/skills', '~/.config/opencode/skills'],
    clash: 'unspecified',
  },
  pi: { native: 'trusted', user: ['~/.agents/skills', '~/.pi/agent/skills'], clash: 'user-wins' },
};
/** Every user-scope directory some harness reads, checked once per skill name. */
export const userSkillRoots = [...new Set(Object.values(skillReachRules).flatMap((r) => r.user))];

export type SkillReachEntry = {
  name: string;
  /** The retirement reason, when the name is a retired one. */
  retired?: string;
  /** Home-relative directories holding a same-named `SKILL.md`; never a machine path. */
  found: string[];
};
export type SkillReach = { entries: SkillReachEntry[] };
