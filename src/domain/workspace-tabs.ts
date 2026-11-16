import type { WorkspaceProfile } from './types';

/**
 * The workspaces open side by side, as tabs along the window's top. One is on
 * show; the others keep their agents running and their place.
 */

/** Opens a workspace: an open one comes on show, a new one stands after the one on show. */
export function openTab(
  tabs: WorkspaceProfile[],
  profile: WorkspaceProfile,
  after?: string,
): WorkspaceProfile[] {
  if (tabs.some((tab) => tab.id === profile.id)) return replaceTab(tabs, profile);
  const at = tabs.findIndex((tab) => tab.id === after);
  return at < 0 ? [...tabs, profile] : [...tabs.slice(0, at + 1), profile, ...tabs.slice(at + 1)];
}

/** A workspace's newer profile (renamed, its vaults or groups changed) in its place. */
export function replaceTab(tabs: WorkspaceProfile[], profile: WorkspaceProfile) {
  return tabs.map((tab) => (tab.id === profile.id ? profile : tab));
}

/**
 * Closes a tab. When it was on show, the one after it comes on show, or the one
 * before when it was the last; `next` is undefined when no tab is left.
 */
export function closeTab(
  tabs: WorkspaceProfile[],
  id: string,
  shown?: string,
): { tabs: WorkspaceProfile[]; next?: WorkspaceProfile } {
  const at = tabs.findIndex((tab) => tab.id === id);
  if (at < 0) return { tabs, next: tabs.find((tab) => tab.id === shown) };
  const left = tabs.filter((tab) => tab.id !== id);
  if (shown !== id) return { tabs: left, next: left.find((tab) => tab.id === shown) };
  return { tabs: left, next: left[Math.min(at, left.length - 1)] };
}

/** The vaults only this tab has open: closing it may stop their runs and release their clouds. */
export function onlyIn(tabs: WorkspaceProfile[], id: string): string[] {
  const tab = tabs.find((item) => item.id === id);
  if (!tab) return [];
  const elsewhere = new Set(tabs.filter((item) => item.id !== id).flatMap((item) => item.scopeIds));
  return tab.scopeIds.filter((scopeId) => !elsewhere.has(scopeId));
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
 * A workspace dropped into the tabs at `index` (ADR 064); one already open keeps its
 * place and takes the newer profile.
 */
export function insertTab(tabs: WorkspaceProfile[], profile: WorkspaceProfile, index: number) {
  if (tabs.some((tab) => tab.id === profile.id)) return replaceTab(tabs, profile);
  const at = Math.max(0, Math.min(index, tabs.length));
  return [...tabs.slice(0, at), profile, ...tabs.slice(at)];
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
  /** Whether `workspace` is the one tab `window` has open (ADR 064). */
  onlyTab(window: number, workspace: string) {
    const tabs = this.open.get(window) ?? [];
    return tabs.length > 0 && tabs.every((tab) => tab.id === workspace);
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
