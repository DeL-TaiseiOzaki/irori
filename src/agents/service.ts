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
import type {
  EffortLevel,
  HookInput,
  SDKUserMessage,
  Settings,
} from '@anthropic-ai/claude-agent-sdk';
import { promises as fs } from 'node:fs';
import { agentIds, agentNames } from '../domain/types';
import {
  agentAccessDetail,
  agentAccessLabel,
  defaultAgentAccess,
  requireAgentAccess,
} from '../domain/agent-access';
import { runPi } from './pi';
import { runOpenCode } from './opencode';
import { runHermes } from './hermes';
import { codexServer, initializeCodex, refuseCodex } from './codex';
import { ModelCatalog } from './models';
import { CommandCatalog, codexSkills, commandWords } from './commands';
import { personLinesBridge } from './person-lines';
import { handOffTaskLimit, iroriBridge } from './irori-bridge';
import type { NativeContext } from './adapter';
import { agentEnv, killTree, launch, version } from './process';
import { Rpc, type Message } from './rpc';
import { Tail } from './tail';
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
  type Conversation,
  type ConversationOwner,
} from '../domain/conversation';
import { DeviceIdentity } from '../host/device';
import {
  brainsCommandPreamble,
  iroriCommandPreamble,
  iroriCommandPointer,
  brainsPreamble,
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
  sharedSchema,
  sharedSchemaPointer,
  vaultIntro,
  vaultIntroPointer,
} from '../../prompts';
import { commentsCount, readNoteComments } from '../host/comments';
import { findSkill, noSkill } from '../host/skills';
import { spaceFolder } from '../host/schema-folder';
import { t } from '../domain/i18n';
import type { YourAiService } from '../host/you';
import { brainAgentNames, hasSubAgents } from '../domain/you';
import { categoryName } from '../domain/brains';
import { knowledgeFolder, shownFolder } from '../domain/layers';
import {
  brainOfAgent,
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
  /** The digest of the shared Schema this run's request gave in full or pointed at. */
  shared?: string;
  /** The digest of the introduction this run gave in full or stood for (ADR 039). */
  intro?: string;
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
  bridge?: () => void;
  /** Files the person attached to this instruction. */
  attached?: Attached[];
  /** For your AI: the environment with the `irori` command, and its closing. */
  env?: NodeJS.ProcessEnv;
  commands?: () => void;
  closed: Promise<void>;
  close: () => void;
};
/** Deltas of a streamed reply are sent together after at most this long, not one by one. */
const textWindow = 32;
const digest = (words: string) => createHash('sha256').update(words).digest('hex');
/** The environment a run's CLI starts in: `base`, or irori's own, with a routine step's variables. */
const runEnv = (run: Run, base = run.env) => ({ ...(base ?? agentEnv()), ...run.step?.env });
const alreadyRunning = () =>
  t(
    'この会話は実行中です。停止するか、送信待ちに追加してください。',
    'This conversation is already running. Stop it or add the instruction to its queue.',
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
  /** Opens an http or https page in the person's browser, when an MCP server asks and they agree. */
  openUrl?: (url: string) => Promise<void>;
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
  private localFolders(run: Run) {
    const scopes = run.delegation
      ? run.delegation.brains.map((brain) => brain.scopeId)
      : [run.binding.scopeId];
    return scopes.flatMap((scopeId) => this.files.cloud?.localFolders?.(scopeId) ?? []);
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
    const requests = [...this.requests.values()]
      .filter(({ run }) => run.conversationId === id && run.id === value.activeRunId)
      .map(({ event }) => event);
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
    if (!next) return null;
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
  commands(scopeId: string, agent: AgentId) {
    return this.commandCatalog.commands(agent, this.root(scopeId));
  }
  async available(): Promise<AgentInfo[]> {
    return Promise.all(
      agentIds.map(async (id) => {
        try {
          const v = await version(id);
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
      holder,
      step,
      queuedId,
      reached: new Set(),
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
    run.progressed = true;
    const requestId = randomUUID();
    return new Promise((resolve) => {
      // Registered before it is published, since an answer can arrive at once.
      const pending = { run, event: undefined as unknown as AgentEvent, reply: resolve };
      this.requests.set(requestId, pending);
      pending.event = this.publish(run, questions ? 'question' : 'permission', text, {
        requestId,
        details: JSON.stringify(details, null, 2).slice(0, 24000),
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
  /** Keeps the CLI's session handle for this device, unless the run is a routine's step. */
  private async saveSession(run: Run, handle: string) {
    if (run.step || !run.conversationId || !run.root) return;
    await this.conversations.saveNative(run.conversationId, {
      handle,
      access: run.access,
      root: run.root,
      ...(run.shared && { shared: run.shared }),
      ...(run.intro && { intro: run.intro }),
    });
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
          linked: this.files.cloud?.linkedPaths?.(scopeId),
          work:
            work &&
            (inside ? `${path.relative(vault.root, work).split(path.sep).join('/')}/` : work),
        },
        commands,
      ),
      pointer: vaultIntroPointer(vault.name, commands),
    };
  }
  private async execute(run: Run, input: StartRun) {
    let outcome: AgentEvent['outcome'] = 'completed';
    let resuming = false;
    let record: RunRecord | undefined;
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
      if (run.cancelled) return;
      const you = this.isYou(input.scopeId);
      const space = you
        ? {
            root: this.root(input.scopeId, input.workspace),
            name: t('irori agent のフォルダ', "the irori agent's folder"),
          }
        : this.files.get(input.scopeId);
      const promptParts: string[] = [];
      // Every CLI the irori agent runs on gets the `irori` command for setup work.
      // Pi and Hermes Agent load no sub-agents from files, so on them it also
      // hands a vault's work to its vault agent with `irori call`.
      const calls = you && !!input.brains?.length && !hasSubAgents(input.agent);
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
            return {
              scopeId: brain.scopeId,
              name: brain.name,
              category: brain.category && categoryName(brain.category),
              agent: names.get(brain.scopeId)!,
              root: brain.root,
              layers: {
                knowledge: shownFolder(knowledgeFolder(brain)),
                contents: brain.contents,
              },
              linked: this.files.cloud?.linkedPaths?.(brain.scopeId),
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
        const cli = input.agent;
        if (hasSubAgents(cli)) {
          // Each vault's sub-agent is defined by irori, only where no file is:
          // the person may have edited one.
          const written = await this.you!.writeDefinitions(cli, brains, input.workspace);
          if (written.length)
            this.event(
              run,
              'status',
              t(
                `vault agent の定義を書きました: ${written.join(', ')}`,
                `Wrote the vault agent definitions: ${written.join(', ')}`,
              ),
            );
          promptParts.push(brainsPreamble(brains, cli, comments));
        } else promptParts.push(brainsCommandPreamble(brains, agentNames[cli], comments));
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
      let heard: string | undefined;
      let heardIntro: string | undefined;
      if (!run.step) {
        const { entry, elsewhere } = await this.conversations.native(run.conversationId!);
        if (entry && entry.root === run.root && entry.access === run.access) {
          saved = entry.handle;
          heard = entry.shared;
          heardIntro = entry.intro;
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
      if (run.cancelled) return;
      // A CLI's own command (`/compact`, a Pi extension's) works only as the
      // whole request, so nothing irori adds goes before it, and nothing counts as heard.
      const command = !selectedSkill && !run.attached?.length && commandWords.test(input.prompt);
      run.words = input.prompt;
      run.command = command;
      if (intro && !command) {
        run.intro = digest(intro.words);
        promptParts[introAt] = saved && heardIntro === run.intro ? intro.pointer : intro.words;
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
      if (shared && !command) {
        const words = sharedSchema(shared, !!run.delegation && hasSubAgents(input.agent));
        run.shared = digest(words);
        prompt = `${saved && heard === run.shared ? sharedSchemaPointer(shared) : words}\n\n${prompt}`;
      }
      if (saved)
        this.event(
          run,
          'status',
          t('保存済みのセッションを引き継ぎます。', 'Continuing the saved session.'),
        );
      this.event(
        run,
        'status',
        t(
          `${agentNames[input.agent]} を ${space.name} で実行中`,
          `Running ${agentNames[input.agent]} in ${space.name}`,
        ),
      );
      this.event(
        run,
        'status',
        `${agentAccessLabel(input.agent, run.access)}: ${agentAccessDetail(input.agent, run.access)}`,
      );
      if (input.model)
        this.event(run, 'status', t(`モデル: ${input.model}`, `Model: ${input.model}`));
      // Hermes Agent takes no level; one sent anyway is not passed on.
      const effort = input.agent === 'hermes' ? undefined : input.effort;
      if (effort) this.event(run, 'status', t(`思考量: ${effort}`, `Effort: ${effort}`));
      if (input.agent === 'codex')
        await this.codex(run, space.root, prompt, saved, input.model, effort);
      else if (input.agent === 'claude')
        await this.claude(run, space.root, prompt, saved, input.model, effort);
      else {
        // The same word Claude Code gets from its hook, through each CLI's own
        // hook: which of the person's lines a file tool call would change.
        // Hermes Agent offers no such hook.
        const delegation = run.delegation;
        const bridge =
          input.agent === 'hermes'
            ? undefined
            : await personLinesBridge(
                this.files.dataDir,
                input.agent,
                async (tool, edit) => {
                  if (!delegation)
                    return personLinesNotice(
                      this.files,
                      this.authorship,
                      input.scopeId,
                      tool,
                      edit,
                    );
                  // Your AI names a brain's file by its absolute path.
                  const file = editedPath(edit);
                  const brain =
                    file && path.isAbsolute(file) ? brainOfPath(delegation, file) : undefined;
                  return brain
                    ? personLinesNotice(this.files, this.authorship, brain.scopeId, tool, edit)
                    : undefined;
                },
                run.env ?? agentEnv(),
              );
        run.bridge = bridge?.close;
        const context: NativeContext = {
          cwd: space.root,
          prompt,
          session: saved,
          access: run.access,
          model: input.model,
          effort,
          attached: run.attached,
          env: runEnv(run, bridge?.env ?? run.env),
          args: bridge?.args,
          signal: run.abort.signal,
          child: (child) => {
            run.child = child;
          },
          event: (type, text, extra) => this.event(run, type, text, extra),
          ask: (text, details, questions) => this.ask(run, text, details, questions),
          saveSession: (handle) => this.saveSession(run, handle),
        };
        if (input.agent === 'pi') await runPi(context);
        else if (input.agent === 'opencode') await runOpenCode(context);
        else await runHermes(context);
      }
      // A resumed session's handle is not saved again, so what it heard of the
      // shared Schema and the introduction is recorded here, on whatever handle
      // it now has.
      if (
        ((run.shared && run.shared !== heard) || (run.intro && run.intro !== heardIntro)) &&
        !run.step &&
        !run.cancelled
      ) {
        const { entry } = await this.conversations.native(run.conversationId!);
        if (entry && (entry.shared !== run.shared || entry.intro !== run.intro))
          await this.conversations.saveNative(run.conversationId!, {
            ...entry,
            ...(run.shared && { shared: run.shared }),
            ...(run.intro && { intro: run.intro }),
          });
      }
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
      // The reply's last words go before the run's end, in the views and the history alike.
      this.flushText(run);
      this.denyRequests(run);
      await this.cancelHeld(run);
      if (run.child) await killTree(run.child).catch(() => {});
      run.bridge?.();
      run.commands?.();
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
          await this.conversations.finish(run.conversationId!, done, [...run.reached]);
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
    const runId = this.start(
      {
        scopeId: brain.scopeId,
        agent: input.agent,
        model: input.model,
        effort: input.effort,
        access: defaultAgentAccess(input.agent),
        prompt: handedTask(task),
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
      else if (event.type === 'done') finished(event.outcome);
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
  private async codex(
    run: Run,
    cwd: string,
    prompt: string,
    session?: string,
    model?: string,
    effort?: string,
  ) {
    const child = codexServer(cwd, runEnv(run));
    run.child = child;
    let finished = false;
    let failure: Error | undefined;
    const completion = new Promise<void>((resolve) => {
      run.finish = () => {
        finished = true;
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
        if (m.method === 'thread/compacted') run.finish?.();
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
    const folders = [...this.localFolders(run), ...(run.work ?? [])];
    const params = {
      cwd,
      approvalPolicy: run.access === 'full-access' ? 'never' : 'on-request',
      approvalsReviewer: 'user',
      sandbox: run.access === 'full-access' ? 'danger-full-access' : 'workspace-write',
      // A local folder in contents is reached through a link, outside the working
      // directory the sandbox lets the agent change.
      ...(run.access !== 'full-access' &&
        folders.length && { config: { 'sandbox_workspace_write.writable_roots': folders } }),
      ...(model && { model }),
    };
    const thread = await rpc.request(
      session ? 'thread/resume' : 'thread/start',
      session ? { ...params, threadId: session } : params,
    );
    run.threadId = thread.thread.id;
    await this.saveSession(run, thread.thread.id);
    if (run.cancelled) return;
    // Codex's app server takes its commands as methods and its skills as items,
    // never as `/name` in a turn's text (ADR 040).
    const words = run.command ? commandWords.exec(run.words ?? '') : null;
    const name = words?.[1];
    const rest = words?.[2]?.trim() ?? '';
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
      const reply = await this.ask(
        run,
        p.reason ?? t('追加アクセスの許可', 'Allow additional access'),
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
      message || t(`${server} からの質問`, `Question from ${server}`),
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
  ) {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const stderr = new Tail(6000);
    let sawResult = false;
    let streamed = false;
    const delegation = run.delegation;
    // Hand-offs by the delegation's tool call, and each sub-agent's id by the
    // hand-off it runs: every step and request of a sub-agent names its brain.
    const tasks = new Map<string, string>();
    const agentTasks = new Map<string, string>();
    // Each tool call's name by its id, for its result.
    const tools = new Map<string, string>();
    const agentTypes = new Map<string, string>();
    const delegate = (task: string | undefined, state: Delegate['state']) => {
      const scopeId = task ? tasks.get(task) : undefined;
      return scopeId && task ? { delegate: { scopeId, task, state } } : {};
    };
    // A sub-agent can ask before the message tying it to its hand-off has been
    // read from the stream, so the question waits a moment for that tie.
    const taskWaiters = new Map<string, (task?: string) => void>();
    const delegateOfAgent = async (agentId?: string) => {
      if (!agentId || !delegation) return {};
      const task =
        agentTasks.get(agentId) ??
        (await new Promise<string | undefined>((resolve) => {
          const timer = setTimeout(() => resolve(agentTasks.get(agentId)), 3000);
          taskWaiters.set(agentId, (task) => {
            clearTimeout(timer);
            resolve(task);
          });
        }));
      taskWaiters.delete(agentId);
      if (task && tasks.has(task)) return delegate(task, 'working');
      const brain = brainOfAgent(delegation, agentTypes.get(agentId));
      return brain
        ? { delegate: { scopeId: brain.scopeId, task: task ?? agentId, state: 'working' as const } }
        : {};
    };
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
    const message = async function* (): AsyncGenerator<SDKUserMessage> {
      yield {
        type: 'user',
        message: { role: 'user', content: [...images, { type: 'text', text: prompt }] },
        parent_tool_use_id: null,
      };
    };
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
    const response = query({
      prompt: images.length ? message() : prompt,
      options: {
        cwd,
        pathToClaudeCodeExecutable: 'claude',
        env: runEnv(run),
        settingSources: ['user', 'project', 'local'],
        ...(sharedHooks && { settings: { hooks: sharedHooks } as Settings }),
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        permissionMode: run.access === 'full-access' ? 'bypassPermissions' : 'default',
        allowDangerouslySkipPermissions: run.access === 'full-access',
        includePartialMessages: true,
        resume: session,
        ...(model && { model }),
        ...(effort && { effort: effort as EffortLevel }),
        ...((delegation ||
          run.step ||
          this.localFolders(run).length ||
          run.work?.length ||
          attachedFolders.length) && {
          additionalDirectories: [
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
                  // through that brain's sub-agent.
                  if (delegation) {
                    const decision = writeDecision(
                      delegation,
                      input.agent_type,
                      toolFile(input.tool_input) ?? '',
                    );
                    if (!decision.allow)
                      return {
                        hookSpecificOutput: {
                          hookEventName: 'PreToolUse',
                          permissionDecision: 'deny',
                          permissionDecisionReason: decision.reason,
                        },
                      };
                  }
                  const file = toolFile(input.tool_input);
                  const brain = delegation && file ? brainOfPath(delegation, file) : undefined;
                  const context = await personLinesNotice(
                    this.files,
                    this.authorship,
                    brain?.scopeId ?? run.binding.scopeId,
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
            ...(delegation
              ? [
                  {
                    // A sub-agent in the background cannot ask the person, so
                    // its edits would be refused: hand-offs run in the foreground.
                    matcher: 'Agent|Task',
                    hooks: [
                      async (input: HookInput) => {
                        if (input.hook_event_name !== 'PreToolUse') return {};
                        const agentInput = input.tool_input as { run_in_background?: boolean };
                        return agentInput?.run_in_background
                          ? {
                              hookSpecificOutput: {
                                hookEventName: 'PreToolUse' as const,
                                permissionDecision: 'allow' as const,
                                updatedInput: { ...agentInput, run_in_background: false },
                              },
                            }
                          : {};
                      },
                    ],
                  },
                ]
              : []),
          ],
          SubagentStart: [
            {
              hooks: [
                async (input) => {
                  if (input.hook_event_name === 'SubagentStart')
                    agentTypes.set(input.agent_id, input.agent_type);
                  return {};
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
          const attributed = await delegateOfAgent(options.agentID);
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
              attributed,
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
          const reply = await this.ask(
            run,
            t(`${tool} の許可`, `Allow ${tool}`),
            input,
            undefined,
            attributed,
          );
          return reply.allow
            ? { behavior: 'allow', updatedInput: input }
            : { behavior: 'deny', message: permissionDenied };
        },
      },
    });
    try {
      for await (const msg of response) {
        if (run.cancelled) break;
        if (msg.type === 'system' && msg.subtype === 'init')
          await this.saveSession(run, msg.session_id);
        // A sub-agent's words stay with its hand-off; the reply shown is the
        // main conversation's.
        const main = !('parent_tool_use_id' in msg) || !msg.parent_tool_use_id;
        if (msg.type === 'stream_event' && main) {
          const event = msg.event;
          if (event.type === 'message_start') streamed = false;
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            streamed = true;
            this.event(run, 'text', event.delta.text);
          }
        }
        if (msg.type === 'system' && msg.subtype === 'task_started' && msg.tool_use_id) {
          agentTasks.set(msg.task_id, msg.tool_use_id);
          taskWaiters.get(msg.task_id)?.(msg.tool_use_id);
        }
        if (
          msg.type === 'system' &&
          msg.subtype === 'task_notification' &&
          msg.tool_use_id &&
          tasks.has(msg.tool_use_id)
        )
          this.event(
            run,
            'status',
            msg.summary || noReport(),
            delegate(msg.tool_use_id, msg.status === 'completed' ? 'reported' : 'failed'),
          );
        if (msg.type === 'assistant')
          for (const block of msg.message.content) {
            if (block.type === 'text' && !streamed && main) this.event(run, 'text', block.text);
            if (block.type !== 'tool_use') continue;
            tools.set(block.id, block.name);
            const input = block.input as { subagent_type?: string; description?: string };
            const brain =
              main && /^(Agent|Task)$/.test(block.name) && delegation
                ? brainOfAgent(delegation, input.subagent_type)
                : undefined;
            if (brain) {
              tasks.set(block.id, brain.scopeId);
              this.event(
                run,
                'status',
                input.description || brain.name,
                delegate(block.id, 'started'),
              );
            } else
              this.event(run, 'tool', block.name, {
                details: JSON.stringify(block.input),
                call: block.id,
                ...(main ? {} : delegate(msg.parent_tool_use_id ?? undefined, 'working')),
              });
          }
        // Each tool's result comes back in the next user message; a hand-off's is its report.
        if (msg.type === 'user' && !('isReplay' in msg) && Array.isArray(msg.message.content))
          for (const block of msg.message.content) {
            if (block.type !== 'tool_result' || tasks.has(block.tool_use_id)) continue;
            const name = tools.get(block.tool_use_id) ?? 'Tool';
            this.event(run, 'tool', t(`${name} の結果`, `${name} result`), {
              details:
                typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
              call: block.tool_use_id,
              result: true,
              ...(main ? {} : delegate(msg.parent_tool_use_id ?? undefined, 'working')),
            });
          }
        if (msg.type === 'result') {
          sawResult = true;
          if (msg.is_error)
            throw Error('errors' in msg ? msg.errors.join('\n') : 'Claude Code reported an error');
        }
      }
      if (!sawResult && !run.cancelled) throw Error(`Claude Code ended before a result: ${stderr}`);
    } finally {
      response.close();
    }
  }
}
