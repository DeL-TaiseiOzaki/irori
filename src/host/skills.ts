import path from 'node:path';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import type { FileService } from './files';
import { classify } from '../domain/scopes';
import {
  audienceName,
  maxSkillBytes,
  maxSkills,
  retiredFile,
  retirementNotice,
  skillFile,
  skillName,
  skillsRoot,
  type AgentSkill,
  type RetiredSkill,
  type SkillListing,
  type SkillProblem,
} from '../domain/skills';
import { userSkillRoots, type SkillReach } from '../domain/skill-reach';

const frontMatter = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/;
// The Agent Skills convention keeps metadata values as strings; a list is tolerated.
const names = z
  .union([z.string(), z.array(z.string())])
  .transform((value) => (Array.isArray(value) ? value : value.split(/[\s,]+/)).filter(Boolean))
  .pipe(z.array(audienceName).max(20));
const skillMetadata = z.looseObject({
  name: skillName,
  description: z.string().min(1).max(400),
  metadata: z.looseObject({ roles: names.optional(), projects: names.optional() }).optional(),
});
const retiredMetadata = z.looseObject({
  retired: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'retired is a date, YYYY-MM-DD'),
  reason: z.string().min(1).max(400),
  replacement: skillName.optional(),
});

function split(text: string, what: string) {
  if (new TextEncoder().encode(text).byteLength > maxSkillBytes)
    throw Error(`A ${what} is at most ${maxSkillBytes} bytes`);
  const match = frontMatter.exec(text.replace(/^﻿/, ''));
  if (!match) throw Error(`A ${what} must begin with --- front matter`);
  return {
    metadata: parseYaml(match[1], { schema: 'failsafe', logLevel: 'error', stringKeys: true }),
    body: (match[2] ?? '').trim(),
  };
}

/** Reads one package. YAML stays on this side of the boundary; the renderer
 * only ever needs the name rule and the prompt shape. */
export function parseSkill(directory: string, text: string): AgentSkill {
  const name = skillName.parse(directory);
  const { metadata: raw, body } = split(text, 'skill package');
  const metadata = skillMetadata.parse(raw);
  if (metadata.name !== name)
    throw Error(`Front matter name ${JSON.stringify(metadata.name)} does not match its directory`);
  if (!body) throw Error('A skill has no instructions below its front matter');
  return {
    name,
    description: metadata.description,
    instructions: body,
    path: `${skillsRoot}/${name}/${skillFile}`,
    roles: metadata.metadata?.roles ?? [],
    projects: metadata.metadata?.projects ?? [],
  };
}

/** Reads a retirement marker. It must not look like a skill to any CLI: Pi loads
 * a nested `.md` under `.agents/skills` as a skill once it has a description. */
export function parseRetired(directory: string, text: string): RetiredSkill {
  const name = skillName.parse(directory);
  const { metadata: raw } = split(text, 'retirement marker');
  const metadata = retiredMetadata.parse(raw);
  if ('name' in metadata || 'description' in metadata)
    throw Error('A retirement marker must not declare name or description');
  return {
    name,
    retired: metadata.retired,
    reason: metadata.reason,
    replacement: metadata.replacement,
    path: `${skillsRoot}/${name}/${retiredFile}`,
  };
}

async function readPackage(
  files: FileService,
  scopeId: string,
  name: string,
): Promise<{ skill?: AgentSkill; retired?: RetiredSkill } | undefined> {
  const space = files.get(scopeId);
  const read = async (file: string) => {
    const relative = `${skillsRoot}/${name}/${file}`;
    if (classify(space, relative) !== 'schema')
      throw Error('A skill package must stay in the schema layer');
    try {
      const actual = await files.resolve(scopeId, relative);
      if (path.relative(space.root, actual).split(path.sep).join('/') !== relative)
        throw Error('A skill package must not be an alias');
      return (await files.read(scopeId, relative)).text;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  };
  const skill = await read(skillFile);
  const retired = await read(retiredFile);
  if (skill !== undefined && retired !== undefined)
    throw Error('A retired skill must not keep its SKILL.md');
  if (retired !== undefined) return { retired: parseRetired(name, retired) };
  if (skill !== undefined) return { skill: parseSkill(name, skill) };
  return undefined;
}

/**
 * Lists the skill packages a KB declares in `.agents/skills/`. The directory is
 * schema-layer content the user owns through Git; a malformed package is
 * reported rather than silently dropped, so a skill that stops appearing has a
 * visible reason, and a retired one carries the reason the KB wrote down.
 */
export async function readSkills(files: FileService, scopeId: string): Promise<SkillListing> {
  let directories: string[];
  try {
    directories = (await files.entries(scopeId, skillsRoot))
      .filter((entry) => entry.directory || entry.blocked)
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { skills: [], retired: [], problems: [] };
    throw error;
  }
  const skills: AgentSkill[] = [];
  const retired: RetiredSkill[] = [];
  const problems: SkillProblem[] = [];
  let packages = 0;
  for (const name of directories) {
    try {
      const found = await readPackage(files, scopeId, name);
      if (!found) continue;
      if (++packages > maxSkills) break;
      if (found.skill) skills.push(found.skill);
      if (found.retired) retired.push(found.retired);
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
  return { skills, retired, problems };
}

/** Resolves one skill for a run. A name the KB does not declare is refused, and a
 * retired one is refused with the reason the KB gave. */
export async function requireSkill(
  files: FileService,
  scopeId: string,
  name: string,
): Promise<AgentSkill> {
  const found = await readPackage(files, scopeId, name);
  if (found?.retired) throw Error(retirementNotice(found.retired));
  if (!found?.skill) throw Error(`このスペースに ${name} スキルがありません。`);
  return found.skill;
}

/**
 * Which user-scope skill directories hold a same-named `SKILL.md` for each name
 * the KB declares or retired. The home directory is read here only, and only
 * its home-relative names leave the host; which harness reads which directory,
 * and who wins, is the domain table the reach view renders.
 */
export async function readSkillReach(
  files: FileService,
  scopeId: string,
  home = homedir(),
): Promise<SkillReach> {
  const listing = await readSkills(files, scopeId);
  const named = [
    ...listing.skills.map((skill) => ({ name: skill.name })),
    ...listing.retired.map((skill) => ({ name: skill.name, retired: skill.reason })),
  ].sort((left, right) => left.name.localeCompare(right.name));
  const entries = [];
  for (const entry of named) {
    const found: string[] = [];
    for (const root of userSkillRoots) {
      const file = path.join(home, root.slice(2), entry.name, skillFile);
      if (
        await stat(file).then(
          (info) => info.isFile(),
          () => false,
        )
      )
        found.push(root);
    }
    entries.push({ ...entry, found });
  }
  return { entries };
}
