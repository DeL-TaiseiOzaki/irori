/**
 * How often each vault's files changed, as the window counts it: a change in
 * one vault reaches the views of that vault alone, so the others keep what
 * they read. `all` counts the changes that may have reached every vault.
 */
export interface ScopeRevisions {
  all: number;
  scopes: Record<string, number>;
}

export const noRevisions: ScopeRevisions = { all: 0, scopes: {} };

/** One more change in a vault, or in every one of them when none is named. */
export function bumpRevision(revisions: ScopeRevisions, scopeId?: string): ScopeRevisions {
  if (!scopeId) return { ...revisions, all: revisions.all + 1 };
  return {
    ...revisions,
    scopes: { ...revisions.scopes, [scopeId]: (revisions.scopes[scopeId] ?? 0) + 1 },
  };
}

/** The count a view of one vault follows; without a vault, the count of changes everywhere. */
export function scopeRevision(revisions: ScopeRevisions, scopeId?: string) {
  return revisions.all + (scopeId ? (revisions.scopes[scopeId] ?? 0) : 0);
}

/** The count a view of every vault at once follows. */
export function anyRevision(revisions: ScopeRevisions) {
  return Object.values(revisions.scopes).reduce((sum, count) => sum + count, revisions.all);
}
