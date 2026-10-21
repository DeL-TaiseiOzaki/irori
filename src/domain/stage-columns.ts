/**
 * The stage's columns and their tabs (ADR 052), kept per vault as the agent
 * columns keep their conversations. Each column has its own open files; one
 * column holds the focus, and the file on show there is the one being edited.
 * A tab is a path in the vault.
 */
export type StageColumn = { id: string; tabs: string[]; on?: string };
export type StageSet = { columns: StageColumn[]; focus: string };

/** At most four columns, as in irori mode: each keeps room for a page. */
export const stageColumnLimit = 4;

export const firstStage: StageSet = { columns: [{ id: '1', tabs: [] }], focus: '1' };

/** The column that holds the focus. */
export function focused(set: StageSet): StageColumn {
  return set.columns.find((column) => column.id === set.focus) ?? set.columns[0];
}

/**
 * Shows a file in a column, the focused one unless named, and gives that column
 * the focus. A file the column has not open joins its tabs after the one on show.
 */
export function place(set: StageSet, path: string, columnId = set.focus): StageSet {
  const target = set.columns.some((column) => column.id === columnId) ? columnId : focused(set).id;
  return {
    focus: target,
    columns: set.columns.map((column) => {
      if (column.id !== target) return column;
      if (column.tabs.includes(path)) return { ...column, on: path };
      const at = column.on ? column.tabs.indexOf(column.on) : -1;
      const tabs =
        at < 0
          ? [...column.tabs, path]
          : [...column.tabs.slice(0, at + 1), path, ...column.tabs.slice(at + 1)];
      return { ...column, tabs, on: path };
    }),
  };
}

/** Gives a column the focus without changing what it shows. */
export function focus(set: StageSet, columnId: string): StageSet {
  return set.columns.some((column) => column.id === columnId) ? { ...set, focus: columnId } : set;
}

/**
 * Adds a column after the focused one, showing the same file, and gives it the
 * focus; up to the limit.
 */
export function split(set: StageSet): StageSet {
  if (set.columns.length >= stageColumnLimit) return set;
  const id = String(Math.max(0, ...set.columns.map((column) => Number(column.id) || 0)) + 1);
  const from = focused(set);
  const column: StageColumn = from.on ? { id, tabs: [from.on], on: from.on } : { id, tabs: [] };
  const at = set.columns.indexOf(from);
  return {
    focus: id,
    columns: [...set.columns.slice(0, at + 1), column, ...set.columns.slice(at + 1)],
  };
}

/** The tab after a closed one, or before it when it was the last. */
function neighbour(tabs: string[], left: string[], path: string) {
  return left[Math.min(tabs.indexOf(path), left.length - 1)];
}

/** Closes a tab; a column whose file on show it was shows the tab beside it. */
export function closeTab(set: StageSet, columnId: string, path: string): StageSet {
  return {
    ...set,
    columns: set.columns.map((column) => {
      if (column.id !== columnId || !column.tabs.includes(path)) return column;
      const tabs = column.tabs.filter((tab) => tab !== path);
      return {
        ...column,
        tabs,
        on: column.on === path ? neighbour(column.tabs, tabs, path) : column.on,
      };
    }),
  };
}

/**
 * Closes a column; the last one stays. The focus, when it was there, goes to
 * the column before it, or after it when it was the first.
 */
export function closeColumn(set: StageSet, columnId: string): StageSet {
  const at = set.columns.findIndex((column) => column.id === columnId);
  if (at < 0 || set.columns.length === 1) return set;
  const columns = set.columns.filter((column) => column.id !== columnId);
  return {
    columns,
    focus: set.focus === columnId ? columns[Math.max(0, at - 1)].id : set.focus,
  };
}

/**
 * Follows renamed, moved or deleted files: `rename` gives a path's new place, or
 * undefined when it left the vault. A column whose file on show left shows the
 * tab beside it; two tabs that became one file stay one.
 */
export function follow(set: StageSet, rename: (path: string) => string | undefined): StageSet {
  return {
    ...set,
    columns: set.columns.map((column) => {
      const tabs = [...new Set(column.tabs.flatMap((tab) => rename(tab) ?? []))];
      if (!column.on) return { ...column, tabs };
      const on = rename(column.on);
      if (on) return { ...column, tabs, on };
      // The tabs before the one that left keep their places; the next one takes its place.
      const before = column.tabs
        .slice(0, column.tabs.indexOf(column.on))
        .filter((tab) => rename(tab) !== undefined).length;
      return { ...column, tabs, on: tabs[Math.min(before, tabs.length - 1)] };
    }),
  };
}

/** A move of `from` (a file or a folder) to `to`, or its deletion without `to`. */
export function moved(from: string, to?: string) {
  return (path: string) =>
    path === from || path.startsWith(`${from}/`)
      ? to === undefined
        ? undefined
        : to + path.slice(from.length)
      : path;
}
