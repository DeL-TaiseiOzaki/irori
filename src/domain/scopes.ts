import path from 'node:path';
import type { Layer, Space } from './types';
import { hasLayer, isSchemaPath } from './layers';
export function within(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}
export function owner<T extends { root: string }>(spaces: T[], target: string): T | undefined {
  return spaces
    .filter((s) => within(s.root, target))
    .sort((a, b) => b.root.length - a.root.length)[0];
}
/**
 * The layer a vault path belongs to. A declared contents folder stays Contents
 * even in a vault that left the layer out, so what was connected there is never
 * read as the vault's own files. The rest of a vault without a Knowledge layer
 * is Schema: its own files, with nothing kept as notes (ADR 070).
 */
export function classify(space: Pick<Space, 'contents' | 'layers'>, relative: string): Layer {
  const p = relative.replaceAll('\\', '/');
  if (space.contents.some((root) => p === root || p.startsWith(root + '/'))) return 'contents';
  // A hidden top-level entry is configuration some tool wrote, not the user's knowledge.
  // A KB is often also an Obsidian vault and a Git checkout, so `.obsidian`, `.claudian`,
  // `.github` and `.gitignore` arrive without irori doing anything; naming each agent
  // directory instead left them displayed as notes. Search and note operations already
  // skip hidden path components, so this agrees with the rest of the host.
  if (isSchemaPath(p)) return 'schema';
  return hasLayer(space, 'Knowledge_Base') ? 'Knowledge_Base' : 'schema';
}

/** A knowledge page, which shows its properties above its body (ADR 015); a folder index does not. */
export function isPropertyPage(space: Space, relative: string): boolean {
  const p = relative.replaceAll('\\', '/');
  return (
    classify(space, p) === 'Knowledge_Base' && /\.md$/i.test(p) && !/(^|\/)index\.md$/i.test(p)
  );
}
