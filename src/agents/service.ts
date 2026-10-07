import { KnowledgeStore } from '../knowledge/store';
import { AuthorshipStore, editedPath, personLinesNotice } from '../knowledge/authorship';
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
  StartRun,
} from '../domain/types';
import type { HookInput } from '@anthropic-ai/claude-agent-sdk';
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
import { ModelCatalog } from './models';
import { personLinesBridge } from './person-lines';
import { hibachiBridge } from './hibachi-bridge';
import { iroriBridge } from './irori-bridge';
import type { NativeContext } from './adapter';
import { agentEnv, killTree, launch, version } from './process';
import { Rpc, type Message } from './rpc';
import { Tail } from './tail';
import type { FileService } from '../host/files';
import type { SessionBinding } from './sessions';
import { ConversationStore, rootDigest, viewDetails, type Placement } from './conversations';
import {
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
  brainsPreamble,
  commentsPointer,
  commentsSummary,
  handedTask,
  permissionDenied,
  personLinesSummary,
  promptWithSkill,
  questionDeclined,
  selectedNote,
  connectedFolders,
  selectedSources,
  sharedSchema,
  sharedSchemaPointer,
} from '../../prompts';
import { commentsCount, readNoteComments } from '../host/comments';
import { findSkill, noSkill } from '../host/skills';
import { spaceFolder } from '../host/schema-folder';
import { t } from '../domain/i18n';
import type { YourAiService } from '../host/you';
import { brainAgentNames, hasSubAgents } from '../domain/you';
import { categoryName } from '../domain/brains';
import {
  brainOfAgent,
  brainOfPath,
  hibachiOf,
  toolFile,
  writeDecision,
  type Delegation,
} from './delegation';
type Reply = { allow: boolean; answers?: AgentAnswers };
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
  /** For a hibachi agent's run started by your AI's `hibachi` command: that run's id. */
  holder?: string;
  /** A routine's agent step: a new native session that is never kept. */
  step?: StepRun;
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
  /** The hibachis this run's hand-offs reached. */
  reached: Set<string>;
  /** The digest of the checkout the run works in, kept with its native session. */
  root?: string;
  /** The digest of the shared Schema this run's request gave in full or pointed at. */
  shared?: string;
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
  /** For your AI: the environment with the `irori` command, and its closing. */
  env?: NodeJS.ProcessEnv;
  commands?: () => void;
  closed: Promise<void>;
  close: () => void;
};
/** Deltas of a streamed reply are sent together after at most this long, not one by one. */
const textWindow = 32;
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
export class AgentService {
  // Runs by id: one per conversation, and an owner's conversations run side by
  // side in its checkout, as Claudian's tabs do in one vault (ADR 020).
  private runs = new Map<string, Run>();
  private device: DeviceIdentity;
  private conversations: ConversationStore;
  private catalog = new ModelCatalog();
  // Brains handed to the irori agent's runs in progress, with the runs that hold
  // them. A brain is busy while a sub-agent may be working in its checkout.
  private delegated = new Map<string, Set<string>>();
  /**
   * Carries out the irori agent's `irori` command (its arguments, the folder it
   * ran in, and the request's workspace). Without it the command is not offered.
   */
  setup?: (argv: string[], cwd: string, context: { workspaceId?: string }) => Promise<string>;
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
    // An unwritable history is a whole-device fault, so every run stops.
    this.conversations = new ConversationStore(files.dataDir, this.device, () => {
      for (const run of [...this.runs.values()]) {
        this.publish(
          run,
          'error',
          t(
            '会話履歴を保存できません。実行を停止します。',
            'Could not save the conversation history. Stopping the run.',
          ),
        );
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
   * The folders on this device that the run's hibachis show in contents through
   * links: a hibachi agent's own, or those of the hibachis handed to the irori agent.
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
  /** The folder a run works in: a brain's root, or your AI's folder. */
  private root(scopeId: string) {
    return this.you?.rootOf(scopeId) ?? this.files.get(scopeId).root;
  }
  /** Whose conversation it is: a hibachi's, or the irori agent's. */
  private owner(scopeId: string): ConversationOwner {
    return this.isYou(scopeId)
      ? { kind: 'irori-agent', id: scopeId, name: 'irori agent' }
      : { kind: 'hibachi', id: scopeId, name: this.files.get(scopeId).name.slice(0, 200) };
  }
  get anyBusy() {
    return this.runs.size > 0;
  }
  runningScopes() {
    return [...new Set([...this.runs.values()].map((run) => run.binding.scopeId))];
  }
  private binding(scopeId: string, agent: AgentId): SessionBinding {
    return { scopeId, agent, root: this.root(scopeId) };
  }
  /** The owner's conversations for its history list. */
  async conversationList(scopeId: string) {
    this.root(scopeId);
    return this.conversations.list(scopeId);
  }
  /** An id for the owner's next conversation; it is written with its first instruction. */
  createConversation(scopeId: string, agent: AgentId) {
    this.root(scopeId);
    return this.conversations.reserve(scopeId, agent);
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
  deleteConversation(id: string) {
    if ([...this.runs.values()].some((run) => run.conversationId === id))
      throw Error(t('実行を停止してから削除してください。', 'Stop the run before deleting.'));
    return this.conversations.remove(id);
  }
  /**
   * A conversation and the requests its run is waiting on now. A request is kept
   * only as status text in the history, so a view opened while it waits takes the
   * live one from here. Without an id, the owner's conversation on show: the one
   * running, the one queued longest, or its latest with this CLI.
   */
  async conversation(scopeId: string, agent: AgentId, id?: string): Promise<Conversation> {
    this.root(scopeId);
    id ??= await this.conversations.current(scopeId, agent);
    const pending = await this.conversations.pending(scopeId);
    const reserved = id && this.conversations.reservation(id);
    if (!id || reserved) {
      if (reserved && reserved.owner !== scopeId)
        throw Error(
          t('この会話は別の持ち主のものです。', 'This conversation belongs to someone else.'),
        );
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
    if (value.meta.owner.id !== scopeId)
      throw Error(
        t('この会話は別の持ち主のものです。', 'This conversation belongs to someone else.'),
      );
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
    const placement: Placement = { owner: this.owner(input.scopeId), agent: input.agent };
    if (input.conversationId) return { id: input.conversationId, placement };
    const latest = await this.conversations.latest(input.scopeId, input.agent);
    return { id: latest ?? randomUUID(), placement: { ...placement, create: !latest } };
  }
  async queueMessage(input: StartRun) {
    input = startInput.parse(input);
    requireAgentAccess(input.agent, input.access);
    this.root(input.scopeId);
    if (this.isYou(input.scopeId) && (input.notePath || input.personLines || input.sources?.length))
      throw Error(
        t(
          'irori agent にはノートや資料を直接渡せません。hibachi を渡してください。',
          'The irori agent takes hibachis, not notes or materials.',
        ),
      );
    const { id, placement } = await this.placement(input);
    return this.conversations.enqueue(id, placement, input);
  }
  removeQueued(conversationId: string, id: string) {
    return this.conversations.removeQueued(conversationId, id);
  }
  /** Instructions waiting across the owner's conversations. */
  pending(scopeId: string) {
    return this.conversations.pending(scopeId);
  }
  /**
   * Starts the oldest queued instruction of one of the owner's conversations
   * that is not running: of `conversationId` alone when it is given.
   */
  async startNextQueued(scopeId: string, conversationId?: string, canStart = () => {}) {
    const next = await this.conversations.nextQueued(
      scopeId,
      (id) => (!conversationId || id === conversationId) && !this.conversationRun(id),
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
      throw Error('This hibachi is not handed to that run.');
    if (input.conversationId && this.conversationRun(input.conversationId))
      throw Error(
        t(
          'この会話は実行中です。停止するか、送信待ちに追加してください。',
          'This conversation is already running. Stop it or add the instruction to its queue.',
        ),
      );
    if (!input.prompt.trim() || input.prompt.length > promptLimit)
      throw Error('Enter an instruction (up to 32,000 characters)');
    this.root(input.scopeId);
    const brains = [...new Set(input.brains ?? [])];
    if (this.isYou(input.scopeId)) {
      if (input.notePath || input.personLines || input.sources?.length)
        throw Error(
          t(
            'irori agent にはノートや資料を直接渡せません。hibachi を渡してください。',
            'The irori agent takes hibachis, not notes or materials.',
          ),
        );
      for (const scopeId of brains) this.files.get(scopeId);
    } else if (brains.length || input.workspace) throw Error('Only the irori agent takes hibachis');
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
      binding: this.binding(input.scopeId, input.agent),
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
      this.publish(
        run,
        'error',
        t(
          '会話履歴を保存できません。実行を停止します。',
          'Could not save the conversation history. Stopping the run.',
        ),
      );
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
      // conversation of the hibachi, apart from the person's own.
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
    });
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
        throw Error(
          t(
            'この会話は実行中です。停止するか、送信待ちに追加してください。',
            'This conversation is already running. Stop it or add the instruction to its queue.',
          ),
        );
      run.conversationId = placed.id;
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
      this.publish(run, 'status', input.prompt, { role: 'user', id: eventId });
      if (run.step) this.event(run, 'status', run.step.notice);
      if (run.cancelled) return;
      const you = this.isYou(input.scopeId);
      const space = you
        ? {
            root: this.root(input.scopeId),
            name: t('irori agent のフォルダ', "the irori agent's folder"),
          }
        : this.files.get(input.scopeId);
      const promptParts: string[] = [];
      // Every CLI the irori agent runs on gets the `irori` command for setup work.
      if (you && this.setup) {
        const setup = this.setup;
        const commands = await iroriBridge(
          this.files.dataDir,
          ({ argv, cwd }) => setup(argv, cwd, { workspaceId: input.workspace }),
          agentEnv(),
        );
        run.env = commands.env;
        run.commands = commands.close;
      }
      if (you && input.brains?.length) {
        const names = brainAgentNames(this.files.list());
        const brains = input.brains.map((scopeId) => {
          const brain = this.files.get(scopeId);
          return {
            scopeId: brain.scopeId,
            name: brain.name,
            category: brain.category && categoryName(brain.category),
            agent: names.get(brain.scopeId)!,
            root: brain.root,
            linked: this.files.cloud?.linkedPaths?.(brain.scopeId),
          };
        });
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
          // Each hibachi's sub-agent is defined by irori, only where no file is:
          // the person may have edited one.
          const written = await this.you!.writeDefinitions(cli, brains);
          if (written.length)
            this.event(
              run,
              'status',
              t(
                `hibachi agent の定義を書きました: ${written.join(', ')}`,
                `Wrote the hibachi agent definitions: ${written.join(', ')}`,
              ),
            );
          promptParts.push(brainsPreamble(brains, cli, comments));
        } else promptParts.push(brainsCommandPreamble(brains, agentNames[cli], comments));
      }
      if (run.commands) promptParts.push(iroriCommandPreamble);
      // Searches that walk the hibachi skip the links its connected folders appear through.
      const linked = you ? [] : (this.files.cloud?.linkedPaths?.(input.scopeId) ?? []);
      if (linked.length) promptParts.push(connectedFolders(linked));
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
        // a line says where this hibachi keeps the comments it has.
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
            you ? await this.you!.schemaFolder() : spaceFolder(this.files, input.scopeId),
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
      promptParts.push(input.prompt);
      let prompt = promptParts.join('\n\n');
      if (selectedSkill) prompt = promptWithSkill(selectedSkill, prompt);
      const binding = this.binding(input.scopeId, input.agent);
      // A native session continues only on the device, checkout and access mode it
      // was made with (ADR 017 D7). Native sessions can retain approvals, so a
      // policy change starts a fresh one in the same conversation (ADR 009). A
      // routine's step always starts afresh and is never kept.
      run.root = rootDigest(space.root);
      let saved: string | undefined;
      let heard: string | undefined;
      if (!run.step) {
        const { entry, elsewhere } = await this.conversations.native(run.conversationId!);
        if (entry && entry.root === run.root && entry.access === run.access) {
          saved = entry.handle;
          heard = entry.shared;
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
      if (shared) {
        const words = sharedSchema(shared, !!run.delegation && hasSubAgents(input.agent));
        run.shared = createHash('sha256').update(words).digest('hex');
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
      if (input.agent === 'codex') await this.codex(run, space.root, prompt, saved, input.model);
      else if (input.agent === 'claude')
        await this.claude(run, space.root, prompt, binding, saved, input.model);
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
        // Pi and Hermes Agent load no sub-agents from files: your AI hands a
        // brain's work to its hibachi agent with the `hibachi` command instead.
        const command =
          delegation && !hasSubAgents(input.agent)
            ? await hibachiBridge(
                this.files.dataDir,
                (name, task, signal) => this.handOff(run, input, name, task, signal),
                bridge?.env ?? run.env ?? agentEnv(),
              )
            : undefined;
        if (command)
          run.bridge = () => {
            bridge?.close();
            command.close();
          };
        const context: NativeContext = {
          cwd: space.root,
          prompt,
          session: saved,
          access: run.access,
          model: input.model,
          env: run.step
            ? { ...(command?.env ?? bridge?.env ?? run.env ?? agentEnv()), ...run.step.env }
            : (command?.env ?? bridge?.env ?? run.env),
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
      // shared Schema is recorded here, on whatever handle it now has.
      if (run.shared && run.shared !== heard && !run.step && !run.cancelled) {
        const { entry } = await this.conversations.native(run.conversationId!);
        if (entry && entry.shared !== run.shared)
          await this.conversations.saveNative(run.conversationId!, {
            ...entry,
            shared: run.shared,
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
  /** Stops the hibachi agents' runs your AI's run handed work to. */
  private async cancelHeld(run: Run) {
    await Promise.all(
      [...this.runs.values()]
        .filter((held) => held.holder === run.id)
        .map((held) => this.stop(held)),
    );
  }
  /**
   * One hand-off through the `hibachi` command: a run of the named brain's
   * hibachi agent in that brain, on your AI's CLI and model in the hibachi
   * agent's default access, shown in that brain's own log. Your AI's log follows
   * it as a task, and the command gets the run's words as its report.
   */
  private async handOff(
    holder: Run,
    input: StartRun,
    name: string,
    task: string,
    signal: AbortSignal,
  ) {
    const brain = hibachiOf(holder.delegation!, name);
    if (holder.cancelled || signal.aborted) throw Error('The irori agent’s run has stopped.');
    if (!this.delegated.get(brain.scopeId)?.has(holder.id))
      throw Error(`The ${brain.name} hibachi is not handed to this request.`);
    if (
      [...this.runs.values()].some(
        (run) => run.holder === holder.id && run.binding.scopeId === brain.scopeId,
      )
    )
      throw Error(
        `The ${brain.name} hibachi's agent is already working on a hand-off. Wait for its report before handing it another.`,
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
    // Only the hand-off stops: the person's own runs in that hibachi go on.
    const stop = () => void this.cancelRun(runId);
    signal.addEventListener('abort', stop);
    try {
      const outcome = await done;
      const report = words.toString().trim();
      if (outcome === 'completed') {
        this.event(
          holder,
          'status',
          report || t('報告がありません。', 'No report.'),
          delegate('reported'),
        );
        return report || 'The hibachi agent finished without a report.';
      }
      const reason =
        errors.at(-1) ?? (outcome === 'cancelled' ? 'The run was stopped.' : 'The run failed.');
      this.event(holder, 'status', reason, delegate('failed'));
      throw Error(`The ${brain.name} hibachi's agent did not finish: ${reason}`);
    } finally {
      this.watchers.delete(runId);
      signal.removeEventListener('abort', stop);
    }
  }
  private async codex(run: Run, cwd: string, prompt: string, session?: string, model?: string) {
    const child = launch('codex', ['app-server', '--listen', 'stdio://'], cwd, {
      ...(run.env ?? agentEnv()),
      ...run.step?.env,
    });
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
        if (m.method === 'item/agentMessage/delta') this.event(run, 'text', p.delta ?? '');
        if (
          m.method === 'item/started' &&
          p.item?.type !== 'agentMessage' &&
          p.item?.type !== 'userMessage'
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
    await rpc.request('initialize', {
      clientInfo: { name: 'irori', title: 'irori', version: '0.1.0' },
      capabilities: { experimentalApi: true },
    });
    rpc.send({ method: 'initialized', params: {} });
    const folders = this.localFolders(run);
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
    const turn = await rpc.request('turn/start', {
      threadId: run.threadId,
      input: [{ type: 'text', text: prompt, text_elements: [] }],
      ...(model && { model }),
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
        id: q.id,
        title: q.question,
        options: q.options?.map((o: any) => o.label),
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
      rpc.send({
        id: m.id,
        error: { code: -32601, message: 'This request is not supported by irori yet' },
      });
      return;
    }
    rpc.send({ id: m.id, result });
  }
  private async claude(
    run: Run,
    cwd: string,
    prompt: string,
    binding: SessionBinding,
    session?: string,
    model?: string,
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
    const response = query({
      prompt,
      options: {
        cwd,
        pathToClaudeCodeExecutable: 'claude',
        env: { ...(run.env ?? agentEnv()), ...run.step?.env },
        settingSources: ['user', 'project', 'local'],
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        permissionMode: run.access === 'full-access' ? 'bypassPermissions' : 'default',
        allowDangerouslySkipPermissions: run.access === 'full-access',
        includePartialMessages: true,
        resume: session,
        ...(model && { model }),
        ...((delegation || run.step || this.localFolders(run).length) && {
          additionalDirectories: [
            ...(delegation?.brains.map((brain) => brain.root) ?? []),
            ...(run.step?.directories ?? []),
            ...this.localFolders(run),
          ],
        }),
        // Told when it matters rather than on every turn: before an edit would
        // change lines the person wrote or revised, Claude Code hears which.
        hooks: {
          PreToolUse: [
            {
              matcher: 'Edit|MultiEdit|Write|NotebookEdit',
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
                    brain?.scopeId ?? binding.scopeId,
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
            const questions = (input.questions as any[]).map((q) => ({
              id: q.question,
              title: q.question,
              options: q.options?.map((o: any) => o.label),
              multiple: q.multiSelect === true,
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
            msg.summary || t('報告がありません。', 'No report.'),
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
