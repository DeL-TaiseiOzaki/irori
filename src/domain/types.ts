export const agentIds = ['codex', 'claude', 'opencode', 'pi'] as const;
export type AgentId = (typeof agentIds)[number];
export const agentNames: Record<AgentId, string> = {
  codex: 'Codex',
  claude: 'Claude Code',
  opencode: 'OpenCode',
  pi: 'Pi',
};
export type Category = 'personal' | 'team' | 'organization';
export type Layer = 'schema' | 'Knowledge_Base' | 'contents';
export interface ScopeDeclaration {
  schemaVersion: 1;
  scopeId: string;
  name: string;
  category: Category;
  contents: string[];
}
export interface Space extends ScopeDeclaration {
  root: string;
}
export interface Entry {
  path: string;
  name: string;
  directory: boolean;
  layer: Layer;
  note: boolean;
  blocked?: string;
}
export interface Document {
  scopeId: string;
  path: string;
  text: string;
  hash: string;
  readOnly?: boolean;
  workspaceId?: string;
  draft?: { text: string; baseHash: string };
}
export interface Question {
  id: string;
  title: string;
  options?: string[];
  multiple?: boolean;
}
export type AgentAnswers = Record<string, string | string[]>;
export interface AgentEvent {
  scopeId?: string;
  agent?: AgentId;
  role?: 'user';
  runId: string;
  type: 'status' | 'text' | 'tool' | 'permission' | 'question' | 'error' | 'done';
  text: string;
  requestId?: string;
  questions?: Question[];
  details?: string;
  outcome?: 'completed' | 'failed' | 'cancelled';
}
export interface AgentInfo {
  id: AgentId;
  version: string;
  available: boolean;
  tested: boolean;
  detail: string;
}
export interface AgentSession {
  state: 'empty' | 'saved' | 'unavailable';
  updatedAt?: string;
  detail?: string;
}
export interface RepositoryInfo {
  root: string;
  kind: 'github' | 'git' | 'folder' | 'unavailable';
  repository?: string;
  branch?: string;
  changed?: boolean;
  detail?: string;
}
export interface WorkspaceProfile {
  id: string;
  name: string;
  scopeIds: string[];
}
export interface CloudRoot {
  scopeId: string;
  name: string;
  root: string;
  contents: string[];
  workspace?: boolean;
}
export interface CloudAccount {
  id: string;
  name: string;
  provider: 'google-drive';
  state: 'authorizing' | 'ready' | 'incomplete';
  detail?: string;
}
export interface CloudFolder {
  id: string;
  name: string;
  parentId?: string;
  driveId?: string;
}
export interface CloudAttachment {
  schemaVersion: 1;
  mountId: string;
  scopeId: string;
  provider: 'google-drive';
  folderId: string;
  parentId: string;
  driveId?: string;
  folderName: string;
  contentsRoot: string;
  name: string;
  access: 'read-only';
}
export interface CloudConnection extends CloudAttachment {
  accountName?: string;
  state: 'unconfigured' | 'disconnected' | 'connecting' | 'mounted' | 'error';
  detail?: string;
}
export interface CloudSetup {
  available: boolean;
  version?: string;
  oauthConfigured: boolean;
  mountAvailable: boolean;
  detail: string;
  prerequisite?: 'winfsp' | 'fuse';
}
export interface AddCloudAttachment {
  scopeId: string;
  accountId: string;
  folder: CloudFolder;
  contentsRoot: string;
  name: string;
}
export interface TerminalShell {
  id: string;
  name: string;
}
export interface TerminalSession {
  id: string;
  scopeId: string;
  shell: TerminalShell;
  cwd: string;
}
export type TerminalEvent =
  { id: string; type: 'data'; data: string } | { id: string; type: 'exit'; code: number };
export type HostEvent =
  | { type: 'files'; scopeId: string }
  | { type: 'agent'; event: AgentEvent }
  | { type: 'terminal'; event: TerminalEvent };
