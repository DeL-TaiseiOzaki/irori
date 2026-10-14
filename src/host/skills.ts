import path from 'node:path';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import { reachedAsWritten, type FileService } from './files';
import { isMissing, issueSummary } from './local-json';
import { spaceFolder, type SchemaFolder } from './schema-folder';
import {
  audienceName,
  characters,
  maxSkillBytes,
  maxSkillDescription,
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
import { t } from '../domain/i18n';
import { matchFrontMatter } from '../domain/schema-settings';

// The Agent Skills convention keeps metadata values as strings; a list is tolerated.
const names = z
  .union([z.string(), z.array(z.string())])
  .transform((value) => (Array.isArray(value) ? value : value.split(/[\s,]+/)).filter(Boolean))
  .pipe(z.array(audienceName).max(20));
const skillMetadata = z.looseObject({
  name: skillName,
  // Past the specification's limit the skill still loads; only its summary is cut.
  description: z.string().min(1),
  metadata: z.looseObject({ roles: names.optional(), projects: names.optional() }).optional(),
});
const retiredMetadata = z.looseObject({
  retired: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'retired is a date, YYYY-MM-DD'),
  reason: z.string().min(1).max(400),
  replacement: skillName.optional(),
});

/** A validation failure as `key: reason`, instead of Zod's JSON. */
function valid<T>(schema: z.ZodType<T>, value: unknown, what?: string): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issues = what
    ? result.error.issues.map((issue) => ({ ...issue, path: [what, ...issue.path] }))
    : result.error.issues;
  throw Error(issueSummary(issues));
}

function split(text: string, what: string) {
  if (new TextEncoder().encode(text).byteLength > maxSkillBytes)
    throw Error(`A ${what} is at most ${maxSkillBytes} bytes`);
  const match = matchFrontMatter(text);
  if (!match) throw Error(`A ${what} must begin with --- front matter`);
  return {
    metadata: parseYaml(match[1], { schema: 'failsafe', logLevel: 'error', stringKeys: true }),
    body: (match[2] ?? '').trim(),
  };
}

/** Reads one package. YAML stays on this side of the boundary; the renderer
 * only ever needs the name rule and the prompt shape. */
export function parseSkill(directory: string, text: string): AgentSkill {
  const name = valid(skillName, directory, 'directory');
  const { metadata: raw, body } = split(text, 'skill package');
  const metadata = valid(skillMetadata, raw);
  if (metadata.name !== name)
    throw Error(`Front matter name ${JSON.stringify(metadata.name)} does not match its directory`);
  if (!body) throw Error('A skill has no instructions below its front matter');
  const length = characters(metadata.description);
  const long = length > maxSkillDescription;
  return {
    name,
    description: long
      ? [...metadata.description].slice(0, maxSkillDescription - 1).join('') + '…'
      : metadata.description,
    instructions: body,
    path: `${skillsRoot}/${name}/${skillFile}`,
    roles: metadata.metadata?.roles ?? [],
    projects: metadata.metadata?.projects ?? [],
    ...(long && {
      notice: t(
        `説明が ${length} 文字あります。Agent Skills の上限 ${maxSkillDescription} 文字に切って使います。`,
        `The description is ${length} characters; irori cuts it to ${maxSkillDescription}, the Agent Skills limit.`,
      ),
    }),
  };
}

/** Reads a retirement marker. It must not look like a skill to any CLI: Pi loads
 * a nested `.md` under `.agents/skills` as a skill once it has a description. */
export function parseRetired(directory: string, text: string): RetiredSkill {
  const name = valid(skillName, directory, 'directory');
  const { metadata: raw } = split(text, 'retirement marker');
  const metadata = valid(retiredMetadata, raw);
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
  folder: SchemaFolder,
  name: string,
): Promise<{ skill?: AgentSkill; retired?: RetiredSkill } | undefined> {
  const read = async (file: string) => {
    const relative = `${skillsRoot}/${name}/${file}`;
    if (folder.layer(relative) !== 'schema')
      throw Error('A skill package must stay in the schema layer');
    try {
      const actual = await folder.resolve(relative);
      if (!reachedAsWritten(folder.root, actual, relative))
        throw Error('A skill package must not be an alias');
      return await folder.read(relative);
    } catch (error) {
      if (isMissing(error)) return undefined;
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
  return readFolderSkills(spaceFolder(files, scopeId));
}

/** The same listing for any Schema folder, the irori agent's among them. */
export async function readFolderSkills(folder: SchemaFolder): Promise<SkillListing> {
  let directories: string[];
  try {
    directories = (await folder.entries(skillsRoot))
      .filter((entry) => entry.directory || entry.blocked)
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (isMissing(error)) return { skills: [], retired: [], problems: [] };
    throw error;
  }
  const skills: AgentSkill[] = [];
  const retired: RetiredSkill[] = [];
  const problems: SkillProblem[] = [];
  let packages = 0;
  for (const name of directories) {
    try {
      const found = await readPackage(folder, name);
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
  const found = await findSkill(spaceFolder(files, scopeId), name);
  if (!found) throw noSkill(name);
  return found;
}

/** The refusal for a request that names a skill no Schema it reads declares. */
export const noSkill = (name: string) =>
  Error(t(`このスペースに ${name} スキルがありません。`, `This space has no ${name} skill.`));

/** One skill package of a Schema folder, undefined when absent; a retired one is refused. */
export async function findSkill(folder: SchemaFolder, name: string) {
  const found = await readPackage(folder, name);
  if (found?.retired) throw Error(retirementNotice(found.retired));
  return found?.skill;
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
