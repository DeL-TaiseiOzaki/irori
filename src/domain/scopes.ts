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
  if (
    [
      'schema',
      '.irori',
      '.claude',
      '.codex',
      '.opencode',
      '.pi',
      '.agents',
      '.cursor',
      '.gemini',
      '.hermes',
    ].includes(top) ||
    ['AGENTS.md', 'CLAUDE.md', '.mcp.json', 'opencode.json', 'opencode.jsonc'].includes(p)
  )
    return 'schema';
  return 'Knowledge_Base';
}
