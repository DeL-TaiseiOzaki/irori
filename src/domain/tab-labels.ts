import { baseName, parentPath } from './paths';

export interface TabLabel {
  name: string;
  /**
   * The end of the folder path that tells this tab from another with the same
   * name: as few folders as do it. Absent when the name is unique; '/' for a
   * file at the top.
   */
  folder?: string;
}

/**
 * Labels for open files, as an editor's tabs show them: the file's name, and
 * for names open more than once, just enough of each folder to tell them apart.
 */
export function tabLabels(paths: string[]): Map<string, TabLabel> {
  const labels = new Map<string, TabLabel>();
  const byName = new Map<string, string[]>();
  for (const path of new Set(paths)) {
    const name = baseName(path);
    byName.set(name, [...(byName.get(name) ?? []), path]);
  }
  for (const [name, group] of byName) {
    if (group.length === 1) {
      labels.set(group[0], { name });
      continue;
    }
    const folders = group.map((path) => {
      const parent = parentPath(path);
      return parent ? parent.split('/') : [];
    });
    const deepest = Math.max(...folders.map((parts) => parts.length));
    // Take one more folder from the end until every hint differs.
    let depth = 1;
    const hint = (parts: string[]) => (parts.length ? parts.slice(-depth).join('/') : '/');
    while (depth < deepest && new Set(folders.map(hint)).size < group.length) depth++;
    group.forEach((path, index) => labels.set(path, { name, folder: hint(folders[index]) }));
  }
  return labels;
}
