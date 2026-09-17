import path from 'node:path';
import type { FileService } from './files';
import { classify } from '../domain/scopes';
import {
  maxSkills,
  parseSkill,
  skillFile,
  skillsRoot,
  type AgentSkill,
  type SkillListing,
  type SkillProblem,
} from '../domain/skills';

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
