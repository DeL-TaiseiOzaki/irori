import { lstat } from 'node:fs/promises';
import { resolveNoteLink, type ResolvedLink } from '../domain/note-links';
import { classify } from '../domain/scopes';
import type { FileService } from './files';

/**
 * Whether the disk reaches `relative` through its name in the other case, as a
 * link written in that case would on Windows or a default Mac volume. Observed
 * rather than read off the platform: either kind of volume mounts on any of them.
 */
export async function foldsCase(files: FileService, scopeId: string, relative: string) {
  const other = relative.replace(/[^/]*$/, (name) =>
    name === name.toUpperCase() ? name.toLowerCase() : name.toUpperCase(),
  );
  if (other === relative) return false;
  try {
    const [a, b] = await Promise.all(
      [relative, other].map(async (p) => lstat(await files.resolve(scopeId, p))),
    );
    return a.dev === b.dev && a.ino === b.ino;
  } catch {
    return false;
  }
}

/**
 * Resolve a link written in one note to something the window can open. The path
 * work is the domain's; what is here is what only the host can answer — whether
 * the file exists, and whether the space's own guards let it be opened.
 */
export async function resolveLink(
  files: FileService,
  scopeId: string,
  from: string,
  href: string,
): Promise<ResolvedLink> {
  const target = resolveNoteLink(from, href);
  if (target.kind !== 'internal') return target;
  if (classify(files.get(scopeId), target.path) === 'contents')
    return { kind: 'rejected', reason: 'contents のファイルへのリンクはこの版では開けません。' };
  let filename;
  try {
    filename = await files.resolve(scopeId, target.path);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? { kind: 'missing', path: target.path }
      : { kind: 'rejected', reason: 'このリンクはこの KB の外を指しています。' };
  }
  // A directory, a device file or a link replaced after resolution is not a document.
  if (!(await lstat(filename)).isFile())
    return { kind: 'rejected', reason: 'リンク先がファイルではありません。' };
  return { kind: 'file', path: target.path, note: /\.md$/i.test(target.path) };
}
