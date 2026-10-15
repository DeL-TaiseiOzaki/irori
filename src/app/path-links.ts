import { createContext, useContext } from 'react';
import {
  isAbsolute,
  locatePath,
  writtenPath,
  type PathRoot,
  type PathTarget,
  type WrittenPath,
} from '../domain/path-links';

/**
 * What the window lends a reply's paths: the folders they may land in (the
 * workspace's vaults, their connected folders and the irori agent's), and the
 * stage that opens them.
 */
export interface PathOpener {
  roots: PathRoot[];
  /** The workspace whose folders the host looks in. */
  workspaceId?: string;
  /** A vault's name, or `irori agent`, for a choice between files. */
  name: (scopeId: string) => string;
  open: (target: PathTarget) => void;
}
export const PathOpenerContext = createContext<PathOpener | undefined>(undefined);
/** Whose agent wrote the reply: a vault's id or the irori agent's; its relative paths start in that folder. */
export const PathBase = createContext<string | undefined>(undefined);

/** A path a reply names: what was written, and the file it points at once the host has found it. */
export interface PathLinkTarget {
  written: WrittenPath;
  /** Known at once for an absolute path in one of the folders. */
  target?: PathTarget;
  /** Every file it may be, the one to open alone when there is one. */
  find: () => Promise<PathTarget[]>;
  open: (target: PathTarget) => void;
  name: (scopeId: string) => string;
}

/**
 * The path a link's destination or inline code names, and how to find and open
 * it. A relative path is always offered: where its writer works is where it is
 * looked for first (ADR 044). An absolute one only when one of the folders holds it.
 */
export function usePathTarget(
  value: string | undefined,
  kind: 'href' | 'code',
): PathLinkTarget | undefined {
  const opener = useContext(PathOpenerContext);
  const base = useContext(PathBase);
  if (!opener || !value) return undefined;
  const written = writtenPath(value, kind);
  if (!written) return undefined;
  const target = isAbsolute(written.path) ? locatePath(written, opener.roots) : undefined;
  if (isAbsolute(written.path) && !target) return undefined;
  const at = {
    ...(written.line && { line: written.line }),
    ...(written.column && { column: written.column }),
  };
  return {
    written,
    target,
    find: async () =>
      (
        await window.irori.locateAgentPath({
          path: written.path,
          ...(base && { from: base }),
          ...(opener.workspaceId && { workspaceId: opener.workspaceId }),
        })
      ).map((found) => ({ ...found, ...at })),
    open: opener.open,
    name: opener.name,
  };
}
