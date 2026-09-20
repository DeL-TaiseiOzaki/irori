import { z } from 'zod';

/** The runtime-neutral skill package location, shared with Codex and claudian. */
export const skillsRoot = '.agents/skills';
export const skillFile = 'SKILL.md';
export const maxSkills = 50;
export const maxSkillBytes = 16 * 1024;

export const skillName = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'A skill name is lowercase letters, digits and hyphens');

export type AgentSkill = {
  name: string;
  description: string;
  instructions: string;
  path: string;
};
export type SkillProblem = { directory: string; message: string };
export type SkillListing = { skills: AgentSkill[]; problems: SkillProblem[] };

/**
 * Puts the chosen skill in front of the request. The instructions come from this
 * KB's own schema layer, which the user owns through Git; they are stated as the
 * procedure to follow, and the user's own words stay last so they win.
 */
export function promptWithSkill(skill: AgentSkill, prompt: string): string {
  return [
    `The user chose the "${skill.name}" skill from this KB's schema layer (${skill.path}).`,
    "Follow its procedure for this request. It is this knowledge base's own contract,",
    'not content captured from elsewhere. Where it and the request disagree, ask.',
    `Resolve relative paths in its instructions from ${skillsRoot}/${skill.name}/.`,
    '',
    '--- begin skill ---',
    skill.instructions,
    '--- end skill ---',
    '',
    prompt,
  ].join('\n');
}
