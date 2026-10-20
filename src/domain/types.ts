export const agentIds = ['codex', 'claude', 'opencode', 'pi', 'hermes', 'antigravity'] as const;
export type AgentId = (typeof agentIds)[number];
export const agentAccessModes = ['default', 'full-access'] as const;
export type AgentAccess = (typeof agentAccessModes)[number];
export const agentNames: Record<AgentId, string> = {
  codex: 'Codex',
  claude: 'Claude Code',
  opencode: 'OpenCode',
  pi: 'Pi',
  hermes: 'Hermes Agent',
  antigravity: 'Antigravity CLI',
};
/** The categories irori offers first, shown in the reader's language; any other name is kept as written. */
export const presetCategories = ['personal', 'team', 'organization'] as const;
export type PresetCategory = (typeof presetCategories)[number];
/** A brain's category: a preset above or any short name the people of the KB choose. */
export type Category = string;
export type Layer = 'schema' | 'Knowledge_Base' | 'contents';
export interface ScopeDeclaration {
  schemaVersion: 1;
  scopeId: string;
  name: string;
  /** A preset or a name of the KB's own; a brain may carry none (ADR 014, ADR 029). */
  category?: Category;
  contents: string[];
  /** The knowledge folder when it is not `Knowledge_Base` (ADR 024); `.` is the vault's root (ADR 035). */
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
  /** The folder before the change, `''` for the vault's root. */
  previous: string;
  /**
   * When the knowledge folder became or stopped being the vault's root, the
   * entries that moved, by their names at the root (`LayerMove`, ADR 035).
   */
  entries?: string[];
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
  /** The connection is a GitHub repository's clone (ADR 046). */
  repository?: boolean;
  /** A brought-in file still being written: `appendEntry` takes its other pieces. */
  upload?: string;
}
/**
 * A file or folder the explorer adds. A file with `bytes`, or a folder with
 * `brought`, is one the person brought in from elsewhere: it takes a free name
 * (`name 2.pdf`) when its own is taken. Otherwise it is new and empty, and a
 * taken name is refused.
 */
export type NewEntry =
  | { kind: 'folder'; name: string; brought?: boolean }
  | {
      kind: 'file';
      name: string;
      bytes?: Uint8Array;
      /** The whole size of a brought-in file larger than `bytes`, its first piece. */
      size?: number;
    };
