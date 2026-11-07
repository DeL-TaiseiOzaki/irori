import { KnowledgeStore } from '../knowledge/store';
import { within } from '../domain/scopes';
import { AuthorshipStore, personLinesNotice } from '../knowledge/authorship';
import path from 'node:path';
import type { RunRecord } from '../domain/knowledge';
import { createHash, randomUUID } from 'node:crypto';
import type { ChildProcess, ChildProcessWithoutNullStreams } from 'node:child_process';
import type {
  AgentEvent,
  AgentAccess,
  AgentId,
  AgentInfo,
  AgentAnswers,
  Delegate,
  Question,
  QuestionOption,
  StartRun,
} from '../domain/types';
import type { EffortLevel, SDKUserMessage, Settings } from '@anthropic-ai/claude-agent-sdk';
import { promises as fs } from 'node:fs';
import { rm } from 'node:fs/promises';
import { agentIds, agentNames } from '../domain/types';
import { defaultAgentAccess, requireAgentAccess } from '../domain/agent-access';
import { runPi } from './pi';
import { runOpenCode } from './opencode';
import { runHermes } from './hermes';
import { runAntigravity } from './antigravity';
import { codexServer, initializeCodex, refuseCodex } from './codex';
import { ModelCatalog } from './models';
import { CommandCatalog, codexSkills, commandWords } from './commands';
import { ConfigApprovals, type ConfigPlace, type FoundConfig } from './config-approval';
import { personLinesBridge } from './person-lines';
import { handOffTaskLimit, iroriBridge } from './irori-bridge';
import type { NativeContext } from './adapter';
import { agentCommand, agentEnv, killTree, knownVersion, launch, version } from './process';
import { Rpc, type Message } from './rpc';
import { Tail } from './tail';
import { MessageChannel, Steering } from './steering';
import type { FileService } from '../host/files';
import type { SetupContext } from '../host/agent-setup';
import type { SessionBinding } from './sessions';
import {
  ConversationStore,
  notYours,
  otherWorkspace,
  rootDigest,
  stopBeforeDeleting,
  viewDetails,
  type Placement,
} from './conversations';
import {
  conversationOwner,
  conversationTitle,
  promptLimit,
  startInput,
  steeringAgents,
  type Conversation,
  type ConversationOwner,
  type QueuedMessage,
  type SentNow,
} from '../domain/conversation';
import { DeviceIdentity } from '../host/device';
import {
  brainsCommandPreamble,
  iroriCommandPreamble,
  iroriCommandPointer,
  commentsPointer,
  commentsSummary,
  handedTask,
  permissionDenied,
  personLinesSummary,
  promptWithSkill,
  questionDeclined,
  selectedNote,
  selectedSources,
  attachedFiles,
  earlierConversation,
  sharedSchema,
  sharedSchemaPointer,
  sharedSchemaRemoved,
  vaultIntro,
  vaultIntroPointer,
  folderSchema,
  folderSchemaHasParts,
  folderSchemaPointer,
  folderSchemaRemoved,
  folderInstructionsChanged,
  hookContext,
  hookToolFeedback,
  stopHookContinue,
  type FolderSchemaPrompt,
} from '../../prompts';
import { claudeSettingsFile } from '../domain/schema-settings';
import {
  codexInstructionBytes,
  hookEvents,
  schemaReach,
  type SchemaReach,
} from '../domain/schema-reach';
import { fitParts, readSchemaParts, schemaInline } from '../host/schema-parts';
import { folderHooks, schemaHooks, SchemaHookRunner, type SchemaHook } from './schema-hooks';
import { RunHooks, stopHookCap } from './run-hooks';
import {
  antigravityHookFolder,
  codexHookConfig,
  forwardedHookBridge,
  hookBridge,
  pruneAntigravityHookFolders,
  type BridgeEvent,
} from './hook-bridge';
import { commentsCount, readNoteComments } from '../host/comments';
import { findSkill, noSkill, readFolderSkills } from '../host/skills';
import {
  claudeSkillNames,
  linkClaudeSkills,
  pruneClaudeSkills,
  unlinkClaudeSkills,
  type LinkedSkill,
} from './claude-skills';
import { spaceFolder } from '../host/schema-folder';
import { t } from '../domain/i18n';
import type { YourAiService } from '../host/you';
import { brainAgentNames } from '../domain/you';
import {
  definitionModel,
  foreignDefinitions,
  pruneCodexRoles,
  readAgentDefinitions,
  removeCodexRoles,
  vaultAgentDefinition,
  vaultAgentName,
  writeCodexRoles,
  type AgentDefinition,
} from './agent-definitions';
import { categoryName } from '../domain/brains';
import { knowledgeFolder, shownFolder } from '../domain/layers';
import {
  brainOfPath,
  editedPath,
  vaultOf,
  toolFile,
  writeDecision,
  writeToolMatcher,
  type Delegation,
} from './delegation';
import { AttachmentStore } from './attachments';
import { attachmentImageType, inlineImageByteLimit } from '../domain/attachments';
import { elicitationContent, elicitationQuestions } from '../domain/questions';
type Reply = { allow: boolean; answers?: AgentAnswers };
/** A file the person attached, as a run hands it to its CLI. */
export interface Attached {
  name: string;
  path: string;
  /** The image type, when the CLI may be shown it as a picture. */
  image?: string;
}
/** What a routine's agent step adds to an ordinary run (ADR 016 D7). */
export interface StepRun {
  /** Put before the step's prompt; the conversation shows the prompt alone. */
  preamble: string;
  /** Folders the run reads besides its own: the routine's and this run's. */
  directories: string[];
  /** The status line naming the routine, first in the conversation. */
  notice: string;
  /** `IRORI_WORK`, `IRORI_STATE` and `IRORI_ROUTINE`, in the CLI's environment too. */
  env: Record<string, string>;
  /** The routine's run and this step's index, kept in the step's conversation. */
  routine?: { runId: string; step: number };
}
/** How a routine's agent step ended, and its report: the words after its last other event. */
export interface StepEnd {
  outcome: NonNullable<AgentEvent['outcome']>;
  report: string;
  error?: string;
}
/** The digests of what irori said once and then stands for with one line (ADR 027, 039, 057). */
type Heard = { shared?: string; intro?: string; schema?: string; instructions?: string };
/** Codex fingerprinted irori's hooks otherwise: the turn starts again with the trust it reported. */
class CodexHooksAgain extends Error {
  constructor() {
    super('Codex reported its own trust for the hooks');
  }
}
/** Whether a version is at least another, part by part. */
const atLeast = (version: number[], than: number[]) => {
  for (let i = 0; i < than.length; i++)
    if ((version[i] ?? 0) !== than[i]) return (version[i] ?? 0) > than[i];
  return true;
};
/** What a CLI is started with besides the request, made once per run (ADR 058). */
type CliSetup = {
  env?: NodeJS.ProcessEnv;
  args: string[];
  /** Folders added to the CLI's workspace: the Antigravity CLI's folder of hooks. */
  folders: string[];
  closers: (() => void)[];
  /** Codex and the Antigravity CLI: their own hooks hand irori events through this. */
  forwarded?: Awaited<ReturnType<typeof forwardedHookBridge>>;
  /** Codex: the events its hooks hand irori. */
  codexHooks?: string[];
};
/** Only the digests that are there, as the native record keeps them. */
const heardDigests = (heard: Heard) =>
  Object.fromEntries(Object.entries(heard).filter(([, value]) => value)) as Heard;
type Run = {
  id: string;
  binding: SessionBinding;
  /** The conversation the run is recorded in, once it is known (ADR 017). */
  conversationId?: string;
  /** For your AI: its folder and the brains handed to it in this run. */
  delegation?: Delegation;
  /** For a vault agent's run started by your AI's `irori call`: that run's id. */
  holder?: string;
  /** A routine's agent step: a new native session that is never kept. */
  step?: StepRun;
  /** Work folders outside the run's own folder, which its agents may change too. */
  work?: string[];
  access: AgentAccess;
  /** What the run was started with, against which an instruction sent now is checked. */
  input: StartRun;
  /** How the run takes words sent while it works, if it can (ADR 056). */
  steering: Steering;
  /** The CLI session the run used, and where it stood at the run's end (ADR 017 D6). */
  nativeHandle?: string;
  nativeAt?: string;
  queuedId?: string;
  recorded?: boolean;
  /** The id streamed text keeps until another kind of event comes. */
  textId?: string;
  /** Streamed text not yet sent to the views or the history, and when it will be. */
  pendingText?: { id: string; text: string; timer: NodeJS.Timeout };
  /** The run's history is complete: text that still arrives is not part of it. */
  ended?: boolean;
  /** The agent said or did something in this run: a failure is not the resume's. */
  progressed?: boolean;
  /** The vaults this run's hand-offs reached. */
  reached: Set<string>;
  /** The digest of the checkout the run works in, kept with its native session. */
  root?: string;
  /**
   * What the run's native session had heard before this run, when it goes on
   * from one: the digests of the shared Schema, the introduction (ADR 039) and
   * the parts of its folder's Schema irori gives it (ADR 058).
   */
  heard: Heard;
  /** The session the run went on from; a session the CLI starts anew has heard nothing. */
  resumed?: string;
  /** What this run's request gave, whole or as a line that stands for it. */
  sent: Heard;
  /** The CLI compacted the session during the run (ADR 058). */
  compacted?: boolean;
  /** How the run's session began, as a SessionStart hook hears it: anew, going on, or after a compaction. */
  source?: 'startup' | 'resume' | 'compact';
  /** The CLI says when it compacts: what was heard stands for itself with one line. */
  pointers?: boolean;
  /** The Schema's hooks irori runs for this CLI (ADR 058). */
  hooks?: RunHooks;
  /** A hook said `continue: false`, with its reason. */
  halted?: string;
  /** The request has gone to the CLI: from now on what the run shows is the agent's. */
  sending?: boolean;
  /** The agent's words since its last tool call: the last message a Stop hook hears. */
  reply: Tail;
  /** What hooks said after the turn could take it, for its next turn. */
  later: string[];
  /** Hooks still running for calls the CLI reported once they ran. */
  pending: Set<Promise<void>>;
  /** What the CLI is started with besides the request, made on its first turn. */
  setup?: CliSetup;
  /** The session handle the CLI last named in this run. */
  handle?: string;
  /** Claude Code: the folder has a CLAUDE.md, beside which it reads AGENTS.md only when told to. */
  agentsBesideClaude?: boolean;
  /** Codex: the trust it reported for irori's hooks, when it fingerprints them otherwise. */
  codexTrust?: Map<string, { key: string; hash: string }>;
  /** The person's own words, which Codex takes apart for its commands and skills (ADR 040). */
  words?: string;
  /** The words are a CLI's command, `/name`, and went alone. */
  command?: boolean;
  /** The title a new conversation for this run takes instead of its first line. */
  title?: string;
  accepted: Promise<void>;
  accept: () => void;
  reject: (error: unknown) => void;
  cancelled: boolean;
  abort: AbortController;
  child?: ChildProcess;
  rpc?: Rpc;
  threadId?: string;
  turnId?: string;
  finish?: () => void;
  /** Files the person attached to this instruction. */
  attached?: Attached[];
  /** For your AI: the environment with the `irori` command, and its closing. */
  env?: NodeJS.ProcessEnv;
  commands?: () => void;
  /** For Claude Code: the folder of links to the skills it does not find itself (ADR 049). */
  claudeSkills?: string;
  /** The folder's sub-agents this CLI does not load itself, and those it must not use (ADR 050). */
  subAgents?: { foreign: AgentDefinition[]; refused: string[] };
  /** For your AI: its hand-offs' requests still waiting, as its views show them (ADR 050). */
  forwarded?: Map<string, AgentEvent>;
  /** For Codex: the configuration that adds `subAgents.foreign` as its roles. */
  codexRoles?: Record<string, string>;
  closed: Promise<void>;
  close: () => void;
};
const steerable = new Set(steeringAgents);
/** The CLIs whose session irori continues from a point of its own after a rewind or a copy (ADR 017 D6). */
const branching = new Set<AgentId>(['claude', 'codex']);
/** Deltas of a streamed reply are sent together after at most this long, not one by one. */
const textWindow = 32;
/** How long Claude Code lets the irori agent's shell commands run: a hand-off takes as long as it takes. */
const handOffShellTimeout = String(24 * 60 * 60 * 1000);
const digest = (words: string) => createHash('sha256').update(words).digest('hex');
/** The environment a run's CLI starts in: `base`, or irori's own, with a routine step's variables. */
const runEnv = (run: Run, base = run.env) => ({ ...(base ?? agentEnv()), ...run.step?.env });
/**
 * An absolute path as Claude Code's permission rules spell it: `//` from the
 * filesystem root, Windows drives as `/c/...`.
 */
export const claudeRulePath = (folder: string, platform = process.platform) =>
  platform === 'win32'
    ? `//${folder.replace(/^([A-Za-z]):/, (_, drive: string) => drive.toLowerCase()).replaceAll('\\', '/')}`
    : `/${folder}`;
/**
 * A request's details as the person sees them before answering: whole, or cut to
 * what a view shows with a line saying that the rest is not shown.
 */
export function shownRequest(full: string) {
  if (full.length <= viewDetails) return full;
  const omitted = (n: number) =>
    t(
      `\n…（以降の ${n} 文字は表示されていません。全体を確認できない要求です）`,
      `\n… (${n} more characters are not shown; this request cannot be seen in full)`,
    );
  const room = viewDetails - omitted(full.length).length;
  return full.slice(0, room) + omitted(full.length - room);
}
const alreadyRunning = () =>
  t(
    'この会話は実行中です。停止するか、送信待ちに追加してください。',
    'This conversation is already running. Stop it or add the instruction to its queue.',
  );
/** A routine's step or a hand-off is not the person's to stop or steer from its queue. */
const notTheirs = () =>
  t(
    'ルーティンや irori agent から渡された実行には、今すぐ送れません。終わってから送られます。',
    "A routine's step or the irori agent's hand-off cannot take an instruction now. It is sent when the run ends.",
  );
const historyUnsaved = () =>
  t(
    '会話履歴を保存できません。実行を停止します。',
    'Could not save the conversation history. Stopping the run.',
  );
