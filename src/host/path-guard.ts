import { promises as fs } from 'node:fs';
import path from 'node:path';
import { t } from '../domain/i18n';
import { within } from '../domain/scopes';

/**
 * Splits and checks a vault- or Schema-relative path from an untrusted caller.
 * Rejects backslashes, NUL bytes, Windows drive prefixes, leading slashes, and
 * `.` or `..` segments on every platform.
 */
export function safeRelativeParts(target: string): string[] {
  if (
    target.includes('\0') ||
    target.includes('\\') ||
    target.startsWith('/') ||
    /^[A-Za-z]:/.test(target)
  )
    throw Error(t('vault の中のパスではありません。', 'Not a path inside the vault.'));
  const parts = target.split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..'))
    throw Error(t('vault の中のパスではありません。', 'Not a path inside the vault.'));
  return parts;
}

/**
 * Resolves `target` under `root` and verifies that its canonical realpath stays
 * within `root`, blocking both path traversal and symlink escapes.
 */
export async function resolveWithin(root: string, target: string): Promise<string> {
  const parts = safeRelativeParts(target);
  const realRoot = await fs.realpath(root);
  const candidate = path.join(realRoot, ...parts);
  const realTarget = await fs.realpath(candidate);
  if (!within(realRoot, realTarget))
    throw Error(t('vault の中のパスではありません。', 'Not a path inside the vault.'));
  return realTarget;
}

/**
 * Verifies that the deepest existing ancestor of `target` stays within `realRoot`,
 * before any directory creation (`fs.mkdir`) follows a symlink outside `realRoot`.
 */
export async function ancestorWithin(realRoot: string, target: string): Promise<boolean> {
  let dir = path.resolve(target);
  for (;;) {
    try {
      const real = await fs.realpath(dir);
      return within(realRoot, real);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = path.dirname(dir);
      if (parent === dir) return false;
      dir = parent;
    }
  }
}
