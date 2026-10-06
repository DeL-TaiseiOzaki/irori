export const agentIds = ['codex', 'claude', 'opencode', 'pi', 'hermes'] as const;
export type AgentId = (typeof agentIds)[number];
export const agentAccessModes = ['default', 'full-access'] as const;
export type AgentAccess = (typeof agentAccessModes)[number];
export const agentNames: Record<AgentId, string> = {
  codex: 'Codex',
  claude: 'Claude Code',
  opencode: 'OpenCode',
  pi: 'Pi',
  hermes: 'Hermes Agent',
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
  /** The knowledge folder when it is not `Knowledge_Base` (ADR 024). */
  knowledge?: string;
  /** The names the Knowledge and Contents layers are shown under (ADR 024). */
  labels?: Partial<Record<import('./layers').NamedLayer, string>>;
  /** The brain's tile as everyone who opens the KB sees it. */
  appearance?: import('./brains').BrainLook;
}
/** What the brain settings change in `.irori/scope.json`; `null` removes a field. */
export interface SpaceChange {
  name?: string;
  category?: Category | null;
  appearance?: import('./brains').BrainLook | null;
  /** Each layer's shown name; an empty or `null` one returns to irori's. */
  labels?: Partial<Record<import('./layers').NamedLayer, string | null>> | null;
}
/** What a layer folder rename did, and what it could not carry over. */
export interface LayerFolderRename {
  space: Space;
  previous: string;
  /** Links rewritten, and in how many files. */
  links: number;
  notes: number;
  /** Files whose links could not be rewritten: changed meanwhile, unsaved, or unreadable. */
  skipped: string[];
  notice?: string;
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
   * Inside an editable connected folder: the entry can be renamed, moved and
   * deleted, and a folder can take a new note.
   */
  writable?: boolean;
  /**
   * The place a connected folder appears in contents. Its name and registration
   * belong to the connection dialog, so it is never renamed, moved or deleted as an entry.
   */
  connection?: boolean;
  /** The connection is a folder on this device (every connection since 0.1.67). */
  local?: boolean;
}
export interface Document {
  scopeId: string;
  path: string;
  text: string;
  hash: string;
  readOnly?: boolean;
  /** The file is inside a connected folder in contents rather than in the KB's own files. */
  cloud?: boolean;
  draft?: { text: string; baseHash: string };
  /** Shown by a viewer rather than edited: `text` is empty and the bytes come from `viewerBytes`. */
  viewer?: import('./viewers').ViewerKind;
}
export interface Question {
  id: string;
  title: string;
  options?: string[];
  multiple?: boolean;
}
export type AgentAnswers = Record<string, string | string[]>;
/**
 * Work your AI handed to a brain's sub-agent: which brain, which hand-off (the
 * delegation's tool call), and how far it is.
 */
