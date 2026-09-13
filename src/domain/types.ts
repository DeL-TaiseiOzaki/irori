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
}
export interface AddCloudAttachment {
  scopeId: string;
  accountId: string;
  folder: CloudFolder;
  contentsRoot: string;
  name: string;
}
export type HostEvent = { type: 'files'; scopeId: string } | { type: 'agent'; event: AgentEvent };
export interface StartRun {
  scopeId: string;
  agent: AgentId;
  prompt: string;
  notePath?: string;
  newSession?: boolean;
}
export interface HostAPI {
  repositories(root: string): Promise<RepositoryInfo>;
  workspaces(): Promise<WorkspaceProfile[]>;
  saveWorkspace(name: string, scopeIds: string[], id?: string): Promise<WorkspaceProfile>;
  removeWorkspace(id: string): Promise<void>;
  cloudSetup(): Promise<CloudSetup>;
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
  save(doc: Document): Promise<Document>;
  draft(doc: Document): Promise<void>;
  createNote(scopeId: string, name: string): Promise<Document>;
  openExternal(scopeId: string, path: string): Promise<void>;
  agents(): Promise<AgentInfo[]>;
  agentSession(scopeId: string, agent: AgentId): Promise<AgentSession>;
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
