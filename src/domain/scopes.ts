import path from 'node:path';
import type { Layer, Space } from './types';
export function within(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}
export function owner<T extends { root: string }>(spaces: T[], target: string): T | undefined {
  return spaces
    .filter((s) => within(s.root, target))
    .sort((a, b) => b.root.length - a.root.length)[0];
}
export function classify(space: Space, relative: string): Layer {
  const p = relative.replaceAll('\\', '/');
  if (space.contents.some((root) => p === root || p.startsWith(root + '/'))) return 'contents';
  const top = p.split('/')[0];
  // A hidden top-level entry is configuration some tool wrote, not the user's knowledge.
  // A KB is often also an Obsidian vault and a Git checkout, so `.obsidian`, `.claudian`,
  // `.github` and `.gitignore` arrive without irori doing anything; naming each agent
  // directory instead left them displayed as notes. Search and note operations already
  // skip hidden path components, so this agrees with the rest of the host.
  if (top.startsWith('.') || top === 'schema') return 'schema';
  if (['AGENTS.md', 'CLAUDE.md', 'opencode.json', 'opencode.jsonc'].includes(p)) return 'schema';
  return 'Knowledge_Base';
}
