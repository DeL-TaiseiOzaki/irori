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
  /** What a completed operation could not also do, such as carry the authorship notes. */
  notice?: string;
  /** The hibachi is an ordinary folder that `gitInit` can make a repository. */
  initializable?: boolean;
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
export interface CloneResult {
  path: string;
  notice?: string;
}
/** A new hibachi made here: an empty folder that becomes a Git repository and a KB. */
export interface CreateSpace {
  parent: string;
  /** The new folder's name. */
  folder: string;
  name: string;
  category: import('./types').Category;
}
export interface CreatedSpace {
  space: import('./types').Space;
  /** What creation could not also do, such as the first commit. */
  notice?: string;
}
/** The GitHub account the GitHub CLI is signed in to, and the organizations it can see. */
export interface GitHubAccount {
  login: string;
  organizations: string[];
}
export type GitHubVisibility = 'private' | 'public';
export interface PublishRepository {
  owner: string;
  name: string;
  visibility: GitHubVisibility;
  description?: string;
}
/** GitHub's rules for an account or organization name. */
export const githubOwnerPattern = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
/** GitHub's rules for a repository name, which also rules out `.`, `..` and a `.git` suffix. */
export function validRepositoryName(name: string) {
  return (
    /^[A-Za-z0-9._-]{1,100}$/.test(name) && name !== '.' && name !== '..' && !/\.git$/i.test(name)
  );
}
/** A repository name suggested from a folder or hibachi name; empty when nothing usable is left. */
export function suggestRepositoryName(from: string) {
  const name = from
    .normalize('NFKC')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .replace(/\.git$/i, '')
    .slice(0, 100);
  return validRepositoryName(name) ? name : '';
}
