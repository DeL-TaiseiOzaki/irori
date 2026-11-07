import path from 'node:path';
import { instructionsFile, ruleFileName, rulesRoot } from '../domain/schema-settings';
import { ifPresent } from './local-json';
import type { SchemaFolder } from './schema-folder';
import { readFolderSkills } from './skills';

/**
 * How much of a Schema's instructions and rules goes whole into a request;
 * beyond it, their files are named for the agent to read (ADR 027, ADR 058).
 */
export const schemaInline = 32 * 1024;
/** How deep in `.claude/rules` rules are looked for, as Claude Code finds them in subfolders too. */
const ruleDepth = 4;
const ruleLimit = 200;

/** A Schema folder's instructions, rules and skills, as irori tells them to agents. */
export interface SchemaParts {
  root: string;
  /** Its `AGENTS.md`. */
  file: string;
  /** The instructions, absent when there are none. */
  instructions?: string;
  /** The size of `AGENTS.md` in bytes, 0 without one. */
  bytes: number;
  rules: { file: string; text: string }[];
  skills: { name: string; description: string; path: string }[];
}

async function ruleFiles(folder: SchemaFolder, relative: string, depth: number, out: string[]) {
  for (const entry of (await ifPresent(folder.entries(relative))) ?? []) {
    if (out.length >= ruleLimit) return;
    if (entry.blocked) continue;
    if (entry.directory) {
      if (depth < ruleDepth) await ruleFiles(folder, entry.path, depth + 1, out);
    } else if (ruleFileName(entry.name)) out.push(entry.path);
  }
}

/** Reads what a Schema folder says to agents: `AGENTS.md`, `.claude/rules` and `.agents/skills`. */
export async function readSchemaParts(folder: SchemaFolder): Promise<SchemaParts> {
  const raw = await ifPresent(folder.read(instructionsFile));
  const text = raw?.trim();
  const skills = (await ifPresent(readFolderSkills(folder)))?.skills ?? [];
  const found: string[] = [];
  await ruleFiles(folder, rulesRoot, 1, found);
  const rules: SchemaParts['rules'] = [];
  for (const relative of found.sort((a, b) => a.localeCompare(b))) {
    const rule = (await ifPresent(folder.read(relative)))?.trim();
    if (rule) rules.push({ file: path.join(folder.root, relative), text: rule });
  }
  return {
    root: folder.root,
    file: path.join(folder.root, instructionsFile),
    ...(text && { instructions: text }),
    bytes: raw === undefined ? 0 : Buffer.byteLength(raw, 'utf8'),
    rules,
    skills: skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      path: path.join(folder.root, skill.path),
    })),
  };
}

/**
 * Instructions and rules as they fit in a request: the instructions whole when
 * within `limit`, otherwise named as long; the rules whole while they fit beside
 * the instructions sent, otherwise each by its file.
 */
export function fitParts(
  instructions: string | undefined,
  rules: SchemaParts['rules'],
  limit = schemaInline,
) {
  const long = !!instructions && Buffer.byteLength(instructions, 'utf8') > limit;
  const room = limit - (instructions && !long ? Buffer.byteLength(instructions, 'utf8') : 0);
  const inline =
    rules.reduce((size, rule) => size + Buffer.byteLength(rule.text, 'utf8'), 0) <= room;
  return {
    ...(instructions && !long && { instructions }),
    ...(long && { long }),
    rules: rules.map((rule) => (inline ? rule : { file: rule.file })),
  };
}
