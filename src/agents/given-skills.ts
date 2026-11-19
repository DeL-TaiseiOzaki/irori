import { promises as fs } from 'node:fs';
import path from 'node:path';
import writeFileAtomic from 'write-file-atomic';
import type { LinkedSkill } from './claude-skills';

/**
 * The shared Schema's skills as skills of Codex, OpenCode and the Antigravity
 * CLI (ADR 066). Each finds the `.agents/skills` of the folder it works in by
 * itself, but not the shared Schema's, which is in the irori agent's folder.
 * For each run irori makes `given-skills/<run>/.agents/skills/<name>` in its
 * data directory and gives that folder the way each CLI takes more skills:
 *
 * - Codex: an extra skill root of its app server (`skills/extraRoots/set`).
 * - OpenCode: a skill path irori's plugin adds to its configuration.
 * - The Antigravity CLI: a workspace folder (`--add-dir`), whose `.agents/skills`
 *   it reads.
 *
 * Codex and OpenCode get links to the skill folders, as Claude Code does
 * (ADR 049). The Antigravity CLI gets copies: its standard mode changes a
 * workspace folder's files without asking, and through a link it would change
 * the shared Schema. Nothing is written into a vault or the irori agent's folder.
 */
const givenRoot = (dataDir: string) => path.join(dataDir, 'given-skills');

/** A run's given skills: the folder to add as a workspace, the skills folder inside it, and their names. */
export type GivenSkills = { root: string; skills: string; names: string[] };

/**
 * Gives each skill once, the first of a name winning, leaving out the names in
 * `skip` (those the CLI already finds). Returns undefined when nothing is left.
 */
export async function giveSkills(
  dataDir: string,
  runId: string,
  skills: LinkedSkill[],
  skip: ReadonlySet<string>,
  copy: boolean,
): Promise<GivenSkills | undefined> {
  const chosen = new Map<string, string>();
  for (const skill of skills)
    if (!skip.has(skill.name) && !chosen.has(skill.name)) chosen.set(skill.name, skill.folder);
  if (!chosen.size) return undefined;
  const root = path.join(givenRoot(dataDir), runId);
  const folder = path.join(root, '.agents', 'skills');
  await fs.mkdir(folder, { recursive: true });
  try {
    for (const [name, source] of chosen)
      if (copy) await fs.cp(source, path.join(folder, name), { recursive: true });
      // A junction on Windows needs no developer mode or elevation.
      else
        await fs.symlink(
          source,
          path.join(folder, name),
          process.platform === 'win32' ? 'junction' : 'dir',
        );
  } catch (error) {
    await removeGivenSkills(dataDir, runId);
    throw error;
  }
  return { root, skills: folder, names: [...chosen.keys()] };
}

/** Removes a run's given skills; the skill folders the links point at stay as they are. */
export async function removeGivenSkills(dataDir: string, runId: string) {
  await fs.rm(path.join(givenRoot(dataDir), runId), { recursive: true, force: true });
}

/** Removes the given skills of runs that ended without removing them, keeping `live`. */
export async function pruneGivenSkills(dataDir: string, live: (runId: string) => boolean) {
  for (const runId of await fs.readdir(givenRoot(dataDir)).catch(() => [] as string[]))
    if (!live(runId)) await removeGivenSkills(dataDir, runId);
}

/**
 * The skill names OpenCode finds in a folder besides its `.agents/skills`: those
 * of `.claude/skills` and of `.opencode/skills` (or `skill`). A shared skill of
 * such a name is not given, as the folder's own wins (ADR 027 D8).
 */
export async function openCodeSkillNames(root: string) {
  const names: string[] = [];
  for (const dir of [
    path.join('.claude', 'skills'),
    path.join('.opencode', 'skills'),
    path.join('.opencode', 'skill'),
  ]) {
    const entries = await fs.readdir(path.join(root, dir), { withFileTypes: true }).catch(() => []);
    for (const entry of entries)
      if (entry.isDirectory() || entry.isSymbolicLink()) names.push(entry.name);
  }
  return names;
}

// OpenCode lets a plugin's `config` hook change its configuration before
// anything else starts ("Plugin can mutate config so it has to be initialized
// before anything else"). A skill path set in OPENCODE_CONFIG_CONTENT would
// replace the person's own `skills.paths`, as OpenCode merges arrays by
// replacing them, so the plugin adds irori's folders to theirs instead. It is
// loaded from irori's data directory, never the KB, and reads the folders from
// its process's environment.
const openCodeScript = `export const IroriSkillPaths = async () => ({
  config: async (config) => {
    const folders = JSON.parse(process.env.IRORI_SKILL_PATHS || '[]');
    if (!Array.isArray(folders) || !folders.length) return;
    const skills = config.skills || {};
    config.skills = { ...skills, paths: [...(skills.paths || []), ...folders] };
  },
});
`;

/** OpenCode's environment with irori's plugin adding `folders` to its skill paths. */
export async function openCodeSkillPaths(
  dataDir: string,
  folders: string[],
  env: NodeJS.ProcessEnv,
) {
  const file = path.join(dataDir, 'agents', 'skill-paths-opencode.js');
  await fs.mkdir(path.dirname(file), { recursive: true });
  // Replaced whole: another run's OpenCode may be loading it at this moment.
  await writeFileAtomic(file, openCodeScript);
  // OpenCode reads a plugin from an absolute path named in this variable's JSON,
  // merged after its own files; plugins already named there stay.
  const content = JSON.parse(env.OPENCODE_CONFIG_CONTENT ?? '{}');
  return {
    ...env,
    IRORI_SKILL_PATHS: JSON.stringify(folders),
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      ...content,
      plugin: [...(content.plugin ?? []), file],
    }),
  };
}
