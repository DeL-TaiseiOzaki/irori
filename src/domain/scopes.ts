import path from 'node:path';
import type { Layer, Space } from './types';
import { hasLayer, isSchemaPath, knowledgeFolder, underFolder } from './layers';
export function within(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}
export function owner<T extends { root: string }>(spaces: T[], target: string): T | undefined {
  return spaces
    .filter((s) => within(s.root, target))
    .sort((a, b) => b.root.length - a.root.length)[0];
}
type Sorted = Pick<Space, 'contents' | 'layers' | 'knowledge' | 'rootLayer'>;
/** Whether a path is one of the vault's contents folders or inside one: where its connections are. */
export function inContentsFolder(space: Pick<Space, 'contents'>, relative: string) {
  const p = relative.replaceAll('\\', '/');
  return space.contents.some((root) => p === root || p.startsWith(root + '/'));
}
/**
 * The layer of the vault's own files: those outside Schema and its contents
 * folders. Knowledge when the vault has it, else Contents, else Schema (ADR 070,
 * ADR 071). A vault with both may put them in Contents; Knowledge is then its
 * named folder alone.
 */
export function ownLayer(space: Sorted): Layer {
  const notes = hasLayer(space, 'Knowledge_Base');
  const materials = hasLayer(space, 'contents');
  if (notes && materials && space.rootLayer === 'contents' && knowledgeFolder(space))
    return 'contents';
  return notes ? 'Knowledge_Base' : materials ? 'contents' : 'schema';
}
/**
 * The layer a vault path belongs to. A declared contents folder stays Contents
 * even in a vault that left the layer out, so what was connected there is never
 * read as the vault's own files. The rest is the vault's own: see `ownLayer`.
 */
export function classify(space: Sorted, relative: string): Layer {
  const p = relative.replaceAll('\\', '/');
  if (inContentsFolder(space, p)) return 'contents';
  // A hidden top-level entry is configuration some tool wrote, not the user's knowledge.
  // A KB is often also an Obsidian vault and a Git checkout, so `.obsidian`, `.claudian`,
  // `.github` and `.gitignore` arrive without irori doing anything; naming each agent
  // directory instead left them displayed as notes. Search and note operations already
  // skip hidden path components, so this agrees with the rest of the host.
  if (isSchemaPath(p)) return 'schema';
  const own = ownLayer(space);
  if (
    own === 'contents' &&
    hasLayer(space, 'Knowledge_Base') &&
    p &&
    underFolder(knowledgeFolder(space), p)
  )
    return 'Knowledge_Base';
  return own;
}
/** Whether a path is one of the vault's own files that irori sorts into Contents (ADR 071). */
export function ownContents(space: Sorted, relative: string) {
  return classify(space, relative) === 'contents' && !inContentsFolder(space, relative);
}

/** A knowledge page, which shows its properties above its body (ADR 015); a folder index does not. */
export function isPropertyPage(space: Space, relative: string): boolean {
  const p = relative.replaceAll('\\', '/');
  return (
    classify(space, p) === 'Knowledge_Base' && /\.md$/i.test(p) && !/(^|\/)index\.md$/i.test(p)
  );
}
