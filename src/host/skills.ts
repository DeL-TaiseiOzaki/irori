import path from 'node:path';
import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import type { FileService } from './files';
import { classify } from '../domain/scopes';
import {
  maxSkillBytes,
  maxSkills,
  skillFile,
  skillName,
  skillsRoot,
  type AgentSkill,
  type SkillListing,
  type SkillProblem,
} from '../domain/skills';

const frontMatter = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/;
const skillMetadata = z.looseObject({
  name: skillName,
  description: z.string().min(1).max(400),
});

/** Reads one package. YAML stays on this side of the boundary; the renderer
 * only ever needs the name rule and the prompt shape. */
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

async function readSkill(
  files: FileService,
  scopeId: string,
  name: string,
): Promise<AgentSkill | undefined> {
  const space = files.get(scopeId);
  const relative = `${skillsRoot}/${name}/${skillFile}`;
  try {
    if (classify(space, relative) !== 'schema')
      throw Error('A skill package must stay in the schema layer');
    const actual = await files.resolve(scopeId, relative);
    if (path.relative(space.root, actual).split(path.sep).join('/') !== relative)
      throw Error('A skill package must not be an alias');
    return parseSkill(name, (await files.read(scopeId, relative)).text);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/**
 * Lists the skill packages a KB declares in `.agents/skills/`. The directory is
 * schema-layer content the user owns through Git; a malformed package is
 * reported rather than silently dropped, so a skill that stops appearing has a
 * visible reason.
 */
export async function readSkills(files: FileService, scopeId: string): Promise<SkillListing> {
  let directories: string[];
  try {
    directories = (await files.entries(scopeId, skillsRoot))
      .filter((entry) => entry.directory || entry.blocked)
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { skills: [], problems: [] };
    throw error;
  }
  const skills: AgentSkill[] = [];
  const problems: SkillProblem[] = [];
  let packages = 0;
  for (const name of directories) {
    try {
      const skill = await readSkill(files, scopeId, name);
      if (!skill) continue;
      if (++packages > maxSkills) break;
      skills.push(skill);
    } catch (error) {
      if (++packages > maxSkills) break;
      problems.push({
        directory: `${skillsRoot}/${name}`,
        message: error instanceof Error ? error.message : 'Could not read this skill package',
      });
    }
  }
  if (packages > maxSkills)
    problems.push({
      directory: skillsRoot,
      message: `Only the first ${maxSkills} skill packages are listed`,
    });
  return { skills, problems };
}

/** Resolves one skill for a run. A name the KB does not declare is refused. */
export async function requireSkill(
  files: FileService,
  scopeId: string,
  name: string,
): Promise<AgentSkill> {
  const found = await readSkill(files, scopeId, name);
  if (!found) throw Error(`このスペースに ${name} スキルがありません。`);
  return found;
}
