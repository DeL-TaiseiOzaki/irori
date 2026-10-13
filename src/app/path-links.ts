import { createContext, useContext } from 'react';
import { locatePath, writtenPath, type PathRoot, type PathTarget } from '../domain/path-links';

/** What the window lends a reply's paths: the vaults they may land in, and the stage that opens them. */
export interface PathOpener {
  roots: PathRoot[];
  /** The vault on show: where a relative path from the irori agent is read. */
  fallback?: string;
  open: (target: PathTarget) => void;
}
export const PathOpenerContext = createContext<PathOpener | undefined>(undefined);
/** The vault whose agent wrote the reply; its relative paths start in that vault's folder. */
export const PathBase = createContext<string | undefined>(undefined);

/** The vault file a link's destination or inline code names, and how to open it. */
export function usePathTarget(value: string | undefined, kind: 'href' | 'code') {
  const opener = useContext(PathOpenerContext);
  const base = useContext(PathBase) ?? opener?.fallback;
  if (!opener || !value) return undefined;
  const written = writtenPath(value, kind);
  const target = written && locatePath(written, opener.roots, base);
  return target && { target, open: () => opener.open(target) };
}
