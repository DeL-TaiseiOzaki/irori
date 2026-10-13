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
