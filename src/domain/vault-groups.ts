import type { VaultGroup } from './types';

/**
 * A workspace's groups kept to its vaults: each vault is in at most one
 * group, members follow the workspace's order, and an empty group is dropped.
 */
export function normalizeGroups(groups: VaultGroup[], scopeIds: string[]): VaultGroup[] {
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

export type RailItem = { kind: 'vault'; scopeId: string } | { kind: 'group'; group: VaultGroup };

/** The rail in the workspace's order; a group stands where its first vault would. */
export function railItems(scopeIds: string[], groups: VaultGroup[] = []): RailItem[] {
  const kept = normalizeGroups(groups, scopeIds),
    placed = new Set<string>();
  return scopeIds.flatMap((scopeId): RailItem[] => {
    const group = kept.find((item) => item.scopeIds.includes(scopeId));
    if (!group) return [{ kind: 'vault', scopeId }];
    if (placed.has(group.id)) return [];
    placed.add(group.id);
    return [{ kind: 'group', group }];
  });
}

const without = (groups: VaultGroup[], scopeId: string) =>
  groups
    .map((group) => ({ ...group, scopeIds: group.scopeIds.filter((id) => id !== scopeId) }))
    .filter((group) => group.scopeIds.length);

/** A new open group holding only this vault. */
export function startGroup(groups: VaultGroup[], scopeId: string, name: string, id: string) {
  return [...without(groups, scopeId), { id, name: name.trim(), scopeIds: [scopeId], open: true }];
}

/** Moves a vault into a group, out of any other. */
export function joinGroup(groups: VaultGroup[], scopeId: string, groupId: string) {
  return without(groups, scopeId).map((group) =>
    group.id === groupId ? { ...group, scopeIds: [...group.scopeIds, scopeId] } : group,
  );
}

export function leaveGroup(groups: VaultGroup[], scopeId: string) {
  return without(groups, scopeId);
}

export function renameGroup(groups: VaultGroup[], groupId: string, name: string) {
  return groups.map((group) => (group.id === groupId ? { ...group, name: name.trim() } : group));
}

export function toggleGroup(groups: VaultGroup[], groupId: string) {
  return groups.map((group) => (group.id === groupId ? { ...group, open: !group.open } : group));
}

/** Lets the group's vaults stand on their own again. */
export function ungroup(groups: VaultGroup[], groupId: string) {
  return groups.filter((group) => group.id !== groupId);
}