export interface StartRun {
  scopeId: string;
  agent: AgentId;
  prompt: string;
  notePath?: string;
  newSession?: boolean;
  sources?: import('./knowledge').SourceRef[];
}
export interface HostAPI {
  knowledgeHistory(scopeId: string): Promise<import('./knowledge').KnowledgeHistory>;
  restoreSource(source: import('./knowledge').SourceVersion): Promise<void>;
  sourceText(source: import('./knowledge').SourceVersion): Promise<string>;
  registerArtifact(
    source: import('./knowledge').SourceRef,
    runId: string,
  ): Promise<import('./knowledge').ArtifactRecord>;
  pendingCloudWrites(ownerId: string): Promise<import('./knowledge').PendingWrite[]>;
  prepareCloudWrite(
    ownerId: string,
    mountId: string,
    source: import('./knowledge').SourceRef,
  ): Promise<import('./knowledge').PendingWrite>;
  terminalShells(): Promise<TerminalShell[]>;
  openTerminal(
    scopeId: string,
    shellId: string,
    cols: number,
    rows: number,
  ): Promise<TerminalSession>;
  writeTerminal(id: string, data: string): Promise<void>;
  resizeTerminal(id: string, cols: number, rows: number): Promise<void>;
  acknowledgeTerminal(id: string, length: number): Promise<void>;
  closeTerminal(id: string): Promise<void>;
  gitStatus(scopeId: string): Promise<GitStatus>;
  gitDiff(scopeId: string, path: string, staged: boolean): Promise<GitDiff>;
  gitHistory(scopeId: string, offset: number): Promise<GitHistory>;
  gitCommitDiff(scopeId: string, oid: string): Promise<string>;
  gitStage(scopeId: string, path: string, staged: boolean, version: string): Promise<GitStatus>;
  gitStageMany(
    scopeId: string,
    paths: string[],
    staged: boolean,
    version: string,
  ): Promise<GitStatus>;
  gitCommit(scopeId: string, message: string, version: string): Promise<GitStatus>;
  gitSync(scopeId: string, action: GitSyncAction, version: string): Promise<GitStatus>;
  gitConflict(scopeId: string, path: string): Promise<GitConflict>;
  gitResolve(
    scopeId: string,
    path: string,
    text: string | null,
    version: string,
  ): Promise<GitStatus>;
  gitClone(input: CloneRepository): Promise<string>;
  gitOpenRepository(scopeId: string): Promise<void>;
  repositories(root: string): Promise<RepositoryInfo>;
  workspaces(): Promise<WorkspaceProfile[]>;
  saveWorkspace(name: string, scopeIds: string[], id?: string): Promise<WorkspaceProfile>;
  removeWorkspace(id: string): Promise<void>;
  cloudSetup(): Promise<CloudSetup>;
  openCloudSetupHelp(): Promise<void>;
  workspaceCloud(id: string): Promise<CloudRoot>;
  cloudEntries(id: string, path: string): Promise<Entry[]>;
  cloudRead(id: string, path: string): Promise<Document>;
  openCloudFile(id: string, path: string): Promise<void>;
  cloudAccounts(): Promise<CloudAccount[]>;
  addCloudAccount(name: string): Promise<CloudAccount>;
  cancelCloudAccount(id: string): Promise<void>;
  removeCloudAccount(id: string): Promise<void>;
  cloudDrives(accountId: string): Promise<CloudFolder[]>;
  cloudFolders(accountId: string, folderId: string, driveId?: string): Promise<CloudFolder[]>;
  cloudConnections(scopeId: string): Promise<CloudConnection[]>;
  addCloudAttachment(input: AddCloudAttachment): Promise<CloudConnection>;
  connectCloud(scopeId: string, mountId: string): Promise<void>;
  disconnectCloud(scopeId: string, mountId: string): Promise<void>;
  bindCloud(scopeId: string, mountId: string, accountId: string): Promise<void>;
  renameCloud(scopeId: string, mountId: string, name: string): Promise<void>;
  removeCloud(scopeId: string, mountId: string): Promise<void>;
  spaces(): Promise<Space[]>;
  chooseFolder(): Promise<string | null>;
  register(root: string, name: string, category: Category): Promise<Space>;
  entries(scopeId: string, directory: string): Promise<Entry[]>;
  read(scopeId: string, path: string): Promise<Document>;
  ontology(scopeId: string): Promise<import('./ontology').OntologyView | null>;
  saveImage(scopeId: string, note: string, bytes: Uint8Array): Promise<string>;
  readImage(scopeId: string, note: string, url: string): Promise<string>;
  save(doc: Document): Promise<Document>;
  draft(doc: Document): Promise<void>;
  createNote(scopeId: string, name: string): Promise<Document>;
  openExternal(scopeId: string, path: string): Promise<void>;
  agents(): Promise<AgentInfo[]>;
  agentSession(scopeId: string, agent: AgentId): Promise<AgentSession>;
  agentConversation(
    scopeId: string,
    agent: AgentId,
  ): Promise<import('./conversation').Conversation>;
  queueAgentMessage(input: StartRun): Promise<import('./conversation').QueuedMessage[]>;
  removeQueuedMessage(
    scopeId: string,
    agent: AgentId,
    id: string,
  ): Promise<import('./conversation').QueuedMessage[]>;
  startQueuedMessage(scopeId: string, agent: AgentId, id: string): Promise<string>;
  resetAgentSession(scopeId: string, agent: AgentId): Promise<void>;
  start(input: StartRun): Promise<string>;
  cancel(): Promise<void>;
  respond(requestId: string, allow: boolean, answers?: AgentAnswers): Promise<void>;
  onEvent(callback: (event: HostEvent) => void): () => void;
}
declare global {
  interface Window {
    irori: HostAPI;
    iroriFlushDraft?: () => Promise<void>;
  }
}
import type {
  GitStatus,
  GitDiff,
  GitHistory,
  GitConflict,
  GitSyncAction,
  CloneRepository,
} from './git';
