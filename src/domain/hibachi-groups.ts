import type { HibachiGroup } from './types';

/**
 * A workspace's groups kept to its hibachis: each hibachi is in at most one
 * group, members follow the workspace's order, and an empty group is dropped.
 */
export function normalizeGroups(groups: HibachiGroup[], scopeIds: string[]): HibachiGroup[] {
  const taken = new Set<string>(),
    ids = new Set<string>();
  return groups.flatMap((group) => {
    if (ids.has(group.id)) return [];
    const members = scopeIds.filter(
      (scopeId) => group.scopeIds.includes(scopeId) && !taken.has(scopeId),
    );
    if (!members.length) return [];
    ids.add(group.id);
    members.forEach((scopeId) => taken.add(scopeId));
    return [{ id: group.id, name: group.name.trim(), scopeIds: members, open: group.open }];
  });
}

export type RailItem =
  { kind: 'hibachi'; scopeId: string } | { kind: 'group'; group: HibachiGroup };

/** The rail in the workspace's order; a group stands where its first hibachi would. */
export function railItems(scopeIds: string[], groups: HibachiGroup[] = []): RailItem[] {
  const kept = normalizeGroups(groups, scopeIds),
    placed = new Set<string>();
  return scopeIds.flatMap((scopeId): RailItem[] => {
    const group = kept.find((item) => item.scopeIds.includes(scopeId));
    if (!group) return [{ kind: 'hibachi', scopeId }];
    if (placed.has(group.id)) return [];
    placed.add(group.id);
    return [{ kind: 'group', group }];
  });
}

const without = (groups: HibachiGroup[], scopeId: string) =>
  groups
    .map((group) => ({ ...group, scopeIds: group.scopeIds.filter((id) => id !== scopeId) }))
    .filter((group) => group.scopeIds.length);

/** A new open group holding only this hibachi. */
export function startGroup(groups: HibachiGroup[], scopeId: string, name: string, id: string) {
  return [...without(groups, scopeId), { id, name: name.trim(), scopeIds: [scopeId], open: true }];
}

/** Moves a hibachi into a group, out of any other. */
export function joinGroup(groups: HibachiGroup[], scopeId: string, groupId: string) {
  return without(groups, scopeId).map((group) =>
    group.id === groupId ? { ...group, scopeIds: [...group.scopeIds, scopeId] } : group,
  );
}

export function leaveGroup(groups: HibachiGroup[], scopeId: string) {
  return without(groups, scopeId);
}

export function renameGroup(groups: HibachiGroup[], groupId: string, name: string) {
  return groups.map((group) => (group.id === groupId ? { ...group, name: name.trim() } : group));
}

export function toggleGroup(groups: HibachiGroup[], groupId: string) {
  return groups.map((group) => (group.id === groupId ? { ...group, open: !group.open } : group));
}

/** Lets the group's hibachis stand on their own again. */
export function ungroup(groups: HibachiGroup[], groupId: string) {
  return groups.filter((group) => group.id !== groupId);
}