const noReport = () => t('報告がありません。', 'No report.');
/** The irori agent is handed vaults; a note, its lines or materials go to a vault agent. */
function refuseYourMaterials(input: StartRun) {
  if (input.notePath || input.personLines || input.sources?.length)
    throw Error(
      t(
        'irori agent にはノートや資料を直接渡せません。vault を渡してください。',
        'The irori agent takes vaults, not notes or materials.',
      ),
    );
}
/**
 * Whether a Codex notification is about the run's own thread and turn. One app
 * server streams every thread it runs, so a sub-agent's replies, items and the
 * end of its turn arrive with its own thread id; they are not the run's, and a
 * sub-agent finishing does not finish the run. A notice naming neither is the run's.
 */
export function ownCodexNotice(
  run: { threadId?: string; turnId?: string },
  params: { threadId?: unknown; turnId?: unknown; turn?: { id?: unknown } },
) {
  const turn = params.turnId ?? params.turn?.id;
  return (
    (params.threadId === undefined || !run.threadId || params.threadId === run.threadId) &&
    (turn === undefined || !run.turnId || turn === run.turnId)
  );
}
/** What a hand-off's or a step's report keeps of the words it collects. */
const reportLimit = 100000;
/**
 * What `item/started` keeps of a Codex item: the call without any output, which
 * `item/completed` brings in full, so a diff or a command's output is stored once.
 */
