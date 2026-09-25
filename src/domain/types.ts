export const agentIds = ['codex', 'claude', 'opencode', 'pi'] as const;
export type AgentId = (typeof agentIds)[number];
export const agentAccessModes = ['default', 'full-access'] as const;
export type AgentAccess = (typeof agentAccessModes)[number];
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
  /** personal / team / organization; a brain may carry none (ADR 014). */
  category?: Category;
  contents: string[];
  /** The brain's tile as everyone who opens the KB sees it. */
  appearance?: import('./brains').BrainLook;
}
/** What the brain settings change in `.irori/scope.json`; `null` removes a field. */
export interface SpaceChange {
  name?: string;
  category?: Category | null;
  appearance?: import('./brains').BrainLook | null;
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
  /**
   * Inside an editable Drive connection: the entry can be renamed, moved and
   * deleted, and a folder can take a new note.
   */
  writable?: boolean;
  /**
   * The folder a Drive connection is mounted on. Its name and registration belong
   * to the connection dialog, so it is never renamed, moved or deleted as an entry.
   */
  connection?: boolean;
}
export interface Document {
  scopeId: string;
  path: string;
  text: string;
  hash: string;
  readOnly?: boolean;
  workspaceId?: string;
  /** The file is inside a Google Drive connection rather than in the KB's own files. */
  cloud?: boolean;
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
  access?: AgentAccess;
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
  /** Signed in with permission to change Drive files. Accounts added before 0.1.35 may read only. */
  writable?: boolean;
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
  access: CloudAccess;
}
export type CloudAccess = 'read-only' | 'read-write';
export interface CloudConnection extends CloudAttachment {
  accountName?: string;
  /** The bound account may change Drive files; without it an editable connection mounts read-only. */
  accountWritable?: boolean;
  state: 'unconfigured' | 'disconnected' | 'connecting' | 'mounted' | 'error';
  detail?: string;
  /** Mounted so that files can be changed. */
  writable?: boolean;
  /** Saved changes still waiting to reach Google Drive. */
  pending?: number;
  /** Why saved changes are not reaching Google Drive, in the interface language. */
  uploadError?: string;
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
  access?: CloudAccess;
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
  | { type: 'terminal'; event: TerminalEvent }
  | { type: 'update'; state: import('./updates').UpdateState };
export interface StartRun {
  scopeId: string;
  agent: AgentId;
  /** Native permission policy for this instruction; omitted inputs keep the standard policy. */
  access?: AgentAccess;
  prompt: string;
  notePath?: string;
  newSession?: boolean;
  sources?: import('./knowledge').SourceRef[];
  /** Name of a skill package this KB declares, prepended to the request. */
  skill?: string;
  /** Tell the agent which lines of the note the person wrote or revised. */
  personLines?: boolean;
}
export const markdownFonts = ['system', 'sans', 'rounded', 'serif', 'textbook', 'mono'] as const;
export type MarkdownFont = (typeof markdownFonts)[number];
/** Hearth is graphite chrome with a paper stage; system picks hearth or dark with the desktop. */
export const themes = ['system', 'hearth', 'light', 'dark'] as const;
export type Theme = (typeof themes)[number];
/** What the operating system is told: its window frame sits beside the rail's graphite. */
export function nativeThemeSource(theme: Theme): 'system' | 'light' | 'dark' {
  return theme === 'hearth' ? 'dark' : theme;
}
export interface DeviceSettings {
  theme: Theme;
  /** The interface language; Japanese unless the reader chose otherwise. */
  language: import('./i18n').Language;
  markdownFont: MarkdownFont;
  /** Show code assistance in source editors and Markdown code blocks. */
  editorAssistance: boolean;
  /** Pane layouts per group, kept here because file-URL storage is not durable. */
  layouts: Record<string, string>;
  /** The reader's role and project per KB, which narrows that KB's skill picker. */
  skillAudiences: Record<string, import('./skills').SkillAudience>;
}

export interface HostAPI {
  recoverableCloudWrites(): Promise<import('./knowledge').CloudWriteRecovery>;
  draftRead(key: import('./drafts').DraftKey): Promise<import('./drafts').DraftRecord | null>;
  draftWrite(
    key: import('./drafts').DraftKey,
    value: import('./drafts').DraftValue,
    expectedRevision: string | null,
  ): Promise<import('./drafts').DraftRecord>;
  checkForUpdates(): Promise<import('./updates').UpdateCheck>;
  openUpdatePage(target: import('./updates').UpdateTarget): Promise<void>;
  /** The latest check and the progress of applying an update. Makes no request. */
  updateState(): Promise<import('./updates').UpdateState>;
  /** Downloads, verifies and stages the version the latest check offered; false when cancelled or failed. */
  installUpdate(): Promise<boolean>;
  cancelUpdate(): Promise<void>;
  /** Closes irori as the window would and starts the staged version; false when the person stays. */
  restartToUpdate(): Promise<boolean>;
  /** Moves a note; with `links`, rewrites its own links and those leading to it. */
  moveNote(
    ref: import('./note-operations').NoteRef,
    destination: string,
    links: boolean,
  ): Promise<Document & { notice?: string; links?: import('./note-links').LinkUpdate }>;
  /** How many links, in how many other notes, lead to `path` and would be rewritten by a move. */
  referringLinks(
    scopeId: string,
    path: string,
  ): Promise<Pick<import('./note-links').LinkUpdate, 'notes' | 'links' | 'incomplete'>>;
  trashNote(
    ref: import('./note-operations').NoteRef,
  ): Promise<import('./note-operations').TrashedNote>;
  trashedNotes(scopeId: string): Promise<import('./note-operations').TrashedNote[]>;
  restoreNote(scopeId: string, trashId: string): Promise<Document & { notice?: string }>;
  search(scopeId: string, query: string): Promise<import('./search').KnowledgeSearch>;
  /** The lines of other notes in this KB whose links resolve to `path`. */
  backlinks(scopeId: string, path: string): Promise<import('./search').KnowledgeSearch>;
  /** Where a link written in the note at `from` points, and whether it is there. */
  resolveLink(
    scopeId: string,
    from: string,
    href: string,
  ): Promise<import('./note-links').ResolvedLink>;
  knowledgeHistory(scopeId: string): Promise<import('./knowledge').KnowledgeHistory>;
  restoreSource(source: import('./knowledge').SourceVersion): Promise<void>;
  sourceText(source: import('./knowledge').SourceVersion): Promise<string>;
  locateSource(
    source: import('./knowledge').SourceVersion,
  ): Promise<import('./knowledge').SourceLocation>;
  rebindSource(
    source: import('./knowledge').SourceVersion,
    next: import('./knowledge').SourceRef,
  ): Promise<void>;
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
  gitClone(input: CloneRepository): Promise<import('./git').CloneResult>;
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
  /** Signs the account in again, now with permission to change Drive files. */
  reauthorizeCloudAccount(id: string): Promise<void>;
  removeCloudAccount(id: string): Promise<void>;
  cloudDrives(accountId: string): Promise<CloudFolder[]>;
  cloudFolders(accountId: string, folderId: string, driveId?: string): Promise<CloudFolder[]>;
  cloudConnections(scopeId: string): Promise<CloudConnection[]>;
  addCloudAttachment(input: AddCloudAttachment): Promise<CloudConnection>;
  connectCloud(scopeId: string, mountId: string): Promise<void>;
  /** `leavePending` disconnects although saved changes wait; they upload on the next editable mount. */
  disconnectCloud(scopeId: string, mountId: string, leavePending?: boolean): Promise<void>;
  bindCloud(scopeId: string, mountId: string, accountId: string): Promise<void>;
  renameCloud(scopeId: string, mountId: string, name: string): Promise<void>;
  removeCloud(scopeId: string, mountId: string): Promise<void>;
  /** Whether the connection may change its Drive folder; a connected folder is remounted. */
  setCloudAccess(
    scopeId: string,
    mountId: string,
    access: CloudAccess,
    leavePending?: boolean,
  ): Promise<void>;
  /**
   * Moves a workspace's Drive connection from before 0.1.37 into a KB's materials.
   * `duplicate` is true when the KB already connected that folder and the
   * workspace's connection was only unregistered.
   */
  moveCloudConnection(
    fromScopeId: string,
    mountId: string,
    toScopeId: string,
  ): Promise<{ duplicate: boolean }>;
  /** Shows the connected folder in the system file manager, for adding files there. */
  openCloudFolder(scopeId: string, mountId: string): Promise<void>;
  /** Creates an empty Markdown note in an editable Drive folder and returns it. */
  createCloudNote(scopeId: string, directory: string, name: string): Promise<Document>;
  /**
   * Renames or moves a file or folder inside one editable Drive connection. `to` is
   * the full new path; an existing entry is never replaced. Returns the moved entry.
   */
  moveCloudEntry(scopeId: string, from: string, to: string): Promise<Entry>;
  /** Moves a file or folder of an editable Drive connection to Google Drive's trash. */
  deleteCloudEntry(scopeId: string, path: string): Promise<void>;
  spaces(): Promise<Space[]>;
  chooseFolder(): Promise<string | null>;
  register(root: string, name: string, category: Category): Promise<Space>;
  /** Changes a brain's name, category or look in its `.irori/scope.json`. */
  updateSpace(scopeId: string, change: SpaceChange): Promise<Space>;
  /** Keeps an image in the brain's `.irori/` as its icon and returns its path. */
  saveSpaceIcon(scopeId: string, bytes: Uint8Array): Promise<string>;
  entries(scopeId: string, directory: string): Promise<Entry[]>;
  read(scopeId: string, path: string): Promise<Document>;
  ontology(scopeId: string): Promise<import('./ontology').OntologyView | null>;
  /** Whether the graph index the KB carries matches its pages now, and what an update would change. Writes nothing. */
  graphIndexStatus(scopeId: string): Promise<import('./graph-index').GraphIndexStatus>;
  /** Generates the graph index from the pages and writes the module files whose bytes change. */
  updateGraphIndex(scopeId: string): Promise<import('./graph-index').GraphIndexUpdate>;
  /** Who typed each line of this text, resolved against the record on this device. */
  noteAuthorship(
    scopeId: string,
    path: string,
    text: string,
  ): Promise<import('./knowledge').NoteAuthorship>;
  /** Skill packages this KB declares in `.agents/skills/`, and the ones it retired. */
  skills(scopeId: string): Promise<import('./skills').SkillListing>;
  /** Which user-scope skill directories hold a same-named skill, per declared name. */
  skillReach(scopeId: string): Promise<import('./skill-reach').SkillReach>;
  saveImage(scopeId: string, note: string, bytes: Uint8Array): Promise<string>;
  readImage(scopeId: string, note: string, url: string): Promise<string>;
  save(doc: Document): Promise<Document>;
  draft(doc: Document): Promise<void>;
  createNote(scopeId: string, name: string, directory?: string): Promise<Document>;
  /** Where this KB asks new notes and today's note to go (`.irori/notes.json`), or null. */
  notesDeclaration(scopeId: string): Promise<import('./notes').NotesDeclaration | null>;
  /** Opens today's note at the declared path, creating it from the template on first use. */
  dailyNote(scopeId: string): Promise<Document>;
  openExternal(scopeId: string, path: string): Promise<void>;
  /** Opens an http or https address from agent output in the user's browser. */
  openUrl(url: string): Promise<void>;
  deviceSettings(): Promise<DeviceSettings>;
  saveDeviceSettings(patch: Partial<DeviceSettings>): Promise<DeviceSettings>;
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
  /** Stops the run in one space, or every run when no space is named. */
  cancel(scopeId?: string): Promise<void>;
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
