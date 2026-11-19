import type { WorkspaceProfile } from './types';

/**
 * The workspaces open side by side, as tabs along the window's top. One is on
 * show; the others keep their agents running and their place. A workspace may be
 * open in several tabs, each with its own place (ADR 067): a tab is known by its
 * `key`, and what the workspace shares (its agents, its vaults' runs and clouds)
 * goes on while any tab, here or in another window, has it.
 */
export type WorkspaceTab = WorkspaceProfile & { key: string };

/** A workspace as a tab of its own. */
export const tabOf = (profile: WorkspaceProfile, key: string): WorkspaceTab => ({
  ...profileOf(profile),
  key,
});

/** The workspace a tab shows, without the tab's own key. */
export function profileOf(tab: WorkspaceProfile): WorkspaceProfile {
  const { key: _, ...profile } = tab as WorkspaceTab;
  return profile;
}

/** Opens a tab: one already in the strip comes on show where it is, a new one stands after `after`. */
export function openTab(tabs: WorkspaceTab[], tab: WorkspaceTab, after?: string): WorkspaceTab[] {
  if (tabs.some((item) => item.key === tab.key))
    return tabs.map((item) => (item.key === tab.key ? tab : item));
  const at = tabs.findIndex((item) => item.key === after);
  return at < 0 ? [...tabs, tab] : [...tabs.slice(0, at + 1), tab, ...tabs.slice(at + 1)];
}

/** A workspace's newer profile (renamed, its vaults or groups changed), in every tab it is open in. */
export function replaceTab(tabs: WorkspaceTab[], profile: WorkspaceProfile) {
  return tabs.map((tab) => (tab.id === profile.id ? tabOf(profile, tab.key) : tab));
}

/**
 * Closes tabs. When the one on show is among them, the nearest tab after it comes on
 * show, or else the nearest before it; `next` is undefined when no tab is left.
 */
export function closeTabs(
  tabs: WorkspaceTab[],
  keys: string[],
  shown?: string,
): { tabs: WorkspaceTab[]; next?: WorkspaceTab } {
  const closing = new Set(keys);
  const left = tabs.filter((tab) => !closing.has(tab.key));
  if (!shown || !closing.has(shown))
    return { tabs: left, next: left.find((tab) => tab.key === shown) };
  const at = tabs.findIndex((tab) => tab.key === shown);
  const after = tabs.slice(at + 1).find((tab) => !closing.has(tab.key));
  const before = tabs
    .slice(0, Math.max(at, 0))
    .reverse()
    .find((tab) => !closing.has(tab.key));
  return { tabs: left, next: after ?? before };
}

/**
 * What only the closing tabs have open: the vaults, whose runs may stop and whose
 * clouds may be let go, and the workspaces, whose irori agent conversations may stop.
 * Another tab of the same workspace keeps both.
 */
export function onlyIn(tabs: WorkspaceTab[], keys: string[]) {
  const closing = new Set(keys);
  const staying = tabs.filter((tab) => !closing.has(tab.key));
  const going = tabs.filter((tab) => closing.has(tab.key));
  const vaults = new Set(staying.flatMap((tab) => tab.scopeIds));
  const workspaces = new Set(staying.map((tab) => tab.id));
  return {
    scopeIds: [...new Set(going.flatMap((tab) => tab.scopeIds))].filter((id) => !vaults.has(id)),
    workspaces: [...new Set(going.map((tab) => tab.id))].filter((id) => !workspaces.has(id)),
  };
}

/** What the host keeps of a window's tab: the workspace and the vaults it shows. */
export type OpenTab = Pick<WorkspaceProfile, 'id' | 'scopeIds'>;

export const tabLevels = ['overview', 'routines', 'brain', 'you'] as const;
export const overviewViews = ['map', 'columns'] as const;
/** Where a tab was left, to come back to (ADR 037 D6). */
export type TabPlace = {
  level: (typeof tabLevels)[number];
  overviewView: (typeof overviewViews)[number];
  /** The vault on show. */
  scopeId?: string;
  /** The vault beside, when one was open (ADR 038). */
  side?: string;
};
/**
 * A tab dragged out of its window, on its way to a window of its own (ADR 063) or to
 * another window's tabs (ADR 064).
 */
export type MovedTab = { id: string; place?: TabPlace };

/**
 * A tab dragged along its own strip (ADR 065): it leaves its place and stands before the
 * `index`-th of the other tabs, or after them all.
 */
export function reorderTab(tabs: WorkspaceTab[], key: string, index: number) {
  const tab = tabs.find((item) => item.key === key);
  if (!tab) return tabs;
  const others = tabs.filter((item) => item.key !== key);
  const at = Math.max(0, Math.min(index, others.length));
  return [...others.slice(0, at), tab, ...others.slice(at)];
}

/**
 * A tab dropped into the strip at `index` (ADR 064). It is a tab of its own even when the
 * workspace is open here already (ADR 067).
 */
export function insertTab(tabs: WorkspaceTab[], tab: WorkspaceTab, index: number) {
  if (tabs.some((item) => item.key === tab.key)) return openTab(tabs, tab);
  const at = Math.max(0, Math.min(index, tabs.length));
  return [...tabs.slice(0, at), tab, ...tabs.slice(at)];
}

/**
 * The tabs each of irori's windows has open (ADR 051). A window closes as its tabs
 * would: what another window still has open is left running and connected.
 */
export class WindowTabs {
  private open = new Map<number, OpenTab[]>();
  set(window: number, tabs: OpenTab[]) {
    this.open.set(window, tabs);
  }
  forget(window: number) {
    this.open.delete(window);
  }
  /** Whether `window` has one tab open, of `workspace` (ADR 064). */
  onlyTab(window: number, workspace: string) {
    const tabs = this.open.get(window) ?? [];
    return tabs.length === 1 && tabs[0].id === workspace;
  }
  /** The tabs the windows other than `window` have open, each workspace once. */
  elsewhere(window: number): OpenTab[] {
    const others = new Map<string, OpenTab>();
    for (const [key, tabs] of this.open)
      if (key !== window)
        for (const tab of tabs) {
          const seen = others.get(tab.id);
          others.set(tab.id, {
            id: tab.id,
            scopeIds: [...new Set([...(seen?.scopeIds ?? []), ...tab.scopeIds])],
          });
        }
    return [...others.values()];
  }
  /** What only `window` has open: closing it may stop their runs and release their clouds. */
  only(window: number): { workspaces: string[]; scopeIds: string[] } {
    const tabs = this.open.get(window) ?? [];
    const others = this.elsewhere(window);
    const workspaces = new Set(others.map((tab) => tab.id));
    const scopeIds = new Set(others.flatMap((tab) => tab.scopeIds));
    return {
      workspaces: [...new Set(tabs.map((tab) => tab.id))].filter((id) => !workspaces.has(id)),
      scopeIds: [...new Set(tabs.flatMap((tab) => tab.scopeIds))].filter((id) => !scopeIds.has(id)),
    };
  }
}
