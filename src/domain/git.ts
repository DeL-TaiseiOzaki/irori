export interface GitChange {
  path: string;
  index: string;
  worktree: string;
  conflict: boolean;
  blocked?: string;
}
export interface GitRemote {
  name: string;
  label: string;
  fetchLabel: string;
  repository?: string;
  branch: string;
  tracking?: string;
}
export interface GitStatus {
  available: boolean;
  detail?: string;
  branch?: string;
  head?: string;
  remote?: GitRemote;
  ahead?: number;
  behind?: number;
  operation: 'none' | 'merge' | 'other';
  changes: GitChange[];
  version: string;
  fetchedAt?: string;
}
export interface GitDiff {
  path: string;
  patch: string;
  version: string;
}
export interface GitCommit {
  oid: string;
  author: string;
  date: string;
  subject: string;
}
export interface GitHistory {
  commits: GitCommit[];
  more: boolean;
}
export interface GitConflict {
  path: string;
  base?: string;
  ours?: string;
  theirs?: string;
  working?: string;
  version: string;
  editable: boolean;
  detail?: string;
}
export type GitSyncAction = 'fetch' | 'pull' | 'merge' | 'push';
export interface CloneRepository {
  url: string;
  parent: string;
  name: string;
}