export function itemStart(item: Record<string, unknown>) {
  const outputs = ['aggregatedOutput', 'formattedOutput', 'output', 'result', 'error'];
  const without = (value: Record<string, unknown>, keys: string[]) =>
    Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
  const rest = without(item, outputs);
  if (Array.isArray(rest.changes))
    rest.changes = rest.changes.map((change) =>
      change && typeof change === 'object' ? without(change, ['diff']) : change,
    );
  return rest;
}
/** One option of a CLI's question, whichever of its spellings it came in. */
export function questionOption(option: unknown): QuestionOption {
  if (typeof option === 'string') return { label: option };
  const value = (option ?? {}) as Record<string, unknown>;
  const text = (key: string) =>
    typeof value[key] === 'string' && value[key] ? { [key]: value[key] as string } : {};
  return { label: String(value.label ?? ''), ...text('description'), ...text('preview') };
}
export class AgentService {
  // Runs by id: one per conversation, and an owner's conversations run side by
  // side in its checkout, as Claudian's tabs do in one vault (ADR 020).
  private runs = new Map<string, Run>();
  // Conversations an instruction is being sent to now, so one goes at a time.
  private sendingNow = new Set<string>();
  private device: DeviceIdentity;
  private conversations: ConversationStore;
  /** Files the person attaches to instructions. */
  readonly attachments: AttachmentStore;
  private catalog = new ModelCatalog();
  private commandCatalog = new CommandCatalog();
  // Brains handed to the irori agent's runs in progress, with the runs that hold
  // them. A brain is busy while a sub-agent may be working in its checkout.
  private delegated = new Map<string, Set<string>>();
  /**
   * Carries out the irori agent's `irori` command (its arguments, the folder it
   * ran in, and where the request came from). Without it the command is not offered.
   */
  setup?: (argv: string[], cwd: string, context: SetupContext) => Promise<string>;
  /** The folder a vault's agents work in, made first when it is the default. Without it none is named. */
  workFolder?: (scopeId: string) => Promise<string>;
  /**
   * The `AGENTS.md` of a vault's knowledge folders, by their paths inside it,
   * named to a CLI that does not load them itself (ADR 058). Without it none are named.
   */
  nestedInstructions?: (scopeId: string) => Promise<string[]>;
  /** The access new conversations start in, as the person chose it in the settings (ADR 009). */
  preferredAccess?: () => Promise<AgentAccess>;
  /** Opens an http or https page in the person's browser, when an MCP server asks and they agree. */
  openUrl?: (url: string) => Promise<void>;
  /**
   * Asks the person whether configuration that runs without asking may run
   * (`config-approval.ts`); without it, as in tests, it may.
   */
  approveConfig?: (found: FoundConfig[]) => Promise<boolean>;
  private approvals?: ConfigApprovals;
  private configApprovals() {
    return (this.approvals ??= new ConfigApprovals(
      path.join(this.files.dataDir, 'agent-config-approvals.json'),
      (found) => this.approveConfig?.(found) ?? Promise.resolve(true),
    ));
  }
  /** Where a run's CLI reads configuration that can run without asking. */
  private configPlaces(run: Run, root: string): ConfigPlace[] {
    return [
      { root },
      ...(run.delegation?.brains.map((brain) => ({ root: brain.root })) ?? []),
      ...this.localFolders(run).map((folder) => ({ root: folder, added: true })),
    ];
  }
  private requests = new Map<
    string,
    { run: Run; event: AgentEvent; reply: (reply: Reply) => void }
  >();
  // Who else follows a run's events, by run id: a hand-off collecting its report.
  private watchers = new Map<string, (event: AgentEvent) => void>();
  constructor(
    private files: FileService,
    private emit: (event: AgentEvent) => void,
    private knowledge = new KnowledgeStore(files.dataDir, (ref) =>
      files.resolve(ref.scopeId, ref.path),
    ),
    private authorship = new AuthorshipStore(files.dataDir),
    private you?: YourAiService,
  ) {
    this.device = new DeviceIdentity(files.dataDir);
    this.attachments = new AttachmentStore(files.dataDir);
    void this.attachments.prune().catch(() => {});
    void pruneClaudeSkills(files.dataDir, (id) => this.runs.has(id)).catch(() => {});
    // Folders of hooks a run that did not end left for the Antigravity CLI (ADR 058).
    void pruneAntigravityHookFolders(files.dataDir, (id) => this.runs.has(id)).catch(() => {});
    void pruneCodexRoles(files.dataDir, (id) => this.runs.has(id)).catch(() => {});
    // An unwritable history is a whole-device fault, so every run stops.
    this.conversations = new ConversationStore(files.dataDir, this.device, () => {
      for (const run of [...this.runs.values()]) {
        this.publish(run, 'error', historyUnsaved());
        void this.stop(run);
      }
    });
  }
  /** Whether a run of the brain's own agent is in progress, apart from your AI's holds. */
  running(scopeId: string) {
    return this.scopeRuns(scopeId).length > 0;
  }
  /** Whether any run works in the space, its own or a sub-agent's: irori's own changes there wait. */
  busy(scopeId: string) {
    return this.scopeRuns(scopeId).length > 0 || this.delegated.has(scopeId);
  }
  private scopeRuns(scopeId: string) {
    return [...this.runs.values()].filter((run) => run.binding.scopeId === scopeId);
  }
  /** The run in progress in a conversation, if any. */
  private conversationRun(id: string) {
    return [...this.runs.values()].find((run) => run.conversationId === id);
  }
  /**
   * The folders on this device that the run's vaults show in contents through
   * links: a vault agent's own, or those of the vaults handed to the irori agent.
   */
  private localFolders(run: Run, writable?: boolean) {
    const scopes = run.delegation
      ? run.delegation.brains.map((brain) => brain.scopeId)
      : [run.binding.scopeId];
    return scopes.flatMap((scopeId) => this.files.cloud?.localFolders?.(scopeId, writable) ?? []);
  }
  /** Whether `scopeId` is your AI's own id rather than a brain's. */
  private isYou(scopeId: string) {
    return !!this.you?.rootOf(scopeId);
  }
  /**
   * The folder a run works in: a brain's root, or the irori agent's folder for
   * the run's workspace (ADR 044), the workspace on show without one.
   */
  private root(scopeId: string, workspace?: string) {
    return this.you?.rootOf(scopeId, workspace) ?? this.files.get(scopeId).root;
  }
  /** Whose conversation it is: a vault's, or the irori agent's. */
  private owner(scopeId: string): ConversationOwner {
    return conversationOwner(
      scopeId,
      this.isYou(scopeId) ? undefined : this.files.get(scopeId).name,
    );
  }
  get anyBusy() {
    return this.runs.size > 0;
  }
  runningScopes() {
    return [...new Set([...this.runs.values()].map((run) => run.binding.scopeId))];
  }
  private binding(scopeId: string, agent: AgentId, workspace?: string): SessionBinding {
    return { scopeId, agent, root: this.root(scopeId, workspace) };
  }
  /**
   * The workspace whose conversations an owner's view takes: the irori agent keeps
   * a history per workspace, a vault one history wherever it is opened (ADR 017 D4).
   */
  private historyOf(scopeId: string, workspace?: string) {
    return this.isYou(scopeId) ? workspace : undefined;
  }
  /** The owner's conversations for its history list. */
  async conversationList(scopeId: string, workspace?: string) {
    this.root(scopeId);
    return this.conversations.list(scopeId, this.historyOf(scopeId, workspace));
  }
  /** An id for the owner's next conversation; it is written with its first instruction. */
  createConversation(scopeId: string, agent: AgentId, workspace?: string) {
    this.root(scopeId);
    return this.conversations.reserve(scopeId, agent, this.historyOf(scopeId, workspace));
  }
  renameConversation(id: string, title: string) {
    return this.conversations.rename(id, title);
  }
  pinConversation(id: string, pinned: boolean) {
    return this.conversations.pin(id, pinned);
  }
  archiveConversation(id: string, archived: boolean) {
    return this.conversations.archive(id, archived);
  }
  async deleteConversation(id: string) {
    if ([...this.runs.values()].some((run) => run.conversationId === id))
      throw Error(stopBeforeDeleting());
    await this.conversations.remove(id);
    await this.attachments.removeConversation(id);
  }
  /**
   * A conversation and the requests its run is waiting on now. A request is kept
   * only as status text in the history, so a view opened while it waits takes the
   * live one from here. Without an id, the owner's conversation on show: the one
   * running, the one queued longest, or its latest with this CLI.
   */
  async conversation(
    scopeId: string,
    agent: AgentId,
    id?: string,
    workspace?: string,
  ): Promise<Conversation> {
    this.root(scopeId);
    const history = this.historyOf(scopeId, workspace);
    // A named irori agent conversation opens only in its own workspace (ADR 017 D4).
    if (
      id &&
      workspace !== undefined &&
      this.isYou(scopeId) &&
      !(await this.conversations.belongs(id, history))
    )
      throw Error(otherWorkspace());
    id ??= await this.conversations.current(scopeId, agent, history);
    const pending = await this.conversations.pending(scopeId, history);
    const reserved = id && this.conversations.reservation(id);
    if (!id || reserved) {
      if (reserved && reserved.owner !== scopeId) throw Error(notYours());
      return {
        id,
        events: [],
        queued: [],
        pending,
        earlier: 0,
        damaged: 0,
        session: { state: 'empty' },
      };
    }
    const value = await this.conversations.read(id);
    if (value.meta.owner.id !== scopeId) throw Error(notYours());
    const native = await this.conversations.native(id).catch(() => undefined);
    const active = value.activeRunId ? this.runs.get(value.activeRunId) : undefined;
    const requests = [
      ...[...this.requests.values()]
        .filter(({ run }) => run.conversationId === id && run.id === value.activeRunId)
        .map(({ event }) => event),
      // A hand-off's requests show with the irori agent's run that handed it.
      ...(active?.conversationId === id ? (active.forwarded?.values() ?? []) : []),
    ];
    return {
      id,
      summary: this.conversations.summary(value.meta),
      events: value.events,
      queued: value.queued,
      pending,
      earlier: value.earlier,
      damaged: value.damaged,
      activeRunId: value.activeRunId,
      requests,
      session: native?.entry ? { state: 'saved', access: native.entry.access } : { state: 'empty' },
      access: value.meta.access ?? native?.entry?.access,
    };
  }
  /** Where an instruction that names no conversation goes: the owner's latest with this CLI, or a new one. */
  private async placement(input: StartRun) {
    const placement: Placement = {
      owner: this.owner(input.scopeId),
      agent: input.agent,
      workspace: this.historyOf(input.scopeId, input.workspace),
    };
    if (input.conversationId) return { id: input.conversationId, placement };
    const latest = await this.conversations.latest(input.scopeId, input.agent, placement.workspace);
    return { id: latest ?? randomUUID(), placement: { ...placement, create: !latest } };
  }
  async queueMessage(input: StartRun) {
    input = startInput.parse(input);
    requireAgentAccess(input.agent, input.access);
    this.root(input.scopeId);
    if (this.isYou(input.scopeId)) refuseYourMaterials(input);
    const { id, placement } = await this.placement(input);
    await this.attachments.claim(input.attachments, id);
    return this.conversations.enqueue(id, placement, input);
  }
  removeQueued(conversationId: string, id: string) {
    return this.conversations.removeQueued(conversationId, id);
  }
  /** Instructions waiting across the owner's conversations (the irori agent's in `workspace`). */
  pending(scopeId: string, workspace?: string) {
    return this.conversations.pending(scopeId, this.historyOf(scopeId, workspace));
  }
  /**
   * Starts the oldest queued instruction of one of the owner's conversations
   * that is not running: of `conversationId` alone when it is given.
   */
  async startNextQueued(
    scopeId: string,
    conversationId?: string,
    canStart = () => {},
    workspace?: string,
  ) {
    const next = await this.conversations.nextQueued(
      scopeId,
      (id) => (!conversationId || id === conversationId) && !this.conversationRun(id),
      // A named conversation's queue is its own, in whichever workspace it is kept.
      conversationId
        ? this.conversations.workspaceOf(conversationId)
        : this.historyOf(scopeId, workspace),
    );
    // Another window may have started it while the queue was read (ADR 051).
    if (!next || this.conversationRun(next.conversationId)) return null;
    canStart();
    return this.startAccepted(
      { ...next.item, scopeId, agent: next.agent, conversationId: next.conversationId },
      next.item.id,
    );
  }
  async startAccepted(input: StartRun, queuedId?: string) {
    const id = this.start(input, queuedId);
    await this.runs.get(id)!.accepted;
    return id;
  }
  /**
   * Sends one queued instruction now, ahead of the rest of the queue (ADR 056).
   * A run in progress whose CLI takes words mid-turn, started as this instruction
   * asks, takes it at its next step and goes on. Otherwise the run is stopped and
   * the instruction starts at once; without a run it simply starts.
   */
  async sendNow(
    scopeId: string,
    conversationId: string,
    queuedId: string,
    canStart = () => {},
    workspace?: string,
  ): Promise<SentNow> {
    this.root(scopeId);
    if (this.sendingNow.has(conversationId))
      throw Error(t('送信中です。', 'An instruction is already being sent.'));
    this.sendingNow.add(conversationId);
    try {
      const { owner, item } = await this.conversations.queuedItem(conversationId, queuedId);
      if (owner !== scopeId) throw Error(notYours());
      // An irori agent conversation is reached only from its own workspace (ADR 017 D4).
      if (
        workspace !== undefined &&
        this.isYou(scopeId) &&
        !(await this.conversations.belongs(conversationId, workspace))
      )
        throw Error(otherWorkspace());
      const run = this.conversationRun(conversationId);
      if (run && (run.step || run.holder)) throw Error(notTheirs());
      if (run && this.joins(run, item)) {
        const steer = await run.steering.ready();
        if (steer && this.runs.has(run.id)) {
          const words = await this.steerWords(run, item);
          // Taken from the queue first, so nothing else starts it while the CLI is asked.
          const queued = await this.conversations.removeQueued(conversationId, item.id);
          if (!run.cancelled && (await steer(words).catch(() => false))) {
            this.flushText(run);
            this.record(
              run,
              this.publish(run, 'status', item.prompt, { role: 'user', id: randomUUID() }),
            );
            return { queued, runId: run.id, steered: true };
          }
          await this.conversations.returnQueued(conversationId, item);
        }
      }
      canStart();
      await this.conversations.promoteQueued(conversationId, item.id);
      const current = this.conversationRun(conversationId);
      if (current) await this.stop(current);
      const runId = await this.startNextQueued(scopeId, conversationId, canStart, workspace);
      const queued = await this.conversations.queuedItems(conversationId);
      return { queued, runId, steered: false };
    } finally {
      this.sendingNow.delete(conversationId);
    }
  }
  /**
   * Whether an instruction can join a run in progress: it asks for nothing the run
   * was not started with (access, model, level, vaults) and nothing that goes only
   * with a request of its own (a skill, other materials, files, the person's lines,
   * a CLI command).
   */
  private joins(run: Run, item: QueuedMessage) {
    const asked = run.input;
    const same = (a?: string, b?: string) => (a || '') === (b || '');
    const set = (values: string[] = []) => JSON.stringify([...new Set(values)].sort());
    const sources = (refs: StartRun['sources'] = []) =>
      set(refs.map((ref) => JSON.stringify([ref.scopeId, ref.path])));
    let access: AgentAccess;
    try {
      access = requireAgentAccess(run.binding.agent, item.access);
    } catch {
      return false;
    }
    return (
      access === run.access &&
      same(item.model, asked.model) &&
      same(item.effort, asked.effort) &&
      same(item.workspace, asked.workspace) &&
      set(item.brains) === set(asked.brains) &&
      sources(item.sources) === sources(asked.sources) &&
      !item.skill &&
      !item.attachments?.length &&
      (!item.personLines || (!!asked.personLines && item.notePath === asked.notePath)) &&
      !commandWords.test(item.prompt)
    );
  }
  /**
   * Rewinds a conversation to before one of the person's messages that started a
   * run (ADR 017 D6): that message and what followed are set aside, and the next
   * turn goes on from before it. Answers the message, to be edited and sent again.
   */
  async rewind(scopeId: string, conversationId: string, eventId: string, workspace?: string) {
    await this.owned(scopeId, conversationId, workspace);
    if (this.conversationRun(conversationId)) throw Error(alreadyRunning());
    return this.conversations.rewind(conversationId, eventId);
  }
  /**
   * Copies a conversation through the end of the run `eventId` belongs to into a
   * new conversation of the same owner and CLI (ADR 017 D6); answers its id.
   */
  async fork(scopeId: string, conversationId: string, eventId: string, workspace?: string) {
    await this.owned(scopeId, conversationId, workspace);
    const id = randomUUID();
    await this.conversations.fork(conversationId, eventId, id, (refs) =>
      this.attachments.copy(refs, id),
    );
    return id;
  }
  /** Refuses a conversation that is not the owner's, or not in the irori agent's workspace. */
  private async owned(scopeId: string, conversationId: string, workspace?: string) {
    this.root(scopeId);
    const meta = await this.conversations.meta(conversationId);
    if (meta.owner.id !== scopeId) throw Error(notYours());
    if (
      workspace !== undefined &&
      this.isYou(scopeId) &&
      !(await this.conversations.belongs(conversationId, workspace))
    )
      throw Error(otherWorkspace());
  }
  /** The words a run in progress takes: the note now open when it changed, then the person's. */
  private async steerWords(run: Run, item: QueuedMessage) {
    if (!item.notePath || item.notePath === run.input.notePath) return item.prompt;
    await this.files.resolve(run.binding.scopeId, item.notePath);
    return `${selectedNote(item.notePath)}\n\n${item.prompt}`;
  }
  /** Sends and writes what every run has streamed so far, then writes the histories. */
  flush() {
    for (const run of this.runs.values()) this.flushText(run);
    return this.conversations.flush();
  }
  /** The models the installed CLI offers, read once per CLI version. */
  models(agent: AgentId) {
    return this.catalog.models(agent);
  }
  /** What the installed CLI runs as `/name` in this owner's folder (ADR 040). */
  async commands(scopeId: string, agent: AgentId) {
    const root = this.root(scopeId);
    // Listing starts the CLI; a folder's own settings join only once they are allowed.
    const own = await this.configApprovals().isAllowed(agent, [{ root }]);
    return this.commandCatalog.commands(agent, root, own);
  }
  async available(): Promise<AgentInfo[]> {
    return Promise.all(
      agentIds.map(async (id) => {
        try {
          const v = await version(agentCommand(id));
          return {
            id,
            version: v,
            available: true,
            tested:
              id === 'codex'
                ? v.includes('0.154.0')
                : id === 'claude'
                  ? v.includes('2.1.232')
                  : false,
            detail: '',
          };
        } catch (e) {
          return { id, version: '', available: false, tested: false, detail: String(e) };
        }
      }),
    );
  }
  start(
    input: StartRun,
    queuedId?: string,
    holder?: string,
    step?: StepRun,
    title?: string,
  ): string {
    input = startInput.parse(input);
    const access = requireAgentAccess(input.agent, input.access);
    if (holder !== undefined && !this.delegated.get(input.scopeId)?.has(holder))
      throw Error('This vault is not handed to that run.');
    if (input.conversationId && this.conversationRun(input.conversationId))
      throw Error(alreadyRunning());
    if (!input.prompt.trim() || input.prompt.length > promptLimit)
      throw Error('Enter an instruction (up to 32,000 characters)');
    this.root(input.scopeId);
    const brains = [...new Set(input.brains ?? [])];
    if (this.isYou(input.scopeId)) {
      refuseYourMaterials(input);
      for (const scopeId of brains) this.files.get(scopeId);
    } else if (brains.length || input.workspace) throw Error('Only the irori agent takes vaults');
    let close!: () => void;
    let accept!: () => void;
    let reject!: (error: unknown) => void;
    const accepted = new Promise<void>((resolve, fail) => {
      accept = resolve;
      reject = fail;
    });
    // Direct service callers can observe failure through events instead of awaiting acceptance.
    void accepted.catch(() => {});
    const closed = new Promise<void>((resolve) => {
      close = resolve;
    });
    const run: Run = {
      id: randomUUID(),
      binding: this.binding(input.scopeId, input.agent, input.workspace),
      // A routine's step is a conversation of its own, named at once so its record can open it.
      conversationId: step ? randomUUID() : input.conversationId,
      access,
      input,
      steering: new Steering(),
      holder,
      step,
      queuedId,
      reached: new Set(),
      heard: {},
      sent: {},
      reply: new Tail(20_000),
      later: [],
      pending: new Set(),
      title,
      accepted,
      accept,
      reject,
      cancelled: false,
      abort: new AbortController(),
      closed,
      close,
    };
    this.runs.set(run.id, run);
    for (const scopeId of brains)
      this.delegated.set(scopeId, (this.delegated.get(scopeId) ?? new Set()).add(run.id));
    // Let the IPC caller bind the returned run id before first events arrive.
    setTimeout(() => void this.execute(run, input), 0);
    return run.id;
  }
  private event(run: Run, type: AgentEvent['type'], text: string, extra: Partial<AgentEvent> = {}) {
    if (type === 'text' || type === 'tool') run.progressed = true;
    // The agent's last message, for a Stop hook: its words since its last tool call.
    if (type === 'tool') run.reply.clear();
    if (type === 'text' && !extra.role) run.reply.add(text);
    // A reply's deltas go to the views and the history a few at a time, in one
    // piece per window; any other event of the run goes after what came before it.
    if (type === 'text' && !Object.keys(extra).length) {
      if (run.ended) return;
      if (run.pendingText) {
        run.pendingText.text += text;
        return;
      }
      run.pendingText = {
        id: (run.textId ??= randomUUID()),
        text,
        timer: setTimeout(() => this.flushText(run), textWindow),
      };
      return;
    }
    this.record(run, this.publish(run, type, text, extra));
  }
  /** Sends and records the text a run has streamed since its last event. */
  private flushText(run: Run) {
    const pending = run.pendingText;
    if (!pending) return;
    run.pendingText = undefined;
    clearTimeout(pending.timer);
    this.record(run, this.publish(run, 'text', pending.text, { id: pending.id }));
  }
  private record(run: Run, event: AgentEvent) {
    if (!run.recorded || !run.conversationId) return;
    if (event.delegate?.state === 'started') run.reached.add(event.delegate.scopeId);
    try {
      this.conversations.event(run.conversationId, event);
    } catch {
      this.publish(run, 'error', historyUnsaved());
      void this.stop(run);
    }
  }
  /**
   * Sends an event to the views. Each gets an id the saved conversation keeps; a
   * streamed reply keeps one id until another kind of event comes. Views get at
   * most `viewDetails` of a tool's details; the conversation keeps up to 1 MiB.
   */
  private publish(
    run: Run,
    type: AgentEvent['type'],
    text: string,
    extra: Partial<AgentEvent> = {},
  ) {
    if (type !== 'text') this.flushText(run);
    const id = extra.id ?? (type === 'text' ? (run.textId ??= randomUUID()) : randomUUID());
    if (type !== 'text') run.textId = undefined;
    const event: AgentEvent = {
      id,
      conversationId: run.conversationId,
      runId: run.id,
      scopeId: run.binding.scopeId,
      agent: run.binding.agent,
      type,
      text,
      ...extra,
    };
    const shown =
      event.details && event.details.length > viewDetails
        ? { ...event, details: event.details.slice(0, viewDetails) }
        : event;
    this.emit(shown);
    this.watchers.get(run.id)?.(shown);
    return event;
  }
  private ask(
    run: Run,
    text: string,
    details: unknown,
    questions?: Question[],
    extra: Partial<AgentEvent> = {},
  ): Promise<Reply> {
    if (run.cancelled) return Promise.resolve({ allow: false });
    // A question irori asks before the CLI starts is not the agent's doing.
    if (run.sending) run.progressed = true;
    // Notification hooks hear that the person is asked, as in Claude Code (ADR 058).
    run.hooks?.notification(text, questions ? 'elicitation_dialog' : 'permission_prompt');
    const requestId = randomUUID();
    return new Promise((resolve) => {
      // Registered before it is published, since an answer can arrive at once.
      const pending = { run, event: undefined as unknown as AgentEvent, reply: resolve };
      this.requests.set(requestId, pending);
      pending.event = this.publish(run, questions ? 'question' : 'permission', text, {
        requestId,
        details: shownRequest(JSON.stringify(details, null, 2)),
        questions,
        ...extra,
      });
      this.record(run, pending.event);
    });
  }
  respond(id: string, allow: boolean, answers?: AgentAnswers) {
    const pending = this.requests.get(id);
    if (!pending) throw Error('This request has already ended');
    this.requests.delete(id);
    pending.reply({ allow, answers });
    this.publish(pending.run, 'status', '', { resolved: id });
  }
  /** Denies and forgets every request one run is waiting on, leaving other runs' requests alone. */
  private denyRequests(run: Run) {
    for (const [id, pending] of [...this.requests]) {
      if (pending.run !== run) continue;
      this.requests.delete(id);
      pending.reply({ allow: false });
      this.publish(run, 'status', '', { resolved: id });
    }
  }
  /** Stops the runs in a space, or that of one of its conversations; with neither, every run. */
  async cancel(scopeId?: string, conversationId?: string) {
    await Promise.all(
      [...this.runs.values()]
        .filter(
          (run) =>
            (scopeId === undefined || run.binding.scopeId === scopeId) &&
            (conversationId === undefined || run.conversationId === conversationId),
        )
        .map((run) => this.stop(run)),
    );
  }
  private async stop(run: Run) {
    run.cancelled = true;
    run.steering.close();
    run.abort.abort();
    this.denyRequests(run);
    await this.cancelHeld(run);
    if (run.rpc && run.threadId && run.turnId)
      run.rpc.send({
        id: 0,
        method: 'turn/interrupt',
        params: { threadId: run.threadId, turnId: run.turnId },
      });
    if (run.child) await killTree(run.child);
    run.finish?.();
    await run.closed;
  }
  /** Stops one run by its id while it is still running. */
  async cancelRun(runId: string) {
    const run = this.runs.get(runId);
    if (run) await this.stop(run);
  }
  /**
   * Starts a routine's agent step (ADR 016 D7): an ordinary run, shown in its
   * conversation as it goes. `done` resolves when it ends, with its report.
   */
  startStep(
    input: StartRun,
    step: StepRun,
  ): { runId: string; conversationId: string; done: Promise<StepEnd> } {
    const runId = this.start(input, undefined, undefined, step);
    const conversationId = this.runs.get(runId)!.conversationId!;
    const report = new Tail(reportLimit);
    let after = true;
    const errors: string[] = [];
    const done = new Promise<StepEnd>((resolve) => {
      // Registered before the run's first event, which waits for the next tick.
      this.watchers.set(runId, (event) => {
        if (event.type === 'text') {
          if (after) report.clear();
          after = false;
          report.add(event.text);
          return;
        }
        after = true;
        if (event.type === 'error') errors.push(event.text);
        if (event.type !== 'done') return;
        this.watchers.delete(runId);
        resolve({
          outcome: event.outcome ?? 'failed',
          report: report.toString(),
          error: errors.at(-1),
        });
      });
    });
    return { runId, conversationId, done };
  }
  /** The conversation a run goes to, and how a new one is made (ADR 017 D2, D4). */
  private async place(run: Run, input: StartRun): Promise<{ id: string; placement: Placement }> {
    const placement: Placement = {
      owner: this.owner(input.scopeId),
      agent: input.agent,
      workspace: this.historyOf(input.scopeId, input.workspace),
      title: run.title,
    };
    if (run.step)
      return {
        id: run.conversationId!,
        placement: {
          ...placement,
          create: true,
          title: run.step.notice,
          titleSource: 'routine',
          ...(run.step.routine && { routine: run.step.routine }),
        },
      };
    const holder = run.holder && this.runs.get(run.holder);
    if (holder && holder.conversationId) {
      // Work handed from one of the irori agent's conversations continues in one
      // conversation of the vault, apart from the person's own.
      const from = holder.conversationId;
      const found = await this.conversations.handed(input.scopeId, input.agent, from);
      return {
        id: found ?? randomUUID(),
        placement: { ...placement, create: !found, handedBy: { conversationId: from } },
      };
    }
    const placed = await this.placement(input);
    return { id: placed.id, placement: { ...placed.placement, title: run.title } };
  }
  /**
   * Keeps the CLI's session handle for this device, unless the run is a routine's
   * step. What the session heard stays with it only while it is the session the
   * run went on from: one the CLI starts anew or forks has heard nothing of this
   * run's request until the run shows the CLI got it (`rememberHeard`, ADR 058).
   */
  private async saveSession(run: Run, handle: string) {
    if (run.step || !run.conversationId || !run.root) return;
    const same = handle === run.resumed;
    await this.conversations.saveNative(run.conversationId, {
      handle,
      access: run.access,
      root: run.root,
      ...(same && heardDigests(run.heard)),
      ...(same && run.source === 'compact' && { compacted: true as const }),
    });
  }
  /**
   * Records what the session heard of this run's request (ADR 058). The digests
   * of what it was given count as heard only once the run shows the CLI got the
   * request: it answered, used a tool or asked. A compaction during the run
   * forgets them all, so the next request gives everything whole again.
   */
  private async rememberHeard(run: Run) {
    if (run.step || !run.conversationId || !run.recorded) return;
    if (!run.compacted && !run.progressed) return;
    const { entry } = await this.conversations.native(run.conversationId);
    if (!entry) return;
    const {
      shared: _shared,
      intro: _intro,
      schema: _schema,
      instructions: _instructions,
      compacted: _compacted,
      ...rest
    } = entry;
    await this.conversations.saveNative(run.conversationId, {
      ...rest,
      ...(run.compacted ? { compacted: true as const } : heardDigests(run.sent)),
    });
  }
  /**
   * One part irori says once per native session (ADR 027, 039, 057): whole on a
   * new session, after a change or a compaction; otherwise the line that stands
   * for it; and, when it is gone, the line saying so to a session that heard it.
   */
  private said(
    run: Run,
    key: keyof Heard,
    part: { words: string; pointer: string } | undefined,
    removed?: string,
  ): string[] {
    if (part) {
      const value = digest(part.words);
      run.sent[key] = value;
      return [
        run.resumed && run.pointers !== false && run.heard[key] === value
          ? part.pointer
          : part.words,
      ];
    }
    return run.resumed && run.heard[key] && removed ? [removed] : [];
  }
  /** The folder a vault's agents work in, made when it is the default; none when it cannot be. */
  private async work(scopeId: string) {
    return this.workFolder?.(scopeId).catch((error) => {
      console.warn('Work folder unavailable', String(error));
      return undefined;
    });
  }
  /**
   * A vault agent's introduction and the line that stands for it (ADR 039). A
   * work folder outside the vault is one the run may change too.
   */
  private async vaultIntro(scopeId: string, commands: boolean, run: Run) {
    const vault = this.files.get(scopeId);
    const work = await this.work(scopeId);
    const inside = work !== undefined && within(vault.root, work);
    if (work && !inside) run.work = [work];
    const instructions = await fs
      .stat(path.join(vault.root, 'AGENTS.md'))
      .then((stat) => stat.isFile())
      .catch(() => false);
    return {
      words: vaultIntro(
        {
          ...vault,
          instructions,
          // Searches that walk the vault skip the links its connected folders appear through.
          linked: this.files.cloud?.linkedFolders?.(scopeId),
          readOnly: this.files.cloud?.linkedPaths?.(scopeId, false),
          work:
            work &&
            (inside ? `${path.relative(vault.root, work).split(path.sep).join('/')}/` : work),
        },
        commands,
      ),
      pointer: vaultIntroPointer(vault.name, commands),
    };
  }
  /**
   * Gives Claude Code the skills it does not find itself: those of the folder's
   * `.agents/skills`, then the shared Schema's, as links in a folder it is given
   * (ADR 049). A name the folder's `.claude/skills` holds is Claude Code's own.
   * A failure leaves the skills to the words, as before, and says so.
   */
  private async linkSkills(
    run: Run,
    input: StartRun,
    you: boolean,
    root: string,
    shared: Awaited<ReturnType<YourAiService['shared']>>,
  ) {
    try {
      const folder = you
        ? await this.you!.schemaFolder(input.workspace)
        : spaceFolder(this.files, input.scopeId);
      const own = await readFolderSkills(folder);
      const skills: LinkedSkill[] = [
        ...own.skills.map((skill) => ({
          name: skill.name,
          folder: path.dirname(path.join(folder.root, skill.path)),
        })),
        ...(shared?.skills ?? []).map((skill) => ({
          name: skill.name,
          folder: path.dirname(skill.path),
        })),
      ];
      // A retired name stays retired: the shared skill of that name does not stand in.
      const skip = new Set([
        ...(await claudeSkillNames(root)),
        ...own.retired.map((skill) => skill.name),
      ]);
      run.claudeSkills = await linkClaudeSkills(this.files.dataDir, run.id, skills, skip);
    } catch (error) {
      this.event(
        run,
        'status',
        t(
          `スキルを Claude Code に渡せませんでした: ${String(error)}`,
          `Could not give the skills to Claude Code: ${String(error)}`,
        ),
      );
    }
  }
  /**
   * What this CLI loads itself of the Schema of `root` (ADR 058): its row of the
   * table, where a file beside AGENTS.md that the CLI reads instead turns
   * AGENTS.md into irori's to give, and, for Claude Code, whether its version
   * reads AGENTS.md and whether a CLAUDE.md would keep it from doing so.
   */
  private async reachFor(
    agent: AgentId,
    root: string,
  ): Promise<SchemaReach & { claudeMd?: boolean }> {
    const row = schemaReach[agent];
    const isFile = (file: string) =>
      fs.stat(file).then(
        (stat) => stat.isFile(),
        () => false,
      );
    let instructions = row.instructions;
    if (
      instructions.hiddenBy &&
      (await Promise.all(instructions.hiddenBy.map((name) => isFile(path.join(root, name))))).some(
        Boolean,
      )
    )
      instructions = { ...instructions, reads: false };
    if (agent !== 'claude') return { ...row, instructions };
    // Claude Code reads AGENTS.md from 2.1.277 on. The version is the one irori
    // listed the CLIs with; an unknown one is taken to be current.
    const found = (await knownVersion('claude'))?.match(/(\d+)\.(\d+)\.(\d+)/);
    if (found && !atLeast(found.slice(1).map(Number), [2, 1, 277]))
      return { ...row, instructions: { reads: false } };
    // Claude Code reads AGENTS.md only where no CLAUDE.md is in the folder or above it.
    let claudeMd = false;
    for (let dir = root; !claudeMd; dir = path.dirname(dir)) {
      for (const name of ['CLAUDE.md', path.join('.claude', 'CLAUDE.md'), 'CLAUDE.local.md'])
        if (await isFile(path.join(dir, name))) claudeMd = true;
      if (path.dirname(dir) === dir) break;
    }
    return { ...row, instructions, claudeMd };
  }
  /**
   * The parts of the folder's Schema this CLI does not load itself, as words
   * (ADR 058): its rules unless it is Claude Code, its AGENTS.md when the CLI
   * does not read it or keeps only part of it, the AGENTS.md of folders below it,
   * and its skills when the CLI may not find them. For a CLI whose session keeps
   * the AGENTS.md it began with, `instructions` is what a changed one is given as.
   */
  private async folderSchemaParts(input: StartRun, you: boolean, reach: SchemaReach) {
    const folder = you
      ? await this.you!.schemaFolder(input.workspace)
      : spaceFolder(this.files, input.scopeId);
    const parts = await readSchemaParts(folder);
    const given = !reach.instructions.reads ? parts.instructions : undefined;
    const fitted = fitParts(given, reach.rules ? [] : parts.rules);
    const prompt: FolderSchemaPrompt = {
      root: folder.root,
      cli: agentNames[input.agent],
      nested: [],
      rules: fitted.rules,
      skills: [],
    };
    if (given)
      prompt.instructions = fitted.instructions
        ? { file: parts.file, text: fitted.instructions }
        : { file: parts.file };
    else if (
      parts.instructions &&
      reach.instructions.limit &&
      parts.bytes > reach.instructions.limit
    )
      prompt.instructions = { file: parts.file, limit: reach.instructions.limit };
    if (!reach.nested && folder.knowledge && !you)
      prompt.nested = (await this.nestedInstructions?.(input.scopeId).catch(() => [])) ?? [];
    // The shared Schema's skills are listed with it; the folder's own win a name both have.
    if (!reach.skills) prompt.skills = parts.skills;
    const instructions =
      reach.instructions.reads && reach.instructions.stale && parts.instructions
        ? {
            digest: digest(parts.instructions),
            words: folderInstructionsChanged(
              parts.file,
              Buffer.byteLength(parts.instructions, 'utf8') <= schemaInline
                ? parts.instructions
                : undefined,
            ),
          }
        : undefined;
    return {
      ...(folderSchemaHasParts(prompt) && {
        part: { words: folderSchema(prompt), pointer: folderSchemaPointer(folder.root) },
      }),
      instructions,
    };
  }
  /**
   * For a CLI whose session keeps the AGENTS.md it began with (ADR 058): a
   * session that goes on after the folder's instructions changed hears them
   * again; a new session read them itself.
   */
  private refreshed(run: Run, instructions?: { digest: string; words: string }) {
    if (!instructions) return [];
    run.sent.instructions = instructions.digest;
    return run.resumed && run.heard.instructions !== instructions.digest
      ? [instructions.words]
      : [];
  }
  /**
   * The Schema's hooks for a CLI that does not run them itself (ADR 058): the
   * shared Schema's and those of the folder's `.claude/settings.json`, run by
   * irori; and what the person allows before they run, as for a vault's own
   * configuration. A folder's hooks irori cannot read stop the run: one may be a guard.
   */
  private async schemaHooks(run: Run, input: StartRun, root: string) {
    const list: SchemaHook[] = [];
    const approvals: FoundConfig[] = [];
    const shared = await this.you?.sharedHooks().catch((error) => {
      throw Error(
        t(
          `共通 Schema のフックを読めませんでした: ${String(error)}`,
          `Could not read the shared Schema's hooks: ${String(error)}`,
        ),
      );
    });
    if (shared) {
      list.push(...schemaHooks(shared, 'shared'));
      approvals.push({
        root: 'shared-schema-hooks',
        label: t('共通 Schema のフック', "The shared Schema's hooks"),
        files: Object.keys(shared),
        digest: digest(JSON.stringify(shared)),
      });
    }
    const own = await folderHooks(root).catch((error) => {
      throw Error(
        t(
          `このフォルダの .claude/settings.json のフックを読めませんでした: ${String(error)}`,
          `Could not read the hooks in this folder's .claude/settings.json: ${String(error)}`,
        ),
      );
    });
    if (own.length) {
      list.push(...own);
      approvals.push({
        // irori runs them for every CLI but Claude Code, which asks of its own.
        root: `schema-hooks:${root}`,
        label: t('このフォルダの Schema のフック', "This folder's Schema hooks"),
        files: [path.join(root, claudeSettingsFile)],
        digest: digest(JSON.stringify(own)),
      });
    }
    if (!list.length) return undefined;
    const runner = new SchemaHookRunner(list, {
      cwd: root,
      env: runEnv(run),
      agent: input.agent,
      fields: () => ({
        session_id: run.nativeHandle ?? run.resumed ?? '',
        transcript_path: '',
        cwd: root,
        permission_mode: run.access === 'full-access' ? 'bypassPermissions' : 'default',
      }),
      signal: run.abort.signal,
    });
    const hooks = new RunHooks(runner, input.agent, {
      status: (text) => this.event(run, 'status', text),
      ask: async (text, details) => (await this.ask(run, text, details)).allow,
      halt: (reason) => {
        if (run.halted) return;
        run.halted = reason;
        this.event(
          run,
          'status',
          t(`フックが実行を止めました: ${reason}`, `A hook stopped the run: ${reason}`),
        );
        void this.stop(run);
      },
    });
    return { run: hooks, approvals };
  }
  /**
   * Hooks of events this CLI cannot run (ADR 058): the person decides whether
   * the run goes on without them. A routine's step, which no one answers, does not.
   */
  private async acceptMissingHooks(run: Run, agent: AgentId, hooks: RunHooks) {
    if (agent === 'claude') return true;
    const runs = new Set(hookEvents[agent]);
    const missing = hooks.runner.events().filter((event) => !runs.has(event));
    if (!missing.length) return true;
    const words = t(
      `${agentNames[agent]} では、Schema のフックのうち ${missing.join(', ')} を実行できません。`,
      `${agentNames[agent]} cannot run the Schema's ${missing.join(', ')} hooks.`,
    );
    if (run.step)
      throw Error(
        `${words}${t(
          'ルーティンのステップは確認できないため実行しませんでした。',
          ' A routine step cannot ask, so it did not run.',
        )}`,
      );
    const allowed = await this.ask(
      run,
      `${words}${t('これらのフックなしで実行しますか？', ' Run without these hooks?')}`,
      { cli: agentNames[agent], hooks: missing },
    );
    if (allowed.allow)
      this.event(
        run,
        'status',
        t(
          `${missing.join(', ')} のフックなしで実行します。`,
          `Running without the ${missing.join(', ')} hooks.`,
        ),
      );
    return allowed.allow;
  }
  /**
   * What the run's CLI is started with besides the request, made once per run
   * (ADR 058, 049): the person's-lines notice and the Schema's hooks through
   * the CLI's plugin, extension or own hooks; Pi's skills; for Codex, how much
   * of AGENTS.md it keeps.
   */
  private async cliSetup(run: Run, input: StartRun, root: string): Promise<CliSetup> {
    const setup: CliSetup = { args: [], folders: [], closers: [] };
    const agent = input.agent;
    let env = run.env ?? agentEnv();
    const hooks = run.hooks;
    const tools = hooks?.runner
      .events()
      .some((event) => ['PreToolUse', 'PostToolUse', 'PreCompact', 'SubagentStop'].includes(event));
    const answer = (event: BridgeEvent) => hooks!.answer(event);
    if (hooks && tools && (agent === 'pi' || agent === 'opencode')) {
      const bridge = await hookBridge(this.files.dataDir, agent, answer, env);
      env = bridge.env;
      setup.args.push(...bridge.args);
      setup.closers.push(bridge.close);
    }
    if (hooks && tools && (agent === 'codex' || agent === 'antigravity')) {
      const bridge = await forwardedHookBridge(this.files.dataDir, agent, answer);
      setup.closers.push(bridge.close);
      setup.forwarded = bridge;
      if (agent === 'antigravity') {
        const folder = await antigravityHookFolder(
          this.files.dataDir,
          run.id,
          bridge.launcher,
          bridge.url,
        );
        setup.folders.push(folder);
        setup.closers.push(() => void rm(folder, { recursive: true, force: true }).catch(() => {}));
      } else
        setup.codexHooks = hooks.runner
          .events()
          .filter((event) =>
            ['PreToolUse', 'PostToolUse', 'PreCompact', 'SubagentStop'].includes(event),
          );
    }
    if (agent === 'pi' || agent === 'opencode') {
      // The same word Claude Code gets from its hook, through each CLI's own
      // hook: which of the person's lines a file tool call would change.
      const delegation = run.delegation;
      const lines = await personLinesBridge(
        this.files.dataDir,
        agent,
        async (tool, edit) => {
          if (!delegation)
            return personLinesNotice(this.files, this.authorship, input.scopeId, tool, edit);
          // Your AI names a brain's file by its absolute path.
          const file = editedPath(edit);
          const brain = file && path.isAbsolute(file) ? brainOfPath(delegation, file) : undefined;
          return brain
            ? personLinesNotice(this.files, this.authorship, brain.scopeId, tool, edit)
            : undefined;
        },
        env,
      );
      env = lines.env;
      setup.args.push(...lines.args);
      setup.closers.push(lines.close);
    }
    // Pi finds a folder's skills only in a trusted project; irori names each skill (ADR 058).
    if (agent === 'pi')
      setup.args.push(...(await this.piSkills(input)).flatMap((dir) => ['--skill', dir]));
    setup.env = env;
    return setup;
  }
  /** The skill folders Pi is given: the folder's own, then the shared Schema's whose names it lacks. */
  private async piSkills(input: StartRun) {
    const you = this.isYou(input.scopeId);
    try {
      const folder = you
        ? await this.you!.schemaFolder(input.workspace)
        : spaceFolder(this.files, input.scopeId);
      const own = await readFolderSkills(folder);
      const taken = new Set([
        ...own.skills.map((skill) => skill.name),
        ...own.retired.map((skill) => skill.name),
      ]);
      const shared = (await this.you?.shared().catch(() => undefined))?.skills ?? [];
      return [
        ...own.skills.map((skill) => path.dirname(path.join(folder.root, skill.path))),
        ...shared
          .filter((skill) => !taken.has(skill.name))
          .map((skill) => path.dirname(skill.path)),
      ];
    } catch {
      return [];
    }
  }
  /**
   * Runs one turn of the run's CLI in `root`: the request, in the session it
   * goes on with. A Stop hook's next turn comes here again, in the same session.
   */
  private async runCli(
    run: Run,
    input: StartRun,
    root: string,
    prompt: string,
    session: string | undefined,
    branch: string | undefined,
    effort: string | undefined,
  ) {
    // A turn after the first starts its CLI anew; the last one is done.
    if (run.child) {
      await killTree(run.child).catch(() => {});
      run.child = undefined;
    }
    run.rpc?.fail(Error('Turn finished'));
    run.rpc = undefined;
    if (input.agent === 'claude')
      return this.claude(run, root, prompt, session, input.model, effort, branch);
    const setup = (run.setup ??= await this.cliSetup(run, input, root));
    if (input.agent === 'codex')
      try {
        return await this.codex(run, root, prompt, session, input.model, effort, branch, setup);
      } catch (error) {
        if (!(error instanceof CodexHooksAgain)) throw error;
        if (run.child) await killTree(run.child).catch(() => {});
        (run.rpc as Rpc | undefined)?.fail(Error('Codex started again'));
        // A new thread had no turn; the next one starts anew in its place.
        return this.codex(
          run,
          root,
          prompt,
          session ?? undefined,
          input.model,
          effort,
          branch,
          setup,
        );
      }
    const forwarded = setup.forwarded;
    const context: NativeContext = {
      cwd: root,
      prompt,
      session,
      access: run.access,
      model: input.model,
      effort,
      attached: run.attached,
      env: runEnv(run, setup.env ?? run.env),
      args: setup.args,
      folders: setup.folders,
      signal: run.abort.signal,
      child: (child) => {
        run.child = child;
      },
      event: (type, text, extra) => this.event(run, type, text, extra),
      ask: (text, details, questions) => this.ask(run, text, details, questions),
      saveSession: async (handle) => {
        run.handle = handle;
        await this.saveSession(run, handle);
      },
      compacted: () => {
        run.compacted = true;
      },
      // The Antigravity CLI's tool calls go through irori's hooks only once its
      // hooks have handed irori an event; a call before that stops the run.
      toolStarted: () =>
        forwarded && !forwarded.state.heard
          ? t(
              'Antigravity CLI が irori のフックを読み込まなかったため、Schema のフックを通らないツール実行の前に止めました。',
              "The Antigravity CLI did not load irori's hooks, so the run stopped before a tool call the Schema's hooks could not see.",
            )
          : undefined,
      // Hermes Agent hands irori a call once it ran: its PostToolUse hooks run
      // then, and what they say goes with the next turn (ADR 058).
      toolFinished:
        input.agent === 'hermes' && run.hooks
          ? (call) => {
              const job = run
                .hooks!.answer({
                  event: 'PostToolUse',
                  tool: call.tool,
                  input: call.input,
                  call: call.id,
                  output: call.output,
                })
                .then((reply) => {
                  if (reply.feedback) run.later.push(reply.feedback);
                })
                .catch(() => {});
              run.pending.add(job);
              void job.finally(() => run.pending.delete(job));
            }
          : undefined,
    };
    if (input.agent === 'pi') await runPi(context);
    else if (input.agent === 'opencode') await runOpenCode(context);
    else if (input.agent === 'antigravity') await runAntigravity(context);
    else await runHermes(context);
  }
  /**
   * After a turn of a CLI irori runs hooks for (ADR 058): Stop hooks decide
   * whether the turn may end, as in Claude Code, and at most `stopHookCap` times
   * in a row keep it going; what Hermes Agent's PostToolUse hooks said during
   * its turn goes with the next. Each next turn is a request in the same session.
   */
  private async afterTurn(run: Run, input: StartRun, root: string, effort: string | undefined) {
    let active = false;
    for (let round = 0; !run.cancelled && !run.halted; round++) {
      await Promise.all([...run.pending]);
      const said = run.later.splice(0);
      const reason = await run.hooks!.stop(active, run.reply.toString());
      if (run.cancelled || run.halted) return;
      const words = [
        ...(said.length ? [hookToolFeedback('PostToolUse', said)] : []),
        ...(reason ? [stopHookContinue(reason)] : []),
      ];
      if (!words.length) return;
      // As Claude Code does with Stop hooks, at most so many turns in a row.
      if (round >= stopHookCap) {
        this.event(
          run,
          'status',
          t(
            `フックが ${stopHookCap} 回続けてターンを続けさせたため、Claude Code と同じくここで終えます。`,
            `Hooks kept the turn going ${stopHookCap} times in a row, so it ends here, as in Claude Code.`,
          ),
        );
        return;
      }
      const { entry } = await this.conversations.native(run.conversationId!);
      const session = run.step ? run.handle : (entry?.handle ?? run.handle);
      if (!session) {
        this.event(
          run,
          'status',
          t(
            'セッションを続けられないため、フックの言葉を伝えられませんでした。',
            'The session cannot go on, so what the hooks said could not be passed on.',
          ),
        );
        return;
      }
      this.event(
        run,
        'status',
        reason
          ? t('Stop フックの指示で続けます。', 'Going on as a Stop hook asks.')
          : t('フックの言葉を伝えて続けます。', 'Going on with what the hooks said.'),
      );
      active = active || !!reason;
      run.reply.clear();
      await this.runCli(run, input, root, words.join('\n\n'), session, undefined, effort);
    }
  }
  /**
   * The folder's sub-agent definitions in every format, so that they work on
   * whichever CLI runs there (ADR 050). The CLI loads its own format itself;
   * the others irori gives it: Claude Code as the SDK's agents, Codex as roles in
   * its configuration, OpenCode as agents in its configuration content. A
   * vault's definition of its own agent is not one of its sub-agents, and the
   * `vault-` definitions earlier irori versions wrote into the irori agent's
   * folder are not used: the irori agent hands a vault's work with `irori call`.
   */
  private async prepareSubAgents(run: Run, agent: AgentId, you: boolean, root: string) {
    const { definitions, problems } = await readAgentDefinitions(root);
    if (problems.length)
      this.event(
        run,
        'status',
        t(
          `読めない sub-agent 定義があります: ${problems.map((item) => `${item.file}（${item.message}）`).join('、')}`,
          `Some sub-agent definitions could not be read: ${problems.map((item) => `${item.file} (${item.message})`).join(', ')}`,
        ),
      );
    const refused = (name: string) => (you ? name.startsWith('vault-') : name === vaultAgentName);
    const foreign = foreignDefinitions(definitions, agent, refused);
    const own = definitions.filter((item) => item.format === agent && refused(item.name));
    run.subAgents = { foreign, refused: [...new Set(own.map((item) => item.name))] };
    if (!foreign.length) return;
    if (agent === 'codex')
      run.codexRoles = await writeCodexRoles(this.files.dataDir, run.id, foreign);
    if (agent === 'opencode') {
      const env = run.env ?? agentEnv();
      const content = JSON.parse(env.OPENCODE_CONFIG_CONTENT ?? '{}');
      run.env = {
        ...env,
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          ...content,
          agent: {
            ...Object.fromEntries(
              foreign.map((item) => [
                item.name,
                { description: item.description, prompt: item.instructions, mode: 'subagent' },
              ]),
            ),
            ...content.agent,
          },
        }),
      };
    }
  }
  private async execute(run: Run, input: StartRun) {
    let outcome: AgentEvent['outcome'] = 'completed';
    let resuming = false;
    let record: RunRecord | undefined;
    // Claude Code and Codex take words mid-turn; the others, a routine's step and a
    // hand-off take an instruction sent now only by being stopped (ADR 056).
    if (run.step || run.holder || !steerable.has(input.agent)) run.steering.close();
    try {
      const placed = await this.place(run, input);
      if (
        [...this.runs.values()].some((other) => other !== run && other.conversationId === placed.id)
      )
        throw Error(alreadyRunning());
      run.conversationId = placed.id;
      await this.attachments.claim(input.attachments, placed.id);
      // The conversation's own queue goes first; `begin` refuses an instruction sent past it.
      const eventId = randomUUID();
      await this.conversations.begin(
        placed.id,
        placed.placement,
        { runId: run.id, eventId },
        input,
        run.queuedId,
      );
      run.recorded = true;
      run.accept();
      this.publish(run, 'status', input.prompt, {
        role: 'user',
        id: eventId,
        ...(input.attachments?.length && { attachments: input.attachments }),
      });
      if (run.step) this.event(run, 'status', run.step.notice);
      // The log says when a run may act without asking, whatever a column shows now.
      if (run.access === 'full-access')
        this.event(
          run,
          'status',
          t(
            'フルアクセスで実行しています（承認を求めません）。',
            'Running in full access (no approvals).',
          ),
        );
      if (run.cancelled) return;
      const you = this.isYou(input.scopeId);
      const space = you
        ? {
            root: this.root(input.scopeId, input.workspace),
            name: t('irori agent のフォルダ', "the irori agent's folder"),
          }
        : this.files.get(input.scopeId);
      const promptParts: string[] = [];
      // Every CLI the irori agent runs on gets the `irori` command for setup work,
      // and hands a vault's work to its vault agent with `irori call` (ADR 050).
      const calls = you && !!input.brains?.length;
      if (you && (this.setup || calls)) {
        const setup = this.setup;
        const commands = await iroriBridge(
          this.files.dataDir,
          ({ argv, cwd }, signal) =>
            argv[0] === 'call' && calls
              ? this.call(run, input, argv.slice(1), signal)
              : !setup
                ? Promise.reject(Error('Only "irori call" is available here.'))
                : setup(argv, cwd, {
                    workspaceId: input.workspace,
                    agent: { agent: input.agent, model: input.model, effort: input.effort },
                    inRoutine: !!run.step,
                    by: `${agentNames[input.agent]} (irori agent)`,
                  }),
          agentEnv(),
        );
        run.env = commands.env;
        run.commands = commands.close;
        // A vault agent's hand-off can take longer than the two minutes Claude
        // Code gives a shell command by default, and than its ten-minute ceiling.
        if (calls && input.agent === 'claude')
          run.env = {
            ...run.env,
            BASH_DEFAULT_TIMEOUT_MS: handOffShellTimeout,
            BASH_MAX_TIMEOUT_MS: handOffShellTimeout,
          };
      } else if (this.setup) {
        // A vault agent's command reaches its own vault alone (ADR 031).
        const setup = this.setup;
        const commands = await iroriBridge(
          this.files.dataDir,
          ({ argv, cwd }) =>
            setup(argv, cwd, {
              vault: input.scopeId,
              by: `${agentNames[input.agent]} (vault agent)`,
            }),
          agentEnv(),
        );
        run.env = commands.env;
        run.commands = commands.close;
      }
      if (you && input.brains?.length) {
        const names = brainAgentNames(this.files.list());
        const brains = await Promise.all(
          input.brains.map(async (scopeId) => {
            const brain = this.files.get(scopeId);
            // The vault's own definition of its agent tells the irori agent what it is for.
            const own = vaultAgentDefinition(
              (await readAgentDefinitions(brain.root)).definitions,
              input.agent,
            );
            return {
              ...(own && { description: own.description }),
              scopeId: brain.scopeId,
              name: brain.name,
              category: brain.category && categoryName(brain.category),
              agent: names.get(brain.scopeId)!,
              root: brain.root,
              layers: {
                knowledge: shownFolder(knowledgeFolder(brain)),
                contents: brain.contents,
              },
              linked: this.files.cloud?.linkedFolders?.(brain.scopeId),
              readOnly: this.files.cloud?.linkedPaths?.(brain.scopeId, false),
              work: await this.work(brain.scopeId),
            };
          }),
        );
        run.work = brains.flatMap((brain) => (brain.work ? [brain.work] : []));
        const comments = await Promise.all(
          brains.map((brain) =>
            commentsCount(this.files, brain.scopeId).then(
              (count) => count.comments,
              () => 0,
            ),
          ),
        );
        run.delegation = { you: space.root, brains };
        promptParts.push(brainsCommandPreamble(brains, comments));
      }
      // What irori is, how the vault is laid out and the `irori` command: whole on
      // a session's first request or after a change, otherwise one line (ADR 039).
      // Its place is kept here; which form goes in is known once the session is.
      const commands = !!(run.commands && this.setup);
      const intro = you
        ? commands
          ? { words: iroriCommandPreamble, pointer: iroriCommandPointer }
          : undefined
        : await this.vaultIntro(input.scopeId, commands, run);
      const introAt = intro ? promptParts.push('') - 1 : -1;
      if (input.notePath) {
        await this.files.resolve(input.scopeId, input.notePath);
        promptParts.push(selectedNote(input.notePath));
        // Only when the person asked: which lines are theirs is not needed on every
        // turn. Line numbers are those of the saved bytes the agent is told to read.
        const note = { scopeId: input.scopeId, path: input.notePath };
        const summary = input.personLines
          ? await this.files
              .read(input.scopeId, input.notePath)
              .then((doc) => this.authorship.view(note, doc.text))
              .then(personLinesSummary)
              .catch(() => undefined)
          : undefined;
        if (summary) promptParts.push(summary);
      }
      if (!you) {
        // The comments on the note in hand go with the instruction; without one,
        // a line says where this vault keeps the comments it has.
        const onNote = input.notePath
          ? await readNoteComments(this.files, input.scopeId, input.notePath).catch(() => [])
          : [];
        const words = onNote.length
          ? commentsSummary(input.notePath!, onNote)
          : await commentsCount(this.files, input.scopeId).then(
              ({ comments, files }) => (comments ? commentsPointer(comments, files) : undefined),
              () => undefined,
            );
        if (words) promptParts.push(words);
      }
      // A skill the agent's own Schema lacks may be one of the shared Schema's (ADR 027).
      const selectedSkill = input.skill
        ? ((await findSkill(
            you
              ? await this.you!.schemaFolder(input.workspace)
              : spaceFolder(this.files, input.scopeId),
            input.skill,
          )) ?? (await this.you?.sharedSkill(input.skill)))
        : undefined;
      if (input.skill && !selectedSkill) throw noSkill(input.skill);
      if (selectedSkill)
        this.event(
          run,
          'status',
          t(
            `${selectedSkill.name} スキルの手順で実行します。`,
            `Running with the ${selectedSkill.name} skill's procedure.`,
          ),
        );
      record = await this.knowledge.begin(run.id, input);
      if (record.sources.length)
        promptParts.push(
          selectedSources(
            record.sources.map((source) => ({
              scopeId: source.scopeId,
              path: source.path,
              sourceId: source.id,
              sha256: source.hash,
              snapshot: this.knowledge.blobPath(source.hash),
            })),
          ),
        );
      if (run.step) promptParts.push(run.step.preamble);
      if (input.attachments?.length) {
        run.attached = await Promise.all(
          input.attachments.map(async (ref) => ({
            name: ref.name,
            path: await this.attachments.path(ref),
            image: attachmentImageType(ref.name),
          })),
        );
        promptParts.push(
          attachedFiles(run.attached.map((file) => ({ ...file, image: !!file.image }))),
        );
      }
      promptParts.push(input.prompt);
      // A native session continues only on the device, checkout and access mode it
      // was made with (ADR 017 D7). Native sessions can retain approvals, so a
      // policy change starts a fresh one in the same conversation (ADR 009). A
      // routine's step always starts afresh and is never kept.
      run.root = rootDigest(space.root);
      let saved: string | undefined;
      let branch: string | undefined;
      if (!run.step) {
        const { entry, elsewhere } = await this.conversations.native(run.conversationId!);
        if (
          entry &&
          entry.root === run.root &&
          entry.access === run.access &&
          (!entry.branch || branching.has(input.agent))
        ) {
          saved = entry.handle;
          // After a rewind or in a copy, the session goes on from a point of its own.
          branch = entry.branch?.at;
          run.resumed = saved;
          run.source = entry.compacted ? 'compact' : 'resume';
          // After a compaction what the session heard may be gone: everything goes whole.
          if (!entry.compacted)
            run.heard = {
              shared: entry.shared,
              intro: entry.intro,
              schema: entry.schema,
              instructions: entry.instructions,
            };
        } else if (entry || elsewhere)
          this.event(
            run,
            'status',
            !entry
              ? t(
                  'この端末では新しいセッションで続けます。',
                  'This device continues in a new session.',
                )
              : entry.root !== run.root
                ? t(
                    '別のフォルダのため、新しいセッションで続けます。',
                    'This is another folder, so this continues in a new session.',
                  )
                : t(
                    'アクセス設定が変わったため、新しいセッションで続けます。',
                    'The access setting changed, so this continues in a new session.',
                  ),
          );
      }
      resuming = !!saved;
      run.source ??= 'startup';
      // A CLI that does not say when it compacts a session hears everything whole each time (ADR 058).
      run.pointers = schemaReach[input.agent].compaction;
      if (run.cancelled) return;
      // A CLI's own command (`/compact`, a Pi extension's) works only as the
      // whole request, so nothing irori adds goes before it, and nothing counts as heard.
      const command = !selectedSkill && !run.attached?.length && commandWords.test(input.prompt);
      run.words = input.prompt;
      run.command = command;
      if (intro && !command) promptParts[introAt] = this.said(run, 'intro', intro)[0];
      // A new session in a conversation that already has messages hears them first,
      // as material (ADR 017 D6, D7).
      const earlier =
        !saved && !run.step && !command
          ? earlierConversation(await this.conversations.said(run.conversationId!, run.id))
          : undefined;
      if (earlier) {
        promptParts.splice(introAt + 1, 0, earlier);
        this.event(
          run,
          'status',
          t(
            'これまでの会話を新しいセッションに渡しました。',
            'The conversation so far went to the new session.',
          ),
        );
      }
      let prompt = command ? input.prompt : promptParts.join('\n\n');
      if (selectedSkill) prompt = promptWithSkill(selectedSkill, prompt);
      // The shared Schema leads every request: whole unless this session already
      // heard it as it is now, then as one line (ADR 027).
      const shared = await this.you?.shared().catch((error) => {
        this.event(
          run,
          'status',
          t(
            `共通 Schema を読めませんでした: ${String(error)}`,
            `Could not read the shared Schema: ${String(error)}`,
          ),
        );
        return undefined;
      });
      if (input.agent === 'claude') await this.linkSkills(run, input, you, space.root, shared);
      await this.prepareSubAgents(run, input.agent, you, space.root);
      // What this CLI loads itself of its folder's Schema, and what irori gives it (ADR 058).
      const reach = await this.reachFor(input.agent, space.root);
      run.agentsBesideClaude = reach.claudeMd;
      const folder = await this.folderSchemaParts(input, you, reach).catch((error) => {
        this.event(
          run,
          'status',
          t(
            `このフォルダの Schema を読めませんでした: ${String(error)}`,
            `Could not read this folder's Schema: ${String(error)}`,
          ),
        );
        return undefined;
      });
      if (command) run.sent = { ...run.heard };
      else {
        const lead = [
          ...this.said(
            run,
            'shared',
            shared && { words: sharedSchema(shared), pointer: sharedSchemaPointer(shared) },
            sharedSchemaRemoved(),
          ),
          ...this.said(run, 'schema', folder?.part, folderSchemaRemoved(space.root)),
          ...this.refreshed(run, folder?.instructions),
        ];
        if (lead.length) prompt = [...lead, prompt].join('\n\n');
      }
      // The Schema's hooks: Claude Code runs them itself; irori runs them for every
      // other CLI, with Claude Code's meaning (ADR 058).
      const hooks =
        input.agent === 'claude' ? undefined : await this.schemaHooks(run, input, space.root);
      // The composer already shows the CLI, folder, access, model and level, so
      // a turn repeats none of them; only a change of session is worth a line.
      // Hermes Agent takes no level, and the Antigravity CLI's models name
      // theirs; one sent anyway is not passed on.
      // What runs without asking (hooks, MCP servers, plugins, settings) runs as allowed.
      const sharedHooks =
        input.agent === 'claude' ? await this.you?.sharedHooks().catch(() => undefined) : undefined;
      await this.configApprovals().check(input.agent, this.configPlaces(run, space.root), [
        ...(sharedHooks
          ? [
              {
                root: 'shared-schema-hooks',
                label: t('共通 Schema のフック', "The shared Schema's hooks"),
                files: Object.keys(sharedHooks),
                digest: digest(JSON.stringify(sharedHooks)),
              },
            ]
          : []),
        ...(hooks?.approvals ?? []),
      ]);
      if (run.cancelled) return;
      if (hooks) {
        // Declined: the run ends as stopped, with nothing sent.
        if (!(await this.acceptMissingHooks(run, input.agent, hooks.run))) {
          run.cancelled = true;
          return;
        }
        run.hooks = hooks.run;
        // SessionStart and UserPromptSubmit run before the request goes, as in
        // Claude Code; a CLI's own command takes nothing irori would add.
        const started = await run.hooks.sessionStart(run.source ?? 'startup');
        if (started.length && !command)
          prompt = `${hookContext('SessionStart', started)}\n\n${prompt}`;
        const submitted = await run.hooks.userPromptSubmit(prompt);
        if (submitted.blocked)
          throw Error(
            t(
              `UserPromptSubmit フックが指示を止めました: ${submitted.blocked}`,
              `A UserPromptSubmit hook stopped the instruction: ${submitted.blocked}`,
            ),
          );
        if (submitted.context.length && !command)
          prompt = `${prompt}\n\n${hookContext('UserPromptSubmit', submitted.context)}`;
        if (run.halted) throw Error(run.halted);
      }
      if (run.cancelled) return;
      const effort =
        input.agent === 'hermes' || input.agent === 'antigravity' ? undefined : input.effort;
      run.sending = true;
      await this.runCli(run, input, space.root, prompt, saved, branch, effort);
      // Stop hooks, and feedback Hermes could not take during its turn, go on in the same session.
      if (run.hooks && !command) await this.afterTurn(run, input, space.root, effort);
    } catch (e) {
      run.reject(e);
      if (!run.cancelled) {
        outcome = 'failed';
        this.event(run, 'error', String(e));
        // A resume that failed before the agent did anything is reported, and this
        // device's handle is set aside: the next instruction starts a new session.
        if (resuming && !run.progressed) {
          this.event(
            run,
            'error',
            t(
              '前回のセッションを引き継げませんでした。次の送信は新しいセッションで始まります。',
              'Could not continue the previous session. The next instruction starts a new one.',
            ),
          );
          await this.conversations.saveNative(run.conversationId!, undefined).catch(() => {});
        }
      }
    } finally {
      run.steering.close();
      // The reply's last words go before the run's end, in the views and the history alike.
      this.flushText(run);
      this.denyRequests(run);
      await this.cancelHeld(run);
      if (run.child) await killTree(run.child).catch(() => {});
      run.commands?.();
      // SessionEnd hooks hear the run end; hooks still running stop with it.
      if (run.hooks) {
        await run.hooks.sessionEnd().catch(() => {});
        await run.hooks.runner.stop();
      }
      for (const close of run.setup?.closers ?? []) close();
      // What the session heard, once the CLI is done with it.
      await this.rememberHeard(run).catch(() => {});
      if (run.claudeSkills) await unlinkClaudeSkills(this.files.dataDir, run.id).catch(() => {});
      if (run.codexRoles) await removeCodexRoles(this.files.dataDir, run.id).catch(() => {});
      run.rpc?.fail(Error('Run finished'));
      // Words the CLI wrote while being stopped arrived after the flush above; with
      // the process gone and its stream closed, these are the last.
      this.flushText(run);
      run.ended = true;
      if (run.cancelled) outcome = 'cancelled';
      if (record)
        await this.knowledge.finish(record, outcome).catch(() => {
          this.event(
            run,
            'error',
            t(
              '実行結果の記録に失敗しました。資料の保持版は残っています。',
              'Could not record the run result. The kept copies of the materials remain.',
            ),
          );
        });
      const done: AgentEvent = {
        id: randomUUID(),
        runId: run.id,
        type: 'done',
        outcome,
        text:
          outcome === 'completed'
            ? t('完了', 'Completed')
            : outcome === 'cancelled'
              ? t('停止', 'Stopped')
              : t('失敗', 'Failed'),
      };
      if (run.recorded) {
        try {
          // Where the session stood, for a later turn to go on from (ADR 017 D6).
          const device =
            run.nativeHandle && run.nativeAt && run.root && !run.step
              ? await this.device.id().catch(() => undefined)
              : undefined;
          await this.conversations.finish(
            run.conversationId!,
            done,
            [...run.reached],
            device
              ? {
                  device,
                  root: run.root!,
                  access: run.access,
                  handle: run.nativeHandle!,
                  at: run.nativeAt!,
                }
              : undefined,
          );
        } catch {
          done.outcome = 'failed';
          done.text = t(
            '実行は終了しましたが、会話履歴を保存できませんでした。変更内容を確認してください。',
            'The run finished, but the conversation history could not be saved. Review the changes.',
          );
        }
      }
      this.runs.delete(run.id);
      for (const [scopeId, holders] of this.delegated)
        if (holders.delete(run.id) && !holders.size) this.delegated.delete(scopeId);
      this.publish(run, 'done', done.text, { outcome: done.outcome, id: done.id });
      run.close();
    }
  }
  /** Stops the vault agents' runs your AI's run handed work to. */
  private async cancelHeld(run: Run) {
    await Promise.all(
      [...this.runs.values()]
        .filter((held) => held.holder === run.id)
        .map((held) => this.stop(held)),
    );
  }
  /**
   * One hand-off through `irori call`: a run of the named brain's
   * vault agent in that brain, on your AI's CLI and model in the vault
   * agent's default access, shown in that brain's own log. Your AI's log follows
   * it as a task, and the command gets the run's words as its report.
   */
  /** `irori call <vault> <task>`: one hand-off from the irori agent's run, answered with its report. */
  private call(holder: Run, input: StartRun, words: string[], signal: AbortSignal) {
    const [name, ...rest] = words;
    const task = rest.join(' ');
    if (!name?.trim()) throw Error('Name a vault and a task: irori call <vault> "<task>".');
    if (!task.trim()) throw Error('The task is empty.');
    if (task.length > handOffTaskLimit)
      throw Error(`A task is at most ${handOffTaskLimit} characters.`);
    return this.handOff(holder, input, name.trim(), task, signal);
  }
  private async handOff(
    holder: Run,
    input: StartRun,
    name: string,
    task: string,
    signal: AbortSignal,
  ) {
    const brain = vaultOf(holder.delegation!, name);
    if (holder.cancelled || signal.aborted) throw Error('The irori agent’s run has stopped.');
    if (!this.delegated.get(brain.scopeId)?.has(holder.id))
      throw Error(`The ${brain.name} vault is not handed to this request.`);
    if (
      [...this.runs.values()].some(
        (run) => run.holder === holder.id && run.binding.scopeId === brain.scopeId,
      )
    )
      throw Error(
        `The ${brain.name} agent is already working on a hand-off. Wait for its report before handing it another.`,
      );
    const id = randomUUID();
    const delegate = (state: Delegate['state']) => ({
      delegate: { scopeId: brain.scopeId, task: id, state },
    });
    const words = new Tail(reportLimit);
    const errors: string[] = [];
    let finished!: (outcome: AgentEvent['outcome']) => void;
    const done = new Promise<AgentEvent['outcome']>((resolve) => {
      finished = resolve;
    });
    // The vault's own definition of its agent goes with the task; its model is
    // used when it is in this CLI's terms (ADR 050).
    const own = vaultAgentDefinition(
      (await readAgentDefinitions(brain.root)).definitions,
      input.agent,
    );
    const model = definitionModel(own, input.agent) ?? input.model;
    const preferred = (await this.preferredAccess?.().catch(() => undefined)) ?? 'default';
    const runId = this.start(
      {
        scopeId: brain.scopeId,
        agent: input.agent,
        ...(model && { model }),
        effort: input.effort,
        // The access new conversations start in, never the irori agent's mode: the
        // vault's column shows that access, and a hand-off asks the person when it asks.
        access: defaultAgentAccess(input.agent, preferred),
        prompt: handedTask(task, own),
      },
      undefined,
      holder.id,
      undefined,
      conversationTitle(task),
    );
    // Registered before the run's first event, which waits for the next tick.
    this.watchers.set(runId, (event) => {
      if (event.type === 'text') words.add(event.text);
      else if (event.type === 'error') errors.push(event.text);
      else if (event.type === 'tool')
        this.event(holder, 'tool', event.text, {
          details: event.details,
          call: event.call,
          result: event.result,
          ...delegate('working'),
        });
      // The vault agent's requests are answered where the irori agent's are; the
      // answer reaches the vault agent's run by the request's id.
      else if (event.type === 'permission' || event.type === 'question')
        (holder.forwarded ??= new Map()).set(
          event.requestId!,
          this.publish(holder, event.type, event.text, {
            requestId: event.requestId,
            details: event.details,
            questions: event.questions,
            ...delegate('working'),
          }),
        );
      else if (event.type === 'status' && event.resolved) {
        holder.forwarded?.delete(event.resolved);
        this.publish(holder, 'status', '', { resolved: event.resolved });
      } else if (event.type === 'done') finished(event.outcome);
    });
    const label = task.trim().split('\n')[0].slice(0, 120);
    this.event(holder, 'status', label, delegate('started'));
    // Only the hand-off stops: the person's own runs in that vault go on.
    const stop = () => void this.cancelRun(runId);
    signal.addEventListener('abort', stop);
    try {
      const outcome = await done;
      const report = words.toString().trim();
      if (outcome === 'completed') {
        this.event(holder, 'status', report || noReport(), delegate('reported'));
        return report || 'The vault agent finished without a report.';
      }
      const reason =
        errors.at(-1) ?? (outcome === 'cancelled' ? 'The run was stopped.' : 'The run failed.');
      this.event(holder, 'status', reason, delegate('failed'));
      throw Error(`The ${brain.name} agent did not finish: ${reason}`);
    } finally {
      this.watchers.delete(runId);
      signal.removeEventListener('abort', stop);
    }
  }
  /**
   * Whether Codex took irori's hooks for this thread as trusted and enabled
   * (`hooks/list`), before a turn starts (ADR 058). When it fingerprints them
   * otherwise than irori did, the run starts Codex once more with the trust Codex
   * reported; otherwise nothing is sent, as the Schema's hooks would not run.
   */
  private async checkCodexHooks(
    run: Run,
    rpc: Rpc,
    forwarded: NonNullable<CliSetup['forwarded']>,
    events: string[],
  ) {
    const refused = (why: string) =>
      Error(
        t(
          `Codex が irori のフックを受け付けなかったため、Schema のフック（${events.join(', ')}）を実行できません。指示は送っていません（${why}）。`,
          `Codex did not take irori's hooks, so the Schema's ${events.join(', ')} hooks cannot run. The instruction was not sent (${why}).`,
        ),
      );
    let listed: any;
    try {
      listed = await rpc.request('hooks/list', { threadId: run.threadId });
    } catch (error) {
      throw refused(String(error));
    }
    const mine = new Map<string, any>();
    for (const entry of Array.isArray(listed?.data) ? listed.data : [])
      for (const hook of Array.isArray(entry?.hooks) ? entry.hooks : [])
        for (const event of events)
          if (hook?.command === `${forwarded.launcher} codex ${event} ${forwarded.url}`)
            mine.set(event, hook);
    const missing = events.filter((event) => !mine.has(event));
    if (missing.length) throw refused(`not listed: ${missing.join(', ')}`);
    const untrusted = events.filter((event) => {
      const hook = mine.get(event);
      return !hook.enabled || hook.trustStatus !== 'trusted';
    });
    if (!untrusted.length) return;
    const reported = new Map(
      events.map((event) => {
        const hook = mine.get(event);
        return [event, { key: String(hook.key ?? ''), hash: String(hook.currentHash ?? '') }];
      }),
    );
    if (run.codexTrust || [...reported.values()].some((trust) => !trust.key || !trust.hash))
      throw refused(`untrusted: ${untrusted.join(', ')}`);
    run.codexTrust = reported;
    throw new CodexHooksAgain();
  }
  /**
   * The words for a folder's AGENTS.md Codex says it did not load (an
   * `AGENTS.override.md` beside it, an untrusted project), before the request.
   */
  private async missingCodexInstructions(cwd: string, sources: unknown, prompt: string) {
    if (!Array.isArray(sources)) return prompt;
    const file = path.join(cwd, 'AGENTS.md');
    const text = await fs.readFile(file, 'utf8').catch(() => undefined);
    if (!text?.trim()) return prompt;
    const real = await fs.realpath(file).catch(() => file);
    const loaded = await Promise.all(
      sources.map(async (source) => {
        const value = String(source).startsWith('file://')
          ? decodeURIComponent(new URL(String(source)).pathname)
          : String(source);
        return fs.realpath(value).catch(() => value);
      }),
    );
    if (loaded.includes(real) || loaded.includes(file)) return prompt;
    const instructions = text.trim();
    return `${folderSchema({
      root: cwd,
      cli: agentNames.codex,
      instructions:
        Buffer.byteLength(instructions, 'utf8') <= schemaInline
          ? { file, text: instructions }
          : { file },
      nested: [],
      rules: [],
      skills: [],
    })}\n\n${prompt}`;
  }
  private async codex(
    run: Run,
    cwd: string,
    prompt: string,
    session?: string,
    model?: string,
    effort?: string,
    branch?: string,
    setup?: CliSetup,
  ) {
    const child = codexServer(cwd, runEnv(run, setup?.env ?? run.env));
    run.child = child;
    let finished = false;
    let failure: Error | undefined;
    const completion = new Promise<void>((resolve) => {
      run.finish = () => {
        finished = true;
        run.steering.close();
        resolve();
      };
    });
    const stderr = new Tail(6000);
    child.stderr!.on('data', (b) => stderr.add(String(b)));
    child.on('close', (code) => {
      if (!finished && !run.cancelled) failure = Error(`Codex exited (${code}): ${stderr}`);
      run.finish?.();
    });
    const rpc = new Rpc(
      child,
      (m) => {
        if (m.id !== undefined && m.method) {
          void this.codexRequest(run, rpc, m).catch((e) => {
            failure = e;
            run.finish?.();
          });
          return;
        }
        const p = m.params ?? {};
        if (!ownCodexNotice(run, p)) return;
        if (m.method === 'item/agentMessage/delta') this.event(run, 'text', p.delta ?? '');
        // A compaction, automatic or asked for, may have taken irori's words (ADR 058).
        if (m.method === 'item/completed' && p.item?.type === 'contextCompaction')
          run.compacted = true;
        // A review's findings are its answer, said when it leaves review mode.
        if (m.method === 'item/completed' && p.item?.type === 'exitedReviewMode') {
          if (typeof p.item.review === 'string') this.event(run, 'text', p.item.review);
          return;
        }
        if (
          m.method === 'item/started' &&
          !['agentMessage', 'userMessage', 'enteredReviewMode', 'exitedReviewMode'].includes(
            p.item?.type,
          )
        )
          this.event(run, 'tool', p.item?.type ?? 'tool', {
            details: JSON.stringify(
              p.item && typeof p.item === 'object' ? itemStart(p.item) : p.item,
            ),
            call: p.item?.id,
          });
        // A finished item carries its output: a command's, a tool's, the files changed.
        if (
          m.method === 'item/completed' &&
          p.item &&
          !['agentMessage', 'userMessage', 'reasoning'].includes(p.item.type)
        )
          this.event(
            run,
            'tool',
            p.item.type === 'fileChange'
              ? t('ファイルを変更しました', 'Changed files')
              : t(`${p.item.type} の結果`, `${p.item.type} result`),
            { details: JSON.stringify(p.item), call: p.item.id, result: true },
          );
        if (m.method === 'error') this.event(run, 'error', p.error?.message ?? JSON.stringify(p));
        // A compaction may have taken what the thread heard (ADR 058).
        if (m.method === 'thread/compacted') {
          run.compacted = true;
          if (run.command) run.finish?.();
        }
        if (m.method === 'turn/completed') {
          if (p.turn?.status === 'failed')
            failure = Error(p.turn.error?.message ?? 'Codex turn failed');
          run.finish?.();
        }
      },
      (error) => {
        if (!finished && !run.cancelled) failure = error;
        run.finish?.();
      },
    );
    run.rpc = rpc;
    await initializeCodex(rpc);
    // A read-only connection is readable in the sandbox but never a root it may write.
    const folders = [...this.localFolders(run, true), ...(run.work ?? [])];
    const writable = run.access !== 'full-access' && folders.length > 0;
    const forwarded = setup?.forwarded;
    const hooked = forwarded && setup?.codexHooks?.length ? setup.codexHooks : undefined;
    const params = {
      cwd,
      approvalPolicy: run.access === 'full-access' ? 'never' : 'on-request',
      approvalsReviewer: 'user',
      sandbox: run.access === 'full-access' ? 'danger-full-access' : 'workspace-write',
      config: {
        // A local folder in contents is reached through a link, outside the working
        // directory the sandbox lets the agent change.
        ...(writable && { 'sandbox_workspace_write.writable_roots': folders }),
        // The folder's sub-agents in other formats, as Codex roles (ADR 050).
        ...run.codexRoles,
        // Codex keeps 32 KiB of AGENTS.md by its default, cut without a word (ADR 058).
        project_doc_max_bytes: codexInstructionBytes,
        // The Schema's hooks reach irori through hooks of Codex's own, each
        // trusted by its own hash: Codex's trust for every other hook stays.
        ...(hooked && codexHookConfig(forwarded!.launcher, forwarded!.url, hooked, run.codexTrust)),
      },
      ...(model && { model }),
    };
    // After a rewind or in a copy, a new thread from the session's history through
    // the turn named (ADR 017 D6); the original thread stays as it is.
    const thread = await rpc.request(
      session && branch ? 'thread/fork' : session ? 'thread/resume' : 'thread/start',
      session && branch
        ? { ...params, threadId: session, lastTurnId: branch, excludeTurns: true }
        : session
          ? { ...params, threadId: session }
          : params,
    );
    run.threadId = thread.thread.id;
    run.nativeHandle = run.threadId;
    run.handle = run.threadId;
    await this.saveSession(run, thread.thread.id);
    if (run.cancelled) return;
    // Before any turn: Codex runs irori's hooks, or nothing goes (ADR 058).
    if (hooked) await this.checkCodexHooks(run, rpc, forwarded!, hooked);
    // Codex says which instruction files it loaded; an AGENTS.md it left out goes as words.
    prompt = await this.missingCodexInstructions(cwd, thread.instructionSources, prompt);
    // Codex's app server takes its commands as methods and its skills as items,
    // never as `/name` in a turn's text (ADR 040).
    const words = run.command ? commandWords.exec(run.words ?? '') : null;
    const name = words?.[1];
    const rest = words?.[2]?.trim() ?? '';
    // A compaction or a review is a turn of its own that takes no more words.
    if (name === 'compact' || name === 'review') run.steering.close();
    if (name === 'compact') {
      if (!session) {
        this.event(
          run,
          'status',
          t('まだ要約する会話がありません。', 'There is no conversation to summarize yet.'),
        );
        return;
      }
      await rpc.request('thread/compact/start', { threadId: run.threadId });
      await completion;
      if (failure) throw failure;
      return;
    }
    if (name === 'review') {
      const review = await rpc.request('review/start', {
        threadId: run.threadId,
        delivery: 'inline',
        target: rest ? { type: 'custom', instructions: rest } : { type: 'uncommittedChanges' },
      });
      run.turnId = review?.turn?.id;
      run.nativeAt = run.turnId;
      await completion;
      if (failure) throw failure;
      return;
    }
    // A skill named as `/name`, or as `$name` in the words, goes as an item beside
    // the text, as Codex's own composer sends it.
    const named = new Set(
      [...(run.words ?? '').matchAll(/(?:^|\s)\$([\w:-]+)/g)].map((match) => match[1]),
    );
    if (name) named.add(name);
    const skills = named.size
      ? (await codexSkills(rpc, cwd).catch(() => [])).filter((skill) => named.has(skill.name))
      : [];
    const text =
      name && skills.some((skill) => skill.name === name)
        ? `$${name}${rest ? ` ${rest}` : ''}`
        : prompt;
    const turn = await rpc.request('turn/start', {
      threadId: run.threadId,
      input: [
        ...(run.attached ?? [])
          .filter((file) => file.image)
          .map((file) => ({ type: 'localImage', path: file.path })),
        ...skills.map((skill) => ({ type: 'skill', name: skill.name, path: skill.path })),
        { type: 'text', text, text_elements: [] },
      ],
      ...(model && { model }),
      ...(effort && { effort }),
    });
    run.turnId = turn.turn.id;
    run.nativeAt = run.turnId;
    // Words sent now join this turn, which takes them at its next step; a turn that
    // has just ended refuses them, and they start a run of their own (ADR 056).
    const turnId = run.turnId;
    run.steering.open(async (words) => {
      if (finished || run.cancelled) return false;
      try {
        await rpc.request('turn/steer', {
          threadId: run.threadId,
          expectedTurnId: turnId,
          input: [{ type: 'text', text: words, text_elements: [] }],
        });
        return true;
      } catch {
        return false;
      }
    });
    await completion;
    if (failure) throw failure;
  }
  private async codexRequest(run: Run, rpc: Rpc, m: Message) {
    const p = m.params ?? {};
    let result: unknown;
    if (
      m.method === 'item/commandExecution/requestApproval' ||
      m.method === 'item/fileChange/requestApproval'
    ) {
      const reply = await this.ask(run, p.reason ?? t('実行の許可', 'Allow this action'), p);
      result = { decision: reply.allow ? 'accept' : 'decline' };
    } else if (m.method === 'item/tool/requestUserInput') {
      const questions: Question[] = p.questions.map((q: any) => ({
        id: String(q.id),
        title: String(q.question),
        ...(q.header && { header: String(q.header) }),
        ...(Array.isArray(q.options) && q.options.length
          ? { options: q.options.map(questionOption), other: q.isOther === true }
          : { other: true }),
        ...(q.isSecret === true && { secret: true }),
      }));
      const reply = await this.ask(
        run,
        t('エージェントからの質問', 'Question from the agent'),
        p,
        questions,
      );
      result = {
        answers: Object.fromEntries(
          questions.map((q) => [
            q.id,
            {
              answers: reply.allow ? [reply.answers?.[q.id] ?? ''].flat() : [questionDeclined],
            },
          ]),
        ),
      };
    } else if (m.method === 'item/permissions/requestApproval') {
      // Codex grants this for the rest of the turn, which the card says with what it grants.
      const reply = await this.ask(
        run,
        `${p.reason ?? t('追加アクセスの許可', 'Allow additional access')}\n${t(
          '許可すると、この依頼が終わるまで有効です',
          'If allowed, it lasts until this request ends',
        )}: ${JSON.stringify(p.permissions ?? {}).slice(0, 2000)}`,
        p,
      );
      result = { permissions: reply.allow ? p.permissions : {}, scope: 'turn' };
    } else if (m.method === 'mcpServer/elicitation/request') {
      result = await this.elicit(run, p);
    } else {
      // Unsupported forms/dynamic tools must never be implicitly approved.
      this.event(
        run,
        'error',
        t(
          `未対応の要求を拒否しました: ${m.method}`,
          `Declined an unsupported request: ${m.method}`,
        ),
      );
      refuseCodex(rpc, m, 'This request is not supported by irori yet');
      return;
    }
    rpc.send({ id: m.id, result });
  }
  /**
   * An MCP server's request for the person's input, from Claude Code or Codex:
   * a form's fields become questions, and a link is opened only when the person
   * agrees.
   */
  private async elicit(
    run: Run,
    request: {
      serverName?: string;
      message?: string;
      mode?: string;
      url?: string;
      requestedSchema?: unknown;
    },
    extra: Partial<AgentEvent> = {},
  ): Promise<{
    action: 'accept' | 'decline' | 'cancel';
    content?: Record<string, string | number | boolean | string[]>;
  }> {
    const server = String(request.serverName ?? 'MCP');
    const message = String(request.message ?? '');
    if (request.mode === 'url') {
      const url = String(request.url ?? '');
      const reply = await this.ask(
        run,
        t(
          `${server} がブラウザで開くよう求めています`,
          `${server} asks to open a page in the browser`,
        ),
        { message, url },
        undefined,
        extra,
      );
      if (!reply.allow || !/^https?:\/\//i.test(url)) return { action: 'decline' };
      await this.openUrl?.(url);
      return { action: 'accept' };
    }
    const questions = elicitationQuestions(request.requestedSchema);
    const reply = await this.ask(
      run,
      // The form's words are the server's own; say whose they are.
      message ? `${server}: ${message}` : t(`${server} からの質問`, `Question from ${server}`),
      request,
      questions.length
        ? questions
        : [{ id: 'confirm', title: message, options: [{ label: t('続ける', 'Continue') }] }],
      extra,
    );
    return reply.allow
      ? {
          action: 'accept',
          content: elicitationContent(request.requestedSchema, reply.answers ?? {}),
        }
      : { action: 'decline' };
  }
  private async claude(
    run: Run,
    cwd: string,
    prompt: string,
    session?: string,
    model?: string,
    effort?: string,
    branch?: string,
  ) {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const stderr = new Tail(6000);
    let sawResult = false;
    let streamed = false;
    const delegation = run.delegation;
    // Each tool call's name by its id, for its result.
    const tools = new Map<string, string>();
    // The folder's sub-agents in other formats, and those it must not use (ADR 050).
    const subAgents = run.subAgents?.foreign ?? [];
    const refused = run.subAgents?.refused ?? [];
    // Attached images go as pictures beside the words; without any, the words alone.
    const images = await Promise.all(
      (run.attached ?? [])
        .filter((file) => file.image)
        .map(async (file) => {
          const bytes = await fs.readFile(file.path).catch(() => undefined);
          return bytes && bytes.length <= inlineImageByteLimit
            ? {
                type: 'image' as const,
                source: {
                  type: 'base64' as const,
                  media_type: file.image as 'image/png',
                  data: bytes.toString('base64'),
                },
              }
            : undefined;
        }),
    ).then((blocks) => blocks.filter((block) => !!block));
    // The request, then any words the person sends while the turn works: Claude Code
    // takes them at its next step without stopping (ADR 056). A CLI command goes alone.
    const input = new MessageChannel<SDKUserMessage>();
    input.push({
      type: 'user',
      message: { role: 'user', content: [...images, { type: 'text', text: prompt }] },
      parent_tool_use_id: null,
    });
    if (run.command) {
      input.close();
      run.steering.close();
    }
    const attachedFolders = (run.attached ?? []).map((file) => path.dirname(file.path));
    // The shared Schema's hooks run beside the folder's own (ADR 048).
    const sharedHooks = await this.you?.sharedHooks().catch((error) => {
      this.event(
        run,
        'status',
        t(
          `共通 Schema のフックを読めませんでした: ${String(error)}`,
          `Could not read the shared Schema's hooks: ${String(error)}`,
        ),
      );
      return undefined;
    });
    const readOnly = this.localFolders(run, false).map(
      (folder) => `Edit(${claudeRulePath(folder)}/**)`,
    );
    const response = query({
      prompt: input,
      options: {
        cwd,
        pathToClaudeCodeExecutable: 'claude',
        env: runEnv(run),
        settingSources: ['user', 'project', 'local'],
        ...((sharedHooks || readOnly.length || run.agentsBesideClaude) && {
          settings: {
            ...(sharedHooks && { hooks: sharedHooks }),
            // A read-only connection stays read-only for Claude Code's file tools.
            ...(readOnly.length && { permissions: { deny: readOnly } }),
            // AGENTS.md is the Schema's instructions: read beside a CLAUDE.md too (ADR 058).
            ...(run.agentsBesideClaude && {
              pluginConfigs: {
                'cc-plugin-agents-md@builtin': {
                  options: { instructionFiles: 'claude-md-and-agents-md' },
                },
              },
            }),
          } as Settings,
        }),
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        permissionMode: run.access === 'full-access' ? 'bypassPermissions' : 'default',
        allowDangerouslySkipPermissions: run.access === 'full-access',
        includePartialMessages: true,
        resume: session,
        // After a rewind or in a copy, a new session from the entry named (ADR 017 D6).
        ...(session && branch && { resumeSessionAt: branch, forkSession: true }),
        ...(model && { model }),
        ...(effort && { effort: effort as EffortLevel }),
        ...(subAgents.length && {
          agents: Object.fromEntries(
            subAgents.map((item) => [
              item.name,
              { description: item.description, prompt: item.instructions },
            ]),
          ),
        }),
        ...(refused.length && { disallowedTools: refused.map((name) => `Agent(${name})`) }),
        ...((delegation ||
          run.step ||
          this.localFolders(run).length ||
          run.work?.length ||
          run.claudeSkills ||
          attachedFolders.length) && {
          additionalDirectories: [
            ...(run.claudeSkills ? [run.claudeSkills] : []),
            ...(delegation?.brains.map((brain) => brain.root) ?? []),
            ...(run.step?.directories ?? []),
            ...this.localFolders(run),
            ...(run.work ?? []),
            ...attachedFolders,
          ],
        }),
        onElicitation: (request) => this.elicit(run, request),
        // Told when it matters rather than on every turn: before an edit would
        // change lines the person wrote or revised, Claude Code hears which.
        hooks: {
          PreToolUse: [
            {
              matcher: writeToolMatcher,
              hooks: [
                async (input) => {
                  if (input.hook_event_name !== 'PreToolUse') return {};
                  // Your AI writes in its own folder; a brain's files change only
                  // through that brain's vault agent, with `irori call`.
                  if (delegation) {
                    const decision = writeDecision(delegation, toolFile(input.tool_input) ?? '');
                    if (!decision.allow)
                      return {
                        hookSpecificOutput: {
                          hookEventName: 'PreToolUse',
                          permissionDecision: 'deny',
                          permissionDecisionReason: decision.reason,
                        },
                      };
                  }
                  const context = await personLinesNotice(
                    this.files,
                    this.authorship,
                    run.binding.scopeId,
                    input.tool_name,
                    input.tool_input,
                  ).catch(() => undefined);
                  return context
                    ? {
                        hookSpecificOutput: {
                          hookEventName: 'PreToolUse',
                          additionalContext: context,
                        },
                      }
                    : {};
                },
              ],
            },
          ],
        },
        abortController: run.abort,
        spawnClaudeCodeProcess: (options) => {
          const child = launch(options.command, options.args, options.cwd ?? cwd, options.env);
          run.child = child;
          child.stderr!.on('data', (b) => stderr.add(String(b)));
          return child as ChildProcessWithoutNullStreams;
        },
        canUseTool: async (tool, input, options) => {
          if (tool === 'AskUserQuestion') {
            // Claude Code always lets the person answer in words of their own.
            const questions: Question[] = (input.questions as any[]).map((q) => ({
              id: String(q.question),
              title: String(q.question),
              ...(q.header && { header: String(q.header) }),
              options: Array.isArray(q.options) ? q.options.map(questionOption) : undefined,
              multiple: q.multiSelect === true,
              other: true,
            }));
            const reply = await this.ask(
              run,
              t('Claude Code からの質問', 'Question from Claude Code'),
              input,
              questions,
            );
            return reply.allow
              ? {
                  behavior: 'allow',
                  updatedInput: {
                    ...input,
                    answers: Object.fromEntries(
                      Object.entries(reply.answers ?? {}).map(([key, value]) => [
                        key,
                        Array.isArray(value) ? value.join(', ') : value,
                      ]),
                    ),
                  },
                }
              : { behavior: 'deny', message: questionDeclined };
          }
          const reply = await this.ask(run, t(`${tool} の許可`, `Allow ${tool}`), input);
          return reply.allow
            ? { behavior: 'allow', updatedInput: input }
            : { behavior: 'deny', message: permissionDenied };
        },
      },
    });
    run.steering.open(
      async (words) =>
        !run.cancelled &&
        input.push({
          type: 'user',
          message: { role: 'user', content: [{ type: 'text', text: words }] },
          parent_tool_use_id: null,
          priority: 'next',
        }),
    );
    try {
      for await (const msg of response) {
        if (run.cancelled) break;
        // A compaction may have taken what the session heard (ADR 058).
        if (msg.type === 'system' && msg.subtype === 'compact_boundary') run.compacted = true;
        if (msg.type === 'system' && msg.subtype === 'init') {
          run.nativeHandle = msg.session_id;
          await this.saveSession(run, msg.session_id);
        }
        // A sub-agent's words stay with its hand-off; the reply shown is the
        // main conversation's.
        const main = !('parent_tool_use_id' in msg) || !msg.parent_tool_use_id;
        // The turn's last entry in the session, where a later turn can go on from.
        if (
          main &&
          (msg.type === 'assistant' || (msg.type === 'user' && !('isReplay' in msg))) &&
          msg.uuid
        )
          run.nativeAt = msg.uuid;
        if (msg.type === 'stream_event' && main) {
          const event = msg.event;
          if (event.type === 'message_start') streamed = false;
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            streamed = true;
            this.event(run, 'text', event.delta.text);
          }
        }
        if (msg.type === 'assistant')
          for (const block of msg.message.content) {
            if (block.type === 'text' && !streamed && main) this.event(run, 'text', block.text);
            if (block.type !== 'tool_use') continue;
            tools.set(block.id, block.name);
            this.event(run, 'tool', block.name, {
              details: JSON.stringify(block.input),
              call: block.id,
            });
          }
        // Each tool's result comes back in the next user message; a hand-off's is its report.
        if (msg.type === 'user' && !('isReplay' in msg) && Array.isArray(msg.message.content))
          for (const block of msg.message.content) {
            if (block.type !== 'tool_result') continue;
            const name = tools.get(block.tool_use_id) ?? 'Tool';
            this.event(run, 'tool', t(`${name} の結果`, `${name} result`), {
              details:
                typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
              call: block.tool_use_id,
              result: true,
            });
          }
        if (msg.type === 'result') {
          sawResult = true;
          // The turn is over: what was sent before it ended is read, nothing after. The
          // CLI ends once it has answered all of it.
          run.steering.close();
          input.close();
          if (msg.is_error)
            throw Error('errors' in msg ? msg.errors.join('\n') : 'Claude Code reported an error');
        }
      }
      if (!sawResult && !run.cancelled) throw Error(`Claude Code ended before a result: ${stderr}`);
    } finally {
      run.steering.close();
      input.close();
      response.close();
    }
  }
}