/** Where a moved file or folder is now and, in knowledge, what followed it. */
export interface EntryMove {
  entry: Entry;
  /** Links rewritten to lead to it where it is now (knowledge only). */
  links?: import('./note-links').LinkUpdate;
  notice?: string;
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
/** One answer a question offers; the answer sent back is its label. */
export interface QuestionOption {
  label: string;
  description?: string;
  /** Text shown beside the option while it is chosen (Claude Code's `preview`). */
  preview?: string;
}
export interface Question {
  id: string;
  title: string;
  /** A short tag naming what is asked, as the CLI gives one. */
  header?: string;
  options?: QuestionOption[];
  multiple?: boolean;
  /** The person may write an answer of their own beside the options. */
  other?: boolean;
  /** The answer is hidden while typed and never shown again. */
  secret?: boolean;
  /** A longer answer: several lines. */
  multiline?: boolean;
  /** The question may be left unanswered. */
  optional?: boolean;
}
export type AgentAnswers = Record<string, string | string[]>;
/**
 * Work your AI handed to a brain's sub-agent: which brain, which hand-off (the
 * delegation's tool call), and how far it is.
 */
export const delegateStates = ['started', 'working', 'reported', 'failed'] as const;
export interface Delegate {
  scopeId: string;
  task: string;
  state: (typeof delegateStates)[number];
}
export const runOutcomes = ['completed', 'failed', 'cancelled'] as const;
export type RunOutcome = (typeof runOutcomes)[number];
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
  outcome?: RunOutcome;
  /** Set on your AI's events that belong to a brain's sub-agent. */
  delegate?: Delegate;
  /** Files the person attached to this message. */
  attachments?: import('./attachments').AttachmentRef[];
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
  /** The thinking levels this model takes, as the CLI names them; none when empty. */
  efforts?: string[];
  /** The level it thinks at when none is passed. */
  defaultEffort?: string;
}
export interface AgentModels {
  models: AgentModel[];
  /** A model name may be typed in: the CLI gives no list, or reading it failed. */
  custom: boolean;
  /** Thinking levels for a model that lists none of its own. */
  efforts?: string[];
  /** A thinking level may be typed in: the CLI names its levels per model, out of reach. */
  customEffort?: boolean;
  /** Why the list could not be read. */
  error?: string;
}
/** A command or skill the CLI runs when a request starts with `/name` (ADR 039). */
export interface AgentCommand {
  /** Without the leading slash. */
  name: string;
  description: string;
  /** What follows the name, as the CLI describes it (`<file>`). */
  hint?: string;
  /** A skill, rather than one of the CLI's commands. */
  skill?: boolean;
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
/** Vaults gathered under a name in the rail; a closed group shows as one folder. */
export interface VaultGroup {
  id: string;
  name: string;
  scopeIds: string[];
  open: boolean;
}
export interface WorkspaceProfile {
  id: string;
  name: string;
  scopeIds: string[];
  groups?: VaultGroup[];
}
/** The folder a vault's agents work in (scratch, intermediate results, downloads). */
export interface WorkFolder {
  /** Where they work now, an absolute path on this device. */
  path: string;
  /** The person chose a folder; otherwise it is `work` in the vault's contents (ADR 044). */
  chosen: boolean;
  /** The chosen folder, when it is not there and the default stands in for it. */
  missing?: string;
}
export interface CloudRoot {
  scopeId: string;
  name: string;
  root: string;
  contents: string[];
}
/**
 * A Google Drive folder irori connected itself before 0.1.67. Kept in a vault's
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
/**
 * A GitHub repository shown in contents (ADR 046): the vault records its URL,
 * and each device links its own clone, chosen or made there, as a local folder.
 */
export interface RepositoryAttachment {
  schemaVersion: 1;
  mountId: string;
  scopeId: string;
  provider: 'github';
  /** The clone URL, GitHub over HTTPS or SSH. */
  url: string;
  /** The branch a clone irori makes checks out; the remote's default without it. */
  branch?: string;
  /** The clone folder's own name on the device that chose it last, for display. */
  folderName: string;
  contentsRoot: string;
  name: string;
  access: CloudAccess;
}
/** A connection whose files are a folder on this device. */
export type FolderAttachment = LocalAttachment | RepositoryAttachment;
export type Attachment = CloudAttachment | FolderAttachment;
export type CloudAccess = 'read-only' | 'read-write';
export type CloudConnection = Attachment & ConnectionState;
export interface ConnectionState {
  /**
   * `waiting`: its folder is not there yet (a drive not mounted, a sync app
   * starting); it connects by itself once it is. `retired`: a Google Drive
   * connection from before 0.1.67, to be switched to a folder.
   */
  state:
    'unconfigured' | 'disconnected' | 'connecting' | 'waiting' | 'mounted' | 'error' | 'retired';
  detail?: string;
  /** Linked so that files can be changed. */
  writable?: boolean;
}
/**
 * A GitHub repository to show in contents: `folder` is an existing clone of it
 * (`existing`), or the folder in which irori clones it into a new folder named
 * after the repository.
 */
export interface AddRepository {
  scopeId: string;
  url: string;
  branch?: string;
  folder: string;
  existing: boolean;
  contentsRoot: string;
  name: string;
  access?: CloudAccess;
}
/** What 最新にする did to a repository's clone. */
export interface RepositoryUpdate {
  branch: string;
  /** Commits the branch moved forward by; 0 when it was already up to date. */
  commits: number;
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
  /** The irori agent registered a vault; `workspace` is the one it joined, as saved. */
  | { type: 'vaults'; workspace?: WorkspaceProfile }
  /** Another window opened or closed a workspace tab, or closed (ADR 051). */
  | { type: 'windows' };
export interface StartRun {
  scopeId: string;
  agent: AgentId;
  /** Native permission policy for this instruction; omitted inputs keep the standard policy. */
  access?: AgentAccess;
  /** The CLI's model for this instruction; the CLI's own default when absent. */
  model?: string;
  /** How much the CLI thinks for this instruction; its own default when absent. */
  effort?: string;
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
  /** The workspace an irori agent request was sent in: vaults it registers join it. */
  workspace?: string;
  /** Files the person attached, by the references `stageAttachment` returned. */
  attachments?: import('./attachments').AttachmentRef[];
}
export const markdownFonts = ['system', 'sans', 'rounded', 'serif', 'textbook', 'mono'] as const;
export type MarkdownFont = (typeof markdownFonts)[number];
/** How much room a note leaves at its sides: a reading column, a wider one, or the stage's width. */
export const pageMargins = ['standard', 'small', 'minimal'] as const;
export type PageMargins = (typeof pageMargins)[number];
/** How large a note's text is: 14, 16 (standard), 18 or 20 pixels, its headings in step. */
export const textSizes = ['small', 'standard', 'large', 'larger'] as const;
export type TextSize = (typeof textSizes)[number];
/** How far apart a note's lines are. */
export const lineSpacings = ['compact', 'standard', 'relaxed'] as const;
export type LineSpacing = (typeof lineSpacings)[number];
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
  pageMargins: PageMargins;
  textSize: TextSize;
  lineSpacing: LineSpacing;
  /** Show code assistance in source editors and Markdown code blocks. */
  editorAssistance: boolean;
  /** Keep a page's properties folded under its title. */
  propertiesFolded: boolean;
  /** Offer each vault's own agent and its Schema layer; off, irori is an editor with the irori agent. */
  vaultAgent: boolean;
  /** The CLI your AI runs on and the model and thinking level chosen for each CLI ('' or absent: the CLI's default). */
  yourAi: {
    agent: AgentId;
    models: Partial<Record<AgentId, string>>;
    efforts?: Partial<Record<AgentId, string>>;
  };
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
  /** The repositories the vault holds as submodules (ADR 022). */
  gitSubmodules(scopeId: string): Promise<import('./git').GitSubmodules>;
  /** Clones a GitHub repository into a new folder of the vault as a submodule. */
  gitSubmoduleAdd(
    scopeId: string,
    input: import('./git').AddSubmodule,
  ): Promise<import('./git').GitSubmodules>;
  /** Fetches the files of one submodule not yet here, or of every such submodule. */
  gitSubmoduleInit(scopeId: string, path?: string): Promise<import('./git').GitSubmodules>;
  gitClone(input: CloneRepository): Promise<import('./git').CloneResult>;
  /** Makes a vault that is an ordinary folder a Git repository on `main`. */
  gitInit(scopeId: string): Promise<GitStatus>;
  /** The account the GitHub CLI is signed in to and its organizations. */
  githubAccount(): Promise<import('./git').GitHubAccount>;
  /** Creates a GitHub repository for a vault without a remote and pushes to it. */
  gitPublish(
    scopeId: string,
    input: import('./git').PublishRepository,
    version: string,
  ): Promise<GitStatus>;
  /** The account, this device's environment and the one saved on GitHub (ADR 026). */
  environment(): Promise<import('./environment').EnvironmentState>;
  /**
   * Replaces the environment saved on the GitHub account with this device's;
   * with a passphrase, its secrets too, sealed with that passphrase (ADR 047).
   */
  saveEnvironment(passphrase?: string): Promise<import('./environment').EnvironmentState>;
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
  saveWorkspaceGroups(id: string, groups: VaultGroup[]): Promise<WorkspaceProfile>;
  cloudConnections(scopeId: string): Promise<CloudConnection[]>;
  connectCloud(scopeId: string, mountId: string): Promise<void>;
  disconnectCloud(scopeId: string, mountId: string): Promise<void>;
  /** Registers a folder on this device in contents, shown there through a link. */
  addLocalFolder(input: AddLocalFolder): Promise<CloudConnection>;
  /** Registers a GitHub repository in contents, cloning it first unless `existing`. */
  addRepository(input: AddRepository): Promise<CloudConnection>;
  /** Clones a registered repository on this device, into a new folder inside `parent`. */
  cloneRepository(scopeId: string, mountId: string, parent: string): Promise<void>;
  /** Fetches a repository's clone and moves its branch forward when nothing stands in the way. */
  updateRepository(scopeId: string, mountId: string): Promise<RepositoryUpdate>;
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
   * Adds a file or folder in `directory` of the vault's knowledge or of an
   * editable connected folder, as a file manager does. Never replaces an entry.
   */
  createEntry(scopeId: string, directory: string, entry: NewEntry): Promise<Entry>;
  /** Writes the next piece of a brought-in file; the last one completes it. */
  appendEntry(upload: string, bytes: Uint8Array): Promise<void>;
  /** Removes a brought-in file that could not be written whole. */
  discardEntry(upload: string): Promise<void>;
  /**
   * Renames or moves a file or folder of the vault's knowledge, or inside one
   * editable connected folder. `to` is the full new path; an existing entry is
   * never replaced. In knowledge the links into it, its comments and the device's
   * records follow, as they do for a note.
   */
  moveEntry(scopeId: string, from: string, to: string): Promise<EntryMove>;
  /**
   * How many links a move of a file or folder of knowledge into another vault
   * would break: links never cross vaults (ADR 038).
   */
  vaultMoveLinks(scopeId: string, path: string): Promise<{ links: number; incomplete: boolean }>;
  /**
   * Moves a file or folder of the vault's knowledge into `directory` of another
   * vault's knowledge, keeping its name or taking a free one. A note's managed
   * images are copied with it and its comments follow; links to and from it break.
   */
  moveToVault(
    scopeId: string,
    path: string,
    toScopeId: string,
    directory: string,
  ): Promise<EntryMove>;
  /**
   * Copies a file or folder of a vault's knowledge or connected folders into
   * `directory` of a vault's knowledge or of an editable connected folder, as a
   * file manager's paste does: under its name or the first free one, never
   * replacing an entry. A copy within knowledge keeps its links leading where
   * the original's did.
   */
  copyEntry(scopeId: string, path: string, toScopeId: string, directory: string): Promise<Entry>;
  /**
   * Deletes a file or folder of the vault's knowledge, of its Schema layer
   * (except `.irori` and `.git`) or of an editable connected folder. A note of
   * knowledge goes to irori's deleted notes; anything else to the system trash.
   */
  trashEntry(scopeId: string, path: string): Promise<void>;
  /**
   * Puts a file's or folder's path on the clipboard, as a file manager's menu does:
   * the full path on this computer, or the path from the vault's root with `/`.
   * Returns the text put there.
   */
  copyEntryPath(scopeId: string, path: string, absolute: boolean): Promise<string>;
  /** Shows a file or folder of the vault in the system file manager. */
  revealEntry(scopeId: string, path: string): Promise<void>;
  spaces(): Promise<Space[]>;
  chooseFolder(): Promise<string | null>;
  /** The folder the vault's agents work in. */
  workFolder(scopeId: string): Promise<WorkFolder>;
  /** Chooses the folder the vault's agents work in on this device; `null` for the default. */
  setWorkFolder(scopeId: string, folder: string | null): Promise<WorkFolder>;
  /** Shows the vault's work folder in the system file manager, making the default one first. */
  openWorkFolder(scopeId: string): Promise<void>;
  register(root: string, name: string, category: Category): Promise<Space>;
  /** Makes a new folder a Git repository and registers it as a vault. */
  createSpace(input: import('./git').CreateSpace): Promise<import('./git').CreatedSpace>;
  /**
   * Removes a vault from this device and from every workspace. With `trash`,
   * its folder goes to the system trash; otherwise the folder stays as it is.
   */
  removeSpace(scopeId: string, trash: boolean): Promise<void>;
  /** Changes a brain's name, category or look in its `.irori/scope.json`. */
  updateSpace(scopeId: string, change: SpaceChange): Promise<Space>;
  /**
   * Renames the vault's knowledge or contents folder on disk and in its
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
  /** Whether the graph index and an OKF bundle's folder indexes match the pages now, and what an update would change (ADR 008, 028). Writes nothing. */
  graphIndexStatus(scopeId: string): Promise<import('./graph-index').GraphIndexStatus>;
  /** Generates the graph index (unless declared) and the folder indexes from the pages, and writes the files whose bytes change. */
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
  /**
   * The commands and skills the installed CLI offers in this owner's folder,
   * typed as `/name` (ADR 039). Read from the CLI, never generating text; empty
   * for a CLI that lists none.
   */
  agentCommands(scopeId: string, agent: AgentId): Promise<AgentCommand[]>;
  /**
   * The owner's conversations (a vault's or the irori agent's), pinned first, then
   * by last update. `workspaceId` picks the irori agent's history of that workspace;
   * a vault's is one history wherever it is opened.
   */
  agentConversations(
    scopeId: string,
    workspaceId?: string,
  ): Promise<import('./conversation').ConversationRow[]>;
  /**
   * One conversation with its queue and the requests its run waits on. Without an
   * id: the one running, else the one whose queue is oldest, else the latest for this CLI.
   */
  agentConversation(
    scopeId: string,
    agent: AgentId,
    conversationId?: string,
    workspaceId?: string,
  ): Promise<import('./conversation').Conversation>;
  /** An id for a new conversation; nothing is written before its first instruction. */
  createConversation(scopeId: string, agent: AgentId, workspaceId?: string): Promise<string>;
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
  startNextQueued(
    scopeId: string,
    conversationId?: string,
    workspaceId?: string,
  ): Promise<string | null>;
  start(input: StartRun): Promise<string>;
  /**
   * Which workspace the window shows: the irori agent's screens, Schema settings
   * and terminal use that workspace's folder (ADR 044).
   */
  showWorkspace(workspaceId: string | null): Promise<void>;
  /** The irori agent's folder for a workspace (ADR 044). */
  iroriAgentFolder(workspaceId: string): Promise<import('./you').IroriAgentFolder>;
  /** Chooses it, or the default again with `null`. Nothing is made or moved. */
  setIroriAgentFolder(
    workspaceId: string,
    folder: string | null,
  ): Promise<import('./you').IroriAgentFolder>;
  /** Opens the irori agent's folder for a workspace in the system's file manager. */
  openIroriAgentFolder(workspaceId: string): Promise<void>;
  /**
   * The file a path in an agent's reply names, looked for where its writer
   * works first, then in the workspace's other folders (ADR 044). Null when no
   * file is there; several when only its name was written and it is in more
   * than one place.
   */
  /** The folders a path in an agent's reply may land in, for a workspace (ADR 044). */
  agentPathRoots(workspaceId?: string): Promise<import('./path-links').PathRoot[]>;
  locateAgentPath(
    query: import('./path-links').AgentPathQuery,
  ): Promise<import('./path-links').PathTarget[]>;
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
  /** The irori agent's routines and those of the workspace's vaults, as this device sees them. */
  routines(workspaceId: string): Promise<import('./routines').Routine[]>;
  /** Starts a routine in the irori agent's folder or a vault, with `text` or a template to finish. */
  createRoutine(
    owner: string,
    name: string,
    text?: string,
  ): Promise<import('./routines').RoutineRef>;
  /** The routine's `routine.yaml`, for the person to edit. */
  routineSource(ref: import('./routines').RoutineRef): Promise<import('./routines').RoutineSource>;
  /** Saves `routine.yaml` unless it changed since `version`; says why it cannot run yet, if so. */
  saveRoutineSource(
    ref: import('./routines').RoutineRef,
    text: string,
    version: string,
  ): Promise<{ version: string; problem?: string }>;
  /** Shows a routine's folder in the system file manager. */
  revealRoutine(ref: import('./routines').RoutineRef): Promise<void>;
  /** Moves a routine's folder to the system trash and forgets its review and runs on this device. */
  deleteRoutine(ref: import('./routines').RoutineRef): Promise<void>;
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
  /** Downloads uv for `.py` routine steps into irori's data, unless it is there already. */
  installPython(): Promise<void>;
  /** The secrets kept on this device, by name only. */
  secrets(): Promise<import('./routines').SecretList>;
  /** Stores or replaces a secret; its value never comes back. */
  setSecret(name: string, value: string): Promise<void>;
  deleteSecret(name: string): Promise<void>;
  /** Stops the run of one conversation, the runs in one space, or every run when neither is named. */
  cancel(scopeId?: string, conversationId?: string): Promise<void>;
  respond(requestId: string, allow: boolean, answers?: AgentAnswers): Promise<void>;
  /** Keeps a file for the next instruction; it is sent by the reference returned. */
  stageAttachment(name: string, bytes: Uint8Array): Promise<import('./attachments').AttachmentRef>;
  /** Forgets a kept file that was not sent; one already sent stays with its conversation. */
  discardAttachment(id: string): Promise<void>;
  /** The bytes of an attached image, for its thumbnail; null when this device lacks it. */
  attachmentImage(id: string): Promise<Uint8Array | null>;
  /** Opens an attached file in the application the system chooses. */
  openAttachment(id: string): Promise<void>;
  /**
   * Starts the operating system's dictation in the focused field: macOS 音声入力,
   * Windows voice typing (Win+H). False where irori cannot start it.
   */
  dictate(): Promise<boolean>;
  /** Tells the host which workspaces this window has open as tabs (ADR 051). */
  windowTabs(tabs: import('./workspace-tabs').OpenTab[]): Promise<void>;
  /** The workspaces and vaults irori's other windows have open; closing a tab leaves them be. */
  otherWindows(): Promise<import('./workspace-tabs').OpenTab[]>;
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
