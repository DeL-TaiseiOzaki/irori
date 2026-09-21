import { z } from 'zod';

/** The runtime-neutral skill package location, shared with Codex, OpenCode and Pi. */
export const skillsRoot = '.agents/skills';
export const skillFile = 'SKILL.md';
/** Replaces SKILL.md when a KB retires a skill on purpose; see docs/SKILLS.md. */
export const retiredFile = 'RETIRED.md';
export const maxSkills = 50;
export const maxSkillBytes = 16 * 1024;

export const skillName = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'A skill name is lowercase letters, digits and hyphens');
/** A role or project name, in a skill's metadata and in the reader's own choice. */
export const audienceName = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u, 'A role or project name is letters, digits, - and _');
/** The reader's role and project for one KB, kept on the device rather than in the KB. */
export const skillAudience = z.object({
  role: audienceName.optional(),
  project: audienceName.optional(),
});
export type SkillAudience = z.infer<typeof skillAudience>;

export type AgentSkill = {
  name: string;
  description: string;
  instructions: string;
  path: string;
  /** Roles and projects the skill is for; empty means everyone. */
  roles: string[];
  projects: string[];
};
export type RetiredSkill = {
  name: string;
  retired: string;
  reason: string;
  replacement?: string;
  path: string;
};
export type SkillProblem = { directory: string; message: string };
export type SkillListing = {
  skills: AgentSkill[];
  retired: RetiredSkill[];
  problems: SkillProblem[];
};

/** A skill scoped to roles or projects shows only to a reader who chose one of them. */
export function skillVisible(skill: AgentSkill, audience: SkillAudience) {
  const fits = (declared: string[], chosen?: string) =>
    !declared.length || !chosen || declared.includes(chosen);
  return fits(skill.roles, audience.role) && fits(skill.projects, audience.project);
}

/** The same sentence under the picker and in the failure of a run that named it. */
export function retirementNotice(skill: RetiredSkill) {
  return (
    `${skill.name} スキルは ${skill.retired} に退役しました: ${skill.reason}` +
    (skill.replacement ? `（代わりに ${skill.replacement}）` : '')
  );
}

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
