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

const frontMatter = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/;

/**
 * Reads the small scalar front matter a SKILL.md carries. This is deliberately
 * not a YAML parser: a skill declares a name and a description, and anything
 * that needs more structure belongs in the instructions.
 */
export function parseSkillFrontMatter(text: string): Record<string, string> {
  const match = frontMatter.exec(text.replace(/^﻿/, ''));
  if (!match)
    throw Error('A skill must begin with --- front matter declaring name and description');
  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const field = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(line);
    if (!field)
      throw Error(`Front matter accepts only "key: value" lines, not ${JSON.stringify(line)}`);
    const [, key, raw] = field;
    if (Object.hasOwn(fields, key)) throw Error(`Front matter repeats ${key}`);
    fields[key] = raw.trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
  }
  return fields;
}

export function parseSkill(directory: string, text: string): AgentSkill {
  if (text.length > maxSkillBytes)
    throw Error(`A skill package is at most ${maxSkillBytes} characters`);
  const name = skillName.parse(directory);
  const fields = parseSkillFrontMatter(text);
  const declared = fields.name ?? '';
  if (!declared) throw Error('Front matter must declare name');
  if (declared !== name)
    throw Error(`Front matter name ${JSON.stringify(declared)} does not match its directory`);
  const description = fields.description ?? '';
  if (!description) throw Error('Front matter must declare description');
  if (description.length > 400) throw Error('A description is at most 400 characters');
  const instructions = (frontMatter.exec(text.replace(/^﻿/, ''))?.[2] ?? '').trim();
  if (!instructions) throw Error('A skill has no instructions below its front matter');
  return { name, description, instructions, path: `${skillsRoot}/${name}/${skillFile}` };
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