export interface Delegate {
  scopeId: string;
  task: string;
  state: 'started' | 'working' | 'reported' | 'failed';
}
export interface AgentEvent {
  /** Stable across the view and the saved conversation; a streamed reply keeps one. */
  id?: string;
  /** The conversation the run belongs to (ADR 017). */
  conversationId?: string;
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
  /** Set on your AI's events that belong to a brain's sub-agent. */
  delegate?: Delegate;
  /** The tool call a `tool` event starts or reports on, as the CLI names it. */
  call?: string;
  /** A tool event carrying the call's result rather than the call. */
  result?: boolean;
  /** Bytes the saved `details` had before being kept to their first 1 MiB. */
  cut?: number;
  /**
   * The request this event ends — answered, declined or cancelled — so every
   * view stops offering it. Such an event is shown nowhere and never saved.
   */
  resolved?: string;
}
export interface AgentInfo {
  id: AgentId;
  version: string;
  available: boolean;
  tested: boolean;
  detail: string;
}
/** A model the installed CLI offers, as it names it. */
export interface AgentModel {
  /** What is passed to the CLI. */
  id: string;
  label: string;
  /** The CLI's own default. */
  default?: boolean;
}
export interface AgentModels {
  models: AgentModel[];
  /** A model name may be typed in: the CLI gives no list, or reading it failed. */
  custom: boolean;
  /** Why the list could not be read. */
  error?: string;
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
/** Hibachis gathered under a name in the rail; a closed group shows as one folder. */
export interface HibachiGroup {
  id: string;
  name: string;
  scopeIds: string[];
  open: boolean;
}
export interface WorkspaceProfile {
  id: string;
  name: string;
  scopeIds: string[];
  groups?: HibachiGroup[];
}
export interface CloudRoot {
  scopeId: string;
  name: string;
  root: string;
  contents: string[];
}
/**
 * A Google Drive folder irori connected itself before 0.1.67. Kept in a hibachi's
 * `.irori/cloud-mounts.json`, it is listed as retired until it is switched to a
 * folder on this computer or unregistered (ADR 023).
 */
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
/**
 * A folder on this device, such as one a Drive, Dropbox, Box, iCloud or OneDrive
 * app keeps in sync, shown in contents through a link. Its path is device-local.
 */
export interface LocalAttachment {
  schemaVersion: 1;
  mountId: string;
  scopeId: string;
  provider: 'local';
  /** The chosen folder's own name, for display. */
  folderName: string;
  contentsRoot: string;
  name: string;
  access: CloudAccess;
}
export type Attachment = CloudAttachment | LocalAttachment;
export type CloudAccess = 'read-only' | 'read-write';
export type CloudConnection = Attachment & ConnectionState;
export interface ConnectionState {
  /** `retired`: a Google Drive connection from before 0.1.67, to be switched to a folder. */
  state: 'unconfigured' | 'disconnected' | 'connecting' | 'mounted' | 'error' | 'retired';
  detail?: string;
  /** Linked so that files can be changed. */
  writable?: boolean;
}
export interface AddLocalFolder {
  scopeId: string;
  /** The folder's absolute path on this device. */
  path: string;
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
  | { type: 'update'; state: import('./updates').UpdateState }
  | { type: 'routine'; run: import('./routines').RoutineRun }
  /** The irori agent registered a hibachi; `workspace` is the one it joined, as saved. */
  | { type: 'hibachis'; workspace?: WorkspaceProfile };
export interface StartRun {
  scopeId: string;
  agent: AgentId;
  /** Native permission policy for this instruction; omitted inputs keep the standard policy. */
  access?: AgentAccess;
  /** The CLI's model for this instruction; the CLI's own default when absent. */
  model?: string;
  prompt: string;
  notePath?: string;
  /** The conversation to continue: one of the owner's, or an id `createConversation` gave. */
  conversationId?: string;
  sources?: import('./knowledge').SourceRef[];
  /** Name of a skill package this KB declares, prepended to the request. */
  skill?: string;
  /** Tell the agent which lines of the note the person wrote or revised. */
  personLines?: boolean;
  /** Brains handed to your AI for this request; only your AI's runs take them. */
  brains?: string[];
  /** The workspace an irori agent request was sent in: hibachis it registers join it. */
  workspace?: string;
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
  /** Offer each hibachi's own agent and its Schema layer; off, irori is an editor with the irori agent. */
  hibachiAgent: boolean;
  /** The CLI your AI runs on and the model chosen for each CLI ('' or absent: the CLI's default). */
  yourAi: { agent: AgentId; models: Partial<Record<AgentId, string>> };
  /** Pane layouts per group, kept here because file-URL storage is not durable. */
  layouts: Record<string, string>;
  /** The reader's role and project per KB, which narrows that KB's skill picker. */
  skillAudiences: Record<string, import('./skills').SkillAudience>;
  /** The runtimes routines may use on this device, added by the person. */
  routineRuntimes: import('./routines').RoutineRuntime[];
}

export interface HostAPI {
  /** Copies once prepared for upload to Google Drive, before 0.1.67 (ADR 023). */
  recoverableCloudWrites(): Promise<import('./knowledge').CloudWriteRecovery>;
  /** Changed files a Google Drive connection never uploaded, still on this device. */
  unsentDriveChanges(): Promise<number>;
  /** Saves those files to a folder the person chooses; null when nothing was chosen. */
  exportUnsentDriveChanges(): Promise<{ folder: string; count: number } | null>;
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
  gitStatus(target: GitTarget): Promise<GitStatus>;
  gitDiff(target: GitTarget, path: string, staged: boolean): Promise<GitDiff>;
  gitHistory(target: GitTarget, offset: number): Promise<GitHistory>;
  gitCommitDiff(target: GitTarget, oid: string): Promise<string>;
  gitStage(target: GitTarget, path: string, staged: boolean, version: string): Promise<GitStatus>;
  gitStageMany(
    target: GitTarget,
    paths: string[],
    staged: boolean,
    version: string,
  ): Promise<GitStatus>;
  gitCommit(target: GitTarget, message: string, version: string): Promise<GitStatus>;
  gitSync(target: GitTarget, action: GitSyncAction, version: string): Promise<GitStatus>;
  gitConflict(target: GitTarget, path: string): Promise<GitConflict>;
  gitResolve(
    target: GitTarget,
    path: string,
    text: string | null,
    version: string,
  ): Promise<GitStatus>;
  /** The repositories the hibachi holds as submodules (ADR 022). */
  gitSubmodules(scopeId: string): Promise<import('./git').GitSubmodules>;
  /** Clones a GitHub repository into a new folder of the hibachi as a submodule. */
  gitSubmoduleAdd(
    scopeId: string,
    input: import('./git').AddSubmodule,
  ): Promise<import('./git').GitSubmodules>;
  /** Fetches the files of one submodule not yet here, or of every such submodule. */
  gitSubmoduleInit(scopeId: string, path?: string): Promise<import('./git').GitSubmodules>;
  gitClone(input: CloneRepository): Promise<import('./git').CloneResult>;
  /** Makes a hibachi that is an ordinary folder a Git repository on `main`. */
  gitInit(scopeId: string): Promise<GitStatus>;
  /** The account the GitHub CLI is signed in to and its organizations. */
  githubAccount(): Promise<import('./git').GitHubAccount>;
  /** Creates a GitHub repository for a hibachi without a remote and pushes to it. */
  gitPublish(
    scopeId: string,
    input: import('./git').PublishRepository,
    version: string,
  ): Promise<GitStatus>;
  /** The account, this device's environment and the one saved on GitHub (ADR 026). */
  environment(): Promise<import('./environment').EnvironmentState>;
  /** Replaces the environment saved on the GitHub account with this device's. */
  saveEnvironment(): Promise<import('./environment').EnvironmentState>;
  /** Adds the saved environment to this device: clones, workspaces and preferences. */
  restoreEnvironment(
    input: import('./environment').RestoreEnvironment,
  ): Promise<import('./environment').EnvironmentRestore>;
  gitOpenRepository(target: GitTarget): Promise<void>;
  repositories(root: string): Promise<RepositoryInfo>;
  workspaces(): Promise<WorkspaceProfile[]>;
  saveWorkspace(name: string, scopeIds: string[], id?: string): Promise<WorkspaceProfile>;
  removeWorkspace(id: string): Promise<void>;
  /** Replaces the workspace's groups; members it does not hold are dropped. */
  saveWorkspaceGroups(id: string, groups: HibachiGroup[]): Promise<WorkspaceProfile>;
  cloudConnections(scopeId: string): Promise<CloudConnection[]>;
  connectCloud(scopeId: string, mountId: string): Promise<void>;
  disconnectCloud(scopeId: string, mountId: string): Promise<void>;
  /** Registers a folder on this device in contents, shown there through a link. */
  addLocalFolder(input: AddLocalFolder): Promise<CloudConnection>;
  /** Chooses the folder a local connection uses on this device. */
  bindLocalFolder(scopeId: string, mountId: string, path: string): Promise<void>;
  /** Switches a retired Google Drive connection to a folder on this device, keeping its name. */
  switchCloudToLocal(scopeId: string, mountId: string, path: string): Promise<void>;
  renameCloud(scopeId: string, mountId: string, name: string): Promise<void>;
  removeCloud(scopeId: string, mountId: string): Promise<void>;
  /** Whether the connection may change its folder; a connected folder is linked again. */
  setCloudAccess(scopeId: string, mountId: string, access: CloudAccess): Promise<void>;
  /** Shows the connected folder in the system file manager, for adding files there. */
  openCloudFolder(scopeId: string, mountId: string): Promise<void>;
  /** Creates an empty Markdown note in an editable connected folder and returns it. */
  createCloudNote(scopeId: string, directory: string, name: string): Promise<Document>;
  /**
   * Renames or moves a file or folder inside one editable connected folder. `to` is
   * the full new path; an existing entry is never replaced. Returns the moved entry.
   */
  moveCloudEntry(scopeId: string, from: string, to: string): Promise<Entry>;
  /** Moves a file or folder of an editable connected folder to the system trash. */
  deleteCloudEntry(scopeId: string, path: string): Promise<void>;
  spaces(): Promise<Space[]>;
  chooseFolder(): Promise<string | null>;
  register(root: string, name: string, category: Category): Promise<Space>;
  /** Makes a new folder a Git repository and registers it as a hibachi. */
  createSpace(input: import('./git').CreateSpace): Promise<import('./git').CreatedSpace>;
  /**
   * Removes a hibachi from this device and from every workspace. With `trash`,
   * its folder goes to the system trash; otherwise the folder stays as it is.
   */
  removeSpace(scopeId: string, trash: boolean): Promise<void>;
  /** Changes a brain's name, category or look in its `.irori/scope.json`. */
  updateSpace(scopeId: string, change: SpaceChange): Promise<Space>;
  /**
   * Renames the hibachi's knowledge or contents folder on disk and in its
   * declaration, carrying the links, comments and records that name its paths.
   */
  renameLayerFolder(
    scopeId: string,
    layer: import('./layers').NamedLayer,
    name: string,
  ): Promise<LayerFolderRename>;
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
  /** The comments people left on a Markdown file of this KB (`.irori/comments/<path>.json`). */
  noteComments(scopeId: string, path: string): Promise<import('./comments').NoteComment[]>;
  /** Adds the person's comment to a Markdown file and returns the file's comments. */
  addNoteComment(
    scopeId: string,
    path: string,
    comment: import('./comments').NewComment,
  ): Promise<import('./comments').NoteComment[]>;
  /** Removes one comment from a Markdown file and returns the rest. */
  removeNoteComment(
    scopeId: string,
    path: string,
    id: string,
  ): Promise<import('./comments').NoteComment[]>;
  /** Skill packages this KB declares in `.agents/skills/`, and the ones it retired. */
  skills(scopeId: string): Promise<import('./skills').SkillListing>;
  /** Which user-scope skill directories hold a same-named skill, per declared name. */
  skillReach(scopeId: string): Promise<import('./skill-reach').SkillReach>;
  /** The brain's instructions, Claude Code rules and skill package files, for the Schema settings. */
  schemaSettings(scopeId: string): Promise<import('./schema-settings').SchemaSettings>;
  /** The text of one file the Schema settings edit, whatever its extension. */
  readSchemaFile(scopeId: string, path: string): Promise<Document>;
  /**
   * Creates (`expected` null), replaces (`expected` the hash being replaced) or,
   * with `text` null, deletes one file the Schema settings edit; see
   * `settingKind` in `schema-settings.ts` for the paths it accepts.
   */
  writeSchemaFile(
    scopeId: string,
    path: string,
    text: string | null,
    expected: string | null,
  ): Promise<Document | null>;
  /** Renames a skill package's folder, or with `to` null removes the package and its files. */
  moveSkill(scopeId: string, name: string, to: string | null): Promise<void>;
  saveImage(scopeId: string, note: string, bytes: Uint8Array): Promise<string>;
  readImage(scopeId: string, note: string, url: string): Promise<string>;
  /** The bytes of a file a viewer shows (PDF, Office, image), in a KB. */
  viewerBytes(scopeId: string, path: string): Promise<Uint8Array>;
  save(doc: Document): Promise<Document>;
  draft(doc: Document): Promise<void>;
  createNote(scopeId: string, name: string, directory?: string): Promise<Document>;
  /** Where this KB asks new notes and today's note to go (`.irori/notes.json`), or null. */
  notesDeclaration(scopeId: string): Promise<import('./notes').NotesDeclaration | null>;
  /** The KB's declared page properties (`.property/property.json`) and the person's actor id. */
  pageProperties(scopeId: string): Promise<import('./properties').PageProperties>;
  /** Opens today's note at the declared path, creating it from the template on first use. */
  dailyNote(scopeId: string): Promise<Document>;
  openExternal(scopeId: string, path: string): Promise<void>;
  /** Opens an http or https address from agent output in the user's browser. */
  openUrl(url: string): Promise<void>;
  deviceSettings(): Promise<DeviceSettings>;
  saveDeviceSettings(patch: Partial<DeviceSettings>): Promise<DeviceSettings>;
  agents(): Promise<AgentInfo[]>;
  /** The models the installed CLI offers, read from the CLI and kept per version. Never generates text. */
  agentModels(agent: AgentId): Promise<AgentModels>;
  /** The owner's conversations (a hibachi's or the irori agent's), pinned first, then by last update. */
  agentConversations(scopeId: string): Promise<import('./conversation').ConversationRow[]>;
  /**
   * One conversation with its queue and the requests its run waits on. Without an
   * id: the one running, else the one whose queue is oldest, else the latest for this CLI.
   */
  agentConversation(
    scopeId: string,
    agent: AgentId,
    conversationId?: string,
  ): Promise<import('./conversation').Conversation>;
  /** An id for a new conversation; nothing is written before its first instruction. */
  createConversation(scopeId: string, agent: AgentId): Promise<string>;
  renameConversation(
    conversationId: string,
    title: string,
  ): Promise<import('./conversation').ConversationSummary>;
  pinConversation(
    conversationId: string,
    pinned: boolean,
  ): Promise<import('./conversation').ConversationSummary>;
  archiveConversation(
    conversationId: string,
    archived: boolean,
  ): Promise<import('./conversation').ConversationSummary>;
  /** Removes irori's copy only; the CLI's own transcript stays where the CLI keeps it. */
  deleteConversation(conversationId: string): Promise<void>;
  queueAgentMessage(input: StartRun): Promise<import('./conversation').QueuedMessage[]>;
  removeQueuedMessage(
    conversationId: string,
    id: string,
  ): Promise<import('./conversation').QueuedMessage[]>;
  /**
   * Starts the oldest queued instruction of one of the owner's conversations that
   * is not running, or of the named conversation alone. Each conversation's queue
   * waits only for its own run; null when nothing could start.
   */
  startNextQueued(scopeId: string, conversationId?: string): Promise<string | null>;
  start(input: StartRun): Promise<string>;
  /** Your AI's folder and whether it is set up; its runs use `id` as their scope. */
  yourAi(): Promise<import('./you').YourAi>;
  /** Writes the starter into an absent or empty folder; never over existing files. */
  createYourAi(): Promise<import('./you').YourAi>;
  /** Writes the standard skills the irori agent's folder lacks; never over a present one. */
  addYourAiSkills(): Promise<import('./you').YourAi>;
  yourAiEntries(path: string): Promise<import('./you').YourAiEntry[]>;
  yourAiRead(path: string): Promise<{ path: string; text: string }>;
  /** The sub-agent each brain gets from your AI, and whether its definition exists. */
  yourAiBrains(scopeIds: string[]): Promise<import('./you').BrainAgent[]>;
  /** The irori agent's routines and those of the workspace's hibachis, as this device sees them. */
  routines(workspaceId: string): Promise<import('./routines').Routine[]>;
  /** A routine's files as they are now, and what changed since the person confirmed them. */
  reviewRoutine(ref: import('./routines').RoutineRef): Promise<import('./routines').RoutineReview>;
  /** Starts a routine and returns its run's id; nothing else ever starts one. */
  runRoutine(
    ref: import('./routines').RoutineRef,
    input: import('./routines').RunRoutine,
  ): Promise<string>;
  /** Ends the routine's step in progress; later steps do not run. */
  stopRoutine(ref: import('./routines').RoutineRef): Promise<void>;
  /** The routine's runs kept on this device, newest first. */
  routineRuns(ref: import('./routines').RoutineRef): Promise<import('./routines').RoutineRun[]>;
  /** The secrets kept on this device, by name only. */
  secrets(): Promise<import('./routines').SecretList>;
  /** Stores or replaces a secret; its value never comes back. */
  setSecret(name: string, value: string): Promise<void>;
  deleteSecret(name: string): Promise<void>;
  /** Stops the run of one conversation, the runs in one space, or every run when neither is named. */
  cancel(scopeId?: string, conversationId?: string): Promise<void>;
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
  GitTarget,
  CloneRepository,
} from './git';
