import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Claude Code finds a folder's skills only in `.claude/skills`, not in the
 * `.agents/skills` irori writes and the other CLIs read (docs/SKILLS.md). For
 * each Claude Code run, irori makes a folder of links in its data directory,
 * `claude-skills/<run>/.claude/skills/<name>`, one per skill folder, and gives
 * it to Claude Code as an additional directory, whose `.claude/skills` it reads
 * (ADR 049). Nothing is written into a vault or the irori agent's folder.
 */
const linksRoot = (dataDir: string) => path.join(dataDir, 'claude-skills');

/** A skill by its name and the folder that holds its SKILL.md. */
export type LinkedSkill = { name: string; folder: string };

/**
 * Links each skill once, the first of a name winning, and leaves out the names
 * in `skip` (those Claude Code already finds). Returns the folder to add, or
 * undefined when nothing is left to link.
 */
export async function linkClaudeSkills(
  dataDir: string,
  runId: string,
  skills: LinkedSkill[],
  skip: ReadonlySet<string>,
) {
  const chosen = new Map<string, string>();
  for (const skill of skills)
    if (!skip.has(skill.name) && !chosen.has(skill.name)) chosen.set(skill.name, skill.folder);
  if (!chosen.size) return undefined;
  const root = path.join(linksRoot(dataDir), runId);
  const folder = path.join(root, '.claude', 'skills');
  await fs.mkdir(folder, { recursive: true });
  try {
    for (const [name, target] of chosen)
      // A junction on Windows needs no developer mode or elevation.
      await fs.symlink(
        target,
        path.join(folder, name),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
  } catch (error) {
    await unlinkClaudeSkills(dataDir, runId);
    throw error;
  }
  return root;
}

/** Removes a run's links; the skill folders they point at stay as they are. */
export async function unlinkClaudeSkills(dataDir: string, runId: string) {
  await fs.rm(path.join(linksRoot(dataDir), runId), { recursive: true, force: true });
}

/** Removes the links of runs that ended without removing them, keeping `active`. */
export async function pruneClaudeSkills(dataDir: string, active: (runId: string) => boolean) {
  for (const runId of await fs.readdir(linksRoot(dataDir)).catch(() => [] as string[]))
    if (!active(runId)) await unlinkClaudeSkills(dataDir, runId);
}

/** The skill names a folder's own `.claude/skills` holds, which Claude Code reads itself. */
export async function claudeSkillNames(root: string) {
  const entries = await fs
    .readdir(path.join(root, '.claude', 'skills'), { withFileTypes: true })
    .catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((e) => e.name);
}
