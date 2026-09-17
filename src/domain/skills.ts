import { z } from 'zod';
import { parse as parseYaml } from 'yaml';

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

const frontMatter = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/;
const skillMetadata = z.looseObject({
  name: skillName,
  description: z.string().min(1).max(400),
});

export function parseSkill(directory: string, text: string): AgentSkill {
  if (new TextEncoder().encode(text).byteLength > maxSkillBytes)
    throw Error(`A skill package is at most ${maxSkillBytes} bytes`);
  const name = skillName.parse(directory);
  const match = frontMatter.exec(text.replace(/^﻿/, ''));
  if (!match)
    throw Error('A skill must begin with --- front matter declaring name and description');
  const metadata = skillMetadata.parse(
    parseYaml(match[1], { schema: 'failsafe', logLevel: 'error', stringKeys: true }),
  );
  if (metadata.name !== name)
    throw Error(`Front matter name ${JSON.stringify(metadata.name)} does not match its directory`);
  const instructions = (match[2] ?? '').trim();
  if (!instructions) throw Error('A skill has no instructions below its front matter');
  return {
    name,
    description: metadata.description,
    instructions,
    path: `${skillsRoot}/${name}/${skillFile}`,
  };
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
    '',
    '--- begin skill ---',
    skill.instructions,
    '--- end skill ---',
    '',
    prompt,
  ].join('\n');
}
