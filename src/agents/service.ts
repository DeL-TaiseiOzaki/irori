import { KnowledgeStore } from '../knowledge/store';
import { AuthorshipStore, personLinesNotice } from '../knowledge/authorship';
import { personLinesSummary, type RunRecord } from '../domain/knowledge';
import { randomUUID } from 'node:crypto';
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
import { agentAccessDetail, agentAccessLabel, requireAgentAccess } from '../domain/agent-access';
import { runPi } from './pi';
import { runOpenCode } from './opencode';
import { personLinesBridge } from './person-lines';
import type { NativeContext } from './adapter';
import { agentEnv, killTree, launch, version } from './process';
import { Rpc, type Message } from './rpc';
import type { FileService } from '../host/files';
import { SessionStore, type SessionBinding } from './sessions';
import { ConversationStore } from './conversations';
import { startInput, type Conversation } from '../domain/conversation';
import { promptWithSkill } from '../domain/skills';
import { parseSkill, requireSkill } from '../host/skills';
import { t } from '../domain/i18n';
import type { YourAiService } from '../host/you';
import { brainAgentNames, brainsPreamble } from '../domain/you';
import { categoryName } from '../domain/brains';
import {
  brainOfAgent,
  brainOfPath,
  toolFile,
  writeDecision,
  writeTools,
  type Delegation,
} from './delegation';
type Reply = { allow: boolean; answers?: AgentAnswers };
type Run = {
  id: string;
  binding: SessionBinding;
  /** For your AI: its folder and the brains handed to it in this run. */
  delegation?: Delegation;
  access: AgentAccess;
  queuedId?: string;
  recorded?: boolean;
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
  closed: Promise<void>;
  close: () => void;
};
export class AgentService {
  // One run per space. Two spaces are separate checkouts, so their runs never
  // touch the same bytes; two runs in one space would.
  private runs = new Map<string, Run>();
  private sessions: SessionStore;
  private conversations: ConversationStore;
  private resetting = new Set<string>();
  // Brains handed to your AI's run in progress, by the run that holds them. A brain
  // is busy while its sub-agent may be working in its checkout.
  private delegated = new Map<string, string>();
  private requests = new Map<
    string,
    { run: Run; event: AgentEvent; reply: (reply: Reply) => void }
  >();
  constructor(
    private files: FileService,
    private emit: (event: AgentEvent) => void,
    private knowledge = new KnowledgeStore(files.dataDir, (ref) =>
      files.resolve(ref.scopeId, ref.path),
    ),
    private authorship = new AuthorshipStore(files.dataDir),
    private you?: YourAiService,
  ) {
    this.sessions = new SessionStore(files.dataDir);
    // An unwritable history is a whole-device fault, so every run stops.
    this.conversations = new ConversationStore(files.dataDir, () => {
      for (const run of [...this.runs.values()]) {
        this.publish(
          run,
          'error',
          t(
            '会話履歴を保存できません。実行を停止します。',
            'Could not save the conversation history. Stopping the run.',
          ),
        );
        void this.cancel(run.binding.scopeId);
      }
    });
  }
  busy(scopeId: string) {
    return this.runs.has(scopeId) || this.resetting.has(scopeId) || this.delegated.has(scopeId);
  }
  /** Whether `scopeId` is your AI's own id rather than a brain's. */
  private isYou(scopeId: string) {
    return !!this.you?.rootOf(scopeId);
  }
  /** The folder a run works in: a brain's root, or your AI's folder. */
  private root(scopeId: string) {
    return this.you?.rootOf(scopeId) ?? this.files.get(scopeId).root;
  }
  get anyBusy() {
    return this.runs.size > 0 || this.resetting.size > 0;
  }
  runningScopes() {
    return [...this.runs.keys()];
  }
  private binding(scopeId: string, agent: AgentId): SessionBinding {
    return { scopeId, agent, root: this.root(scopeId) };
  }
  session(scopeId: string, agent: AgentId) {
    return this.sessions.status(this.binding(scopeId, agent));
  }
  /**
   * The saved conversation and the requests its run is waiting on now. A request
   * is kept only as status text in the history, so a view opened while it waits
   * takes the live one from here.
   */
  async conversation(scopeId: string, agent: AgentId): Promise<Conversation> {
    const value = await this.conversations.read(this.binding(scopeId, agent));
    const requests = [...this.requests.values()]
      .filter(
        ({ run }) =>
          run.binding.scopeId === scopeId &&
          run.binding.agent === agent &&
          run.id === value.activeRunId,
      )
      .map(({ event }) => event);
    return { ...value, requests };
  }
  queueMessage(input: StartRun) {
    input = startInput.parse(input);
    requireAgentAccess(input.agent, input.access);
    if (input.newSession)
      throw Error(
        t(
          '新しい会話は送信待ちを完了してから開始してください。',
          'Finish the queued instructions before starting a new conversation.',
        ),
      );
    const run = this.runs.get(input.scopeId);
    if (this.resetting.has(input.scopeId) || (run && run.binding.agent !== input.agent))
      throw Error(
        t(
          'このスペースで実行中のCLIに指示を追加してください。',
          'Add instructions to the CLI running in this space.',
        ),
      );
    return this.conversations.enqueue(this.binding(input.scopeId, input.agent), input);
  }
  removeQueued(scopeId: string, agent: AgentId, id: string) {
    return this.conversations.remove(this.binding(scopeId, agent), id);
  }
  async startQueued(scopeId: string, agent: AgentId, id: string, canStart = () => {}) {
    const { queued } = await this.conversation(scopeId, agent);
    const next = queued[0];
    if (!next || next.id !== id)
      throw Error(t('送信待ちの順序が変わりました。', 'The queue order has changed.'));
    canStart();
    const runId = this.start({ ...next, scopeId, agent }, id);
    await this.runs.get(scopeId)!.accepted;
    return runId;
  }
  async startAccepted(input: StartRun) {
    const id = this.start(input);
    await this.runs.get(input.scopeId)!.accepted;
    return id;
  }
  flush() {
    return this.conversations.flush();
  }
  async resetSession(scopeId: string, agent: AgentId) {
    if (this.busy(scopeId))
      throw Error(
        t(
          '実行を停止してから会話の継続をリセットしてください。',
          'Stop the run before resetting the conversation.',
        ),
      );
    this.resetting.add(scopeId);
    try {
      if ((await this.conversation(scopeId, agent)).queued.length)
        throw Error(
          t(
            '送信待ちを完了または取り消してから会話をリセットしてください。',
            'Finish or cancel the queued instructions before resetting the conversation.',
          ),
        );
      await this.sessions.reset(this.binding(scopeId, agent));
    } finally {
      this.resetting.delete(scopeId);
    }
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
            detail:
              id === 'pi'
                ? t(
                    'Piのネイティブ設定を使用。標準のツール実行には許可ダイアログがありません。プロジェクト拡張はPi側の信頼設定に従います。',
                    "Uses Pi's native settings. Standard tool runs have no permission dialog. Project extensions follow Pi's trust settings.",
                  )
                : id === 'opencode'
                  ? t(
                      'OpenCodeのネイティブ認証・モデル・権限設定を使用。ask要求をパネルで確認します。',
                      "Uses OpenCode's native sign-in, model and permission settings. Its ask requests appear in the panel.",
                    )
                  : t('既存のCLI認証・設定を使用', "Uses the CLI's existing sign-in and settings"),
          };
        } catch (e) {
          return { id, version: '', available: false, tested: false, detail: String(e) };
        }
      }),
    );
  }
  start(input: StartRun, queuedId?: string): string {
    input = startInput.parse(input);
    const access = requireAgentAccess(input.agent, input.access);
    if (this.busy(input.scopeId))
      throw Error('This space is already running an agent. Stop it before starting another.');
    if (!input.prompt.trim() || input.prompt.length > 32000)
      throw Error('Enter an instruction (up to 32,000 characters)');
    this.root(input.scopeId);
    const brains = [...new Set(input.brains ?? [])];
    if (this.isYou(input.scopeId)) {
      if (input.agent !== 'claude')
        throw Error(
          t('あなたの AI は今は Claude Code で動きます。', 'Your AI runs on Claude Code for now.'),
        );
      if (input.notePath || input.personLines || input.sources?.length)
        throw Error(
          t(
            'あなたの AI にはノートや資料を直接渡せません。Brain を渡してください。',
            'Your AI takes brains, not notes or materials.',
          ),
        );
      for (const scopeId of brains) {
        const space = this.files.get(scopeId);
        if (this.busy(scopeId))
          throw Error(
            t(
              `${space.name} の AI が作業中です。終わってからあなたの AI に渡してください。`,
              `${space.name}'s AI is working. Hand it to your AI after it finishes.`,
            ),
          );
      }
    } else if (brains.length) throw Error('Only your AI takes brains');
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
      access,
      queuedId,
      accepted,
      accept,
      reject,
      cancelled: false,
      abort: new AbortController(),
      closed,
      close,
    };
    this.runs.set(input.scopeId, run);
    for (const scopeId of brains) this.delegated.set(scopeId, run.id);
    // Let the IPC caller bind the returned run id before first events arrive.
    setTimeout(() => void this.execute(run, input), 0);
    return run.id;
  }
  private event(run: Run, type: AgentEvent['type'], text: string, extra: Partial<AgentEvent> = {}) {
    const event = this.publish(run, type, text, extra);
    this.record(run, event);
    return event;
  }
  private record(run: Run, event: AgentEvent) {
    if (run.recorded)
      void this.conversations.event(run.binding, event).catch(() => {
        this.publish(
          run,
          'error',
          t(
            '会話履歴を保存できません。実行を停止します。',
            'Could not save the conversation history. Stopping the run.',
          ),
        );
        void this.cancel(run.binding.scopeId);
      });
  }
  private publish(
    run: Run,
    type: AgentEvent['type'],
    text: string,
    extra: Partial<AgentEvent> = {},
  ) {
    const event = {
      runId: run.id,
      scopeId: run.binding.scopeId,
      agent: run.binding.agent,
      type,
      text,
      ...extra,
    };
    this.emit(event);
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
  async cancel(scopeId?: string) {
    if (scopeId === undefined) {
      await Promise.all(this.runningScopes().map((id) => this.cancel(id)));
      return;
    }
    const run = this.runs.get(scopeId);
    if (!run) return;
    run.cancelled = true;
    run.abort.abort();
    this.denyRequests(run);
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
  private async execute(run: Run, input: StartRun) {
    // Your AI hands work on, so its runs may take longer than a brain's own.
    const minutes = this.isYou(input.scopeId) ? 30 : 10;
    const timer = setTimeout(() => {
      this.event(
        run,
        'error',
        t(
          `実行時間の上限（${minutes}分）に達しました。`,
          `The run reached its time limit (${minutes} minutes).`,
        ),
      );
      void this.cancel(run.binding.scopeId);
    }, minutes * 60000);
    let outcome: AgentEvent['outcome'] = 'completed';
    let resuming = false;
    let record: RunRecord | undefined;
    try {
      await this.conversations.begin(run.binding, run.id, input, run.queuedId);
      run.recorded = true;
      run.accept();
      if (input.newSession)
        this.publish(run, 'status', t('新しい会話を開始します。', 'Starting a new conversation.'));
      this.publish(run, 'status', input.prompt, { role: 'user' });
      if (run.cancelled) return;
      const you = this.isYou(input.scopeId);
      const space = you
        ? { root: this.root(input.scopeId), name: t('あなたの AI のフォルダ', "your AI's folder") }
        : this.files.get(input.scopeId);
      const promptParts: string[] = [];
      if (you && input.brains?.length) {
        const names = brainAgentNames(this.files.list());
        const handed = input.brains.map((scopeId) => this.files.get(scopeId));
        const defined = await this.you!.defined(handed.map((brain) => names.get(brain.scopeId)!));
        const brains = handed.map((brain) => ({
          scopeId: brain.scopeId,
          name: brain.name,
          category: brain.category && categoryName(brain.category),
          agent: names.get(brain.scopeId)!,
          root: brain.root,
          defined: defined.has(names.get(brain.scopeId)!),
        }));
        run.delegation = { you: space.root, brains };
        promptParts.push(brainsPreamble(brains));
      }
      if (input.notePath) {
        await this.files.resolve(input.scopeId, input.notePath);
        promptParts.push(
          `The user selected this note in the active KB: ${JSON.stringify(input.notePath)}. Read its current saved bytes before editing.`,
        );
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
      const selectedSkill = !input.skill
        ? undefined
        : you
          ? parseSkill(
              input.skill,
              (await this.you!.read(`.agents/skills/${input.skill}/SKILL.md`)).text,
            )
          : await requireSkill(this.files, input.scopeId, input.skill);
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
          'Explicitly selected source observations (preserve native access permissions):\n' +
            record.sources
              .map((source) =>
                JSON.stringify({
                  scopeId: source.scopeId,
                  path: source.path,
                  sourceId: source.id,
                  sha256: source.hash,
                  snapshot: this.knowledge.blobPath(source.hash),
                }),
              )
              .join('\n') +
            '\nRetained snapshots are read-only references: never modify them. Read these observed bytes when grounding an artifact; report if access is unavailable.',
        );
      promptParts.push(input.prompt);
      let prompt = promptParts.join('\n\n');
      if (selectedSkill) prompt = promptWithSkill(selectedSkill, prompt);
      const binding = this.binding(input.scopeId, input.agent);
      if (input.newSession) await this.sessions.reset(binding);
      const previous = await this.sessions.read(binding);
      // Native sessions can retain approvals. A policy change starts a fresh
      // native conversation, while irori's display history remains available.
      const saved = previous?.access === run.access ? previous : undefined;
      if (previous && !saved)
        this.event(
          run,
          'status',
          t(
            'アクセス設定が変わったため、新しい会話で実行します。表示履歴は残ります。',
            'The access setting changed, so this runs in a new conversation. The displayed history stays.',
          ),
        );
      resuming = !!saved;
      if (run.cancelled) return;
      if (saved)
        this.event(
          run,
          'status',
          t('保存済みの会話を引き継ぎます。', 'Continuing the saved conversation.'),
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
      if (input.agent === 'codex')
        await this.codex(run, space.root, prompt, binding, saved?.handle);
      else if (input.agent === 'claude')
        await this.claude(run, space.root, prompt, binding, saved?.handle);
      else {
        // The same word Claude Code gets from its hook, through each CLI's own
        // hook: which of the person's lines a file tool call would change.
        const bridge = await personLinesBridge(
          this.files.dataDir,
          input.agent,
          (tool, edit) => personLinesNotice(this.files, this.authorship, input.scopeId, tool, edit),
          agentEnv(),
        );
        run.bridge = bridge.close;
        const context: NativeContext = {
          cwd: space.root,
          prompt,
          session: saved?.handle,
          access: run.access,
          env: bridge.env,
          args: bridge.args,
          signal: run.abort.signal,
          child: (child) => {
            run.child = child;
          },
          event: (type, text, extra) => this.event(run, type, text, extra),
          ask: (text, details, questions) => this.ask(run, text, details, questions),
          saveSession: (handle) => this.sessions.save(binding, handle, run.access),
        };
        if (input.agent === 'pi') await runPi(context);
        else await runOpenCode(context);
      }
    } catch (e) {
      run.reject(e);
      if (!run.cancelled) {
        outcome = 'failed';
        this.event(run, 'error', String(e));
        if (resuming)
          this.event(
            run,
            'error',
            t(
              '前回の会話を引き継ぐ実行に失敗しました。再試行するか、会話の継続をリセットして新しい会話を始めてください。',
              'The run continuing the previous conversation failed. Try again, or reset the conversation and start a new one.',
            ),
          );
      }
    } finally {
      clearTimeout(timer);
      this.denyRequests(run);
      if (run.child) await killTree(run.child).catch(() => {});
      run.bridge?.();
      run.rpc?.fail(Error('Run finished'));
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
        runId: run.id,
        type: 'done',
        outcome,
        text:
          outcome === 'completed'
            ? t('完了', 'Completed')
            : outcome === 'cancelled'
              ? t('停止しました', 'Stopped')
              : t('実行に失敗しました', 'Run failed'),
      };
      if (run.recorded) {
        try {
          await this.conversations.finish(run.binding, done);
        } catch {
          done.outcome = 'failed';
          done.text = t(
            '実行は終了しましたが、会話履歴を保存できませんでした。変更内容を確認してください。',
            'The run finished, but the conversation history could not be saved. Review the changes.',
          );
        }
      }
      if (this.runs.get(run.binding.scopeId) === run) this.runs.delete(run.binding.scopeId);
      for (const [scopeId, holder] of this.delegated)
        if (holder === run.id) this.delegated.delete(scopeId);
      this.publish(run, 'done', done.text, { outcome: done.outcome });
      run.close();
    }
  }
  private async codex(
    run: Run,
    cwd: string,
    prompt: string,
    binding: SessionBinding,
    session?: string,
  ) {
    const child = launch('codex', ['app-server', '--listen', 'stdio://'], cwd);
    run.child = child;
    let finished = false;
    let failure: Error | undefined;
    const completion = new Promise<void>((resolve) => {
      run.finish = () => {
        finished = true;
        resolve();
      };
    });
    let stderr = '';
    child.stderr!.on('data', (b) => {
      stderr = (stderr + b).slice(-6000);
    });
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
            details: JSON.stringify(p.item).slice(0, 16000),
          });
        if (m.method === 'item/completed' && p.item?.type === 'fileChange')
          this.event(run, 'tool', t('ファイルを変更しました', 'Changed files'), {
            details: JSON.stringify(p.item).slice(0, 16000),
          });
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
    const params = {
      cwd,
      approvalPolicy: run.access === 'full-access' ? 'never' : 'on-request',
      approvalsReviewer: 'user',
      sandbox: run.access === 'full-access' ? 'danger-full-access' : 'workspace-write',
    };
    const thread = await rpc.request(
      session ? 'thread/resume' : 'thread/start',
      session ? { ...params, threadId: session } : params,
    );
    run.threadId = thread.thread.id;
    await this.sessions.save(binding, thread.thread.id, run.access);
    if (run.cancelled) return;
    const turn = await rpc.request('turn/start', {
      threadId: run.threadId,
      input: [{ type: 'text', text: prompt, text_elements: [] }],
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
              answers: reply.allow
                ? [reply.answers?.[q.id] ?? ''].flat()
                : ['User declined to answer.'],
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
  ) {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    let stderr = '';
    let sawResult = false;
    let streamed = false;
    const delegation = run.delegation;
    // Hand-offs by the delegation's tool call, and each sub-agent's id by the
    // hand-off it runs: every step and request of a sub-agent names its brain.
    const tasks = new Map<string, string>();
    const agentTasks = new Map<string, string>();
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
          taskWaiters.set(agentId, resolve);
          setTimeout(() => resolve(agentTasks.get(agentId)), 3000);
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
        env: agentEnv(),
        settingSources: ['user', 'project', 'local'],
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        permissionMode: run.access === 'full-access' ? 'bypassPermissions' : 'default',
        allowDangerouslySkipPermissions: run.access === 'full-access',
        includePartialMessages: true,
        resume: session,
        ...(delegation && { additionalDirectories: delegation.brains.map((brain) => brain.root) }),
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
          child.stderr!.on('data', (b) => {
            stderr = (stderr + b).slice(-6000);
          });
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
              : { behavior: 'deny', message: 'User declined to answer' };
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
            : { behavior: 'deny', message: 'The user denied this operation.' };
        },
      },
    });
    try {
      for await (const msg of response) {
        if (run.cancelled) break;
        if (msg.type === 'system' && msg.subtype === 'init')
          await this.sessions.save(binding, msg.session_id, run.access);
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
                details: JSON.stringify(block.input).slice(0, 16000),
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
