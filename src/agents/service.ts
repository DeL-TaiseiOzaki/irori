import { KnowledgeStore } from '../knowledge/store';
import { AuthorshipStore } from '../knowledge/authorship';
import { authorshipSummary, type RunRecord } from '../domain/knowledge';
import { randomUUID } from 'node:crypto';
import type { ChildProcess, ChildProcessWithoutNullStreams } from 'node:child_process';
import type {
  AgentEvent,
  AgentId,
  AgentInfo,
  AgentAnswers,
  Question,
  StartRun,
} from '../domain/types';
import { agentIds, agentNames } from '../domain/types';
import { runPi } from './pi';
import { runOpenCode } from './opencode';
import type { NativeContext } from './adapter';
import { agentEnv, killTree, launch, version } from './process';
import { Rpc, type Message } from './rpc';
import type { FileService } from '../host/files';
import { SessionStore, type SessionBinding } from './sessions';
import { ConversationStore } from './conversations';
import { startInput } from '../domain/conversation';
import { promptWithSkill } from '../domain/skills';
import { requireSkill } from '../host/skills';
type Reply = { allow: boolean; answers?: AgentAnswers };
type Run = {
  id: string;
  binding: SessionBinding;
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
  private requests = new Map<string, { run: Run; reply: (reply: Reply) => void }>();
  constructor(
    private files: FileService,
    private emit: (event: AgentEvent) => void,
    private knowledge = new KnowledgeStore(files.dataDir, (ref) =>
      files.resolve(ref.scopeId, ref.path),
    ),
    private authorship = new AuthorshipStore(files.dataDir),
  ) {
    this.sessions = new SessionStore(files.dataDir);
    // An unwritable history is a whole-device fault, so every run stops.
    this.conversations = new ConversationStore(files.dataDir, () => {
      for (const run of [...this.runs.values()]) {
        this.publish(run, 'error', '会話履歴を保存できません。実行を停止します。');
        void this.cancel(run.binding.scopeId);
      }
    });
  }
  busy(scopeId: string) {
    return this.runs.has(scopeId) || this.resetting.has(scopeId);
  }
  get anyBusy() {
    return this.runs.size > 0 || this.resetting.size > 0;
  }
  runningScopes() {
    return [...this.runs.keys()];
  }
  /** The run a space is executing, for observations that have to name it. */
  current(scopeId: string) {
    const run = this.runs.get(scopeId);
    return run ? { agent: run.binding.agent, runId: run.id } : undefined;
  }
  private binding(scopeId: string, agent: AgentId): SessionBinding {
    return { scopeId, agent, root: this.files.get(scopeId).root };
  }
  session(scopeId: string, agent: AgentId) {
    return this.sessions.status(this.binding(scopeId, agent));
  }
  conversation(scopeId: string, agent: AgentId) {
    return this.conversations.read(this.binding(scopeId, agent));
  }
  queueMessage(input: StartRun) {
    input = startInput.parse(input);
    if (input.newSession) throw Error('新しい会話は送信待ちを完了してから開始してください。');
    const run = this.runs.get(input.scopeId);
    if (this.resetting.has(input.scopeId) || (run && run.binding.agent !== input.agent))
      throw Error('このスペースで実行中のCLIに指示を追加してください。');
    return this.conversations.enqueue(this.binding(input.scopeId, input.agent), input);
  }
  removeQueued(scopeId: string, agent: AgentId, id: string) {
    return this.conversations.remove(this.binding(scopeId, agent), id);
  }
  async startQueued(scopeId: string, agent: AgentId, id: string, canStart = () => {}) {
    const { queued } = await this.conversation(scopeId, agent);
    const next = queued[0];
    if (!next || next.id !== id) throw Error('送信待ちの順序が変わりました。');
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
    if (this.busy(scopeId)) throw Error('実行を停止してから会話の継続をリセットしてください。');
    this.resetting.add(scopeId);
    try {
      if ((await this.conversation(scopeId, agent)).queued.length)
        throw Error('送信待ちを完了または取り消してから会話をリセットしてください。');
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
                ? 'Piのネイティブ設定を使用。標準のツール実行には許可ダイアログがありません。プロジェクト拡張はPi側の信頼設定に従います。'
                : id === 'opencode'
                  ? 'OpenCodeのネイティブ認証・モデル・権限設定を使用。ask要求をパネルで確認します。'
                  : '既存のCLI認証・設定を使用',
          };
        } catch (e) {
          return { id, version: '', available: false, tested: false, detail: String(e) };
        }
      }),
    );
  }
  start(input: StartRun, queuedId?: string): string {
    input = startInput.parse(input);
    if (this.busy(input.scopeId))
      throw Error('This space is already running an agent. Stop it before starting another.');
    if (!input.prompt.trim() || input.prompt.length > 32000)
      throw Error('Enter an instruction (up to 32,000 characters)');
    this.files.get(input.scopeId);
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
    // Let the IPC caller bind the returned run id before first events arrive.
    setTimeout(() => void this.execute(run, input), 0);
    return run.id;
  }
  private event(run: Run, type: AgentEvent['type'], text: string, extra: Partial<AgentEvent> = {}) {
    const event = this.publish(run, type, text, extra);
    if (run.recorded)
      void this.conversations.event(run.binding, event).catch(() => {
        this.publish(run, 'error', '会話履歴を保存できません。実行を停止します。');
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
  private ask(run: Run, text: string, details: unknown, questions?: Question[]): Promise<Reply> {
    if (run.cancelled) return Promise.resolve({ allow: false });
    const requestId = randomUUID();
    return new Promise((resolve) => {
      this.requests.set(requestId, { run, reply: resolve });
      this.event(run, questions ? 'question' : 'permission', text, {
        requestId,
        details: JSON.stringify(details, null, 2).slice(0, 24000),
        questions,
      });
    });
  }
  respond(id: string, allow: boolean, answers?: AgentAnswers) {
    const pending = this.requests.get(id);
    if (!pending) throw Error('This request has already ended');
    this.requests.delete(id);
    pending.reply({ allow, answers });
  }
  /** Denies and forgets every request one run is waiting on, leaving other runs' requests alone. */
  private denyRequests(run: Run) {
    for (const [id, pending] of [...this.requests]) {
      if (pending.run !== run) continue;
      this.requests.delete(id);
      pending.reply({ allow: false });
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
    const timer = setTimeout(() => {
      this.event(run, 'error', '実行時間の上限（10分）に達しました。');
      void this.cancel(run.binding.scopeId);
    }, 600000);
    let outcome: AgentEvent['outcome'] = 'completed';
    let resuming = false;
    let record: RunRecord | undefined;
    try {
      await this.conversations.begin(run.binding, run.id, input, run.queuedId);
      run.recorded = true;
      run.accept();
      if (input.newSession) this.publish(run, 'status', '新しい会話を開始します。');
      this.publish(run, 'status', input.prompt, { role: 'user' });
      if (run.cancelled) return;
      const space = this.files.get(input.scopeId);
      const promptParts: string[] = [];
      if (input.notePath) {
        await this.files.resolve(input.scopeId, input.notePath);
        promptParts.push(
          `The user selected this note in the active KB: ${JSON.stringify(input.notePath)}. Read its current saved bytes before editing.`,
        );
        // Line numbers are those of the saved bytes the agent is told to read.
        const note = { scopeId: input.scopeId, path: input.notePath };
        const summary = await this.files
          .read(input.scopeId, input.notePath)
          .then((doc) => this.authorship.view(note, doc.text))
          .then(authorshipSummary)
          .catch(() => undefined);
        if (summary) promptParts.push(summary);
      }
      const selectedSkill = input.skill
        ? await requireSkill(this.files, input.scopeId, input.skill)
        : undefined;
      if (selectedSkill)
        this.event(run, 'status', `${selectedSkill.name} スキルの手順で実行します。`);
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
      const saved = await this.sessions.read(binding);
      resuming = !!saved;
      if (run.cancelled) return;
      if (saved) this.event(run, 'status', '保存済みの会話を引き継ぎます。');
      this.event(run, 'status', `${agentNames[input.agent]} を ${space.name} で実行中`);
      if (input.agent === 'codex')
        await this.codex(run, space.root, prompt, binding, saved?.handle);
      else if (input.agent === 'claude')
        await this.claude(run, space.root, prompt, binding, saved?.handle);
      else {
        const context: NativeContext = {
          cwd: space.root,
          prompt,
          session: saved?.handle,
          signal: run.abort.signal,
          child: (child) => {
            run.child = child;
          },
          event: (type, text, extra) => this.event(run, type, text, extra),
          ask: (text, details, questions) => this.ask(run, text, details, questions),
          saveSession: (handle) => this.sessions.save(binding, handle),
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
            '前回の会話を引き継ぐ実行に失敗しました。再試行するか、会話の継続をリセットして新しい会話を始めてください。',
          );
      }
    } finally {
      clearTimeout(timer);
      this.denyRequests(run);
      if (run.child) await killTree(run.child).catch(() => {});
      run.rpc?.fail(Error('Run finished'));
      if (run.cancelled) outcome = 'cancelled';
      if (record)
        await this.knowledge.finish(record, outcome).catch(() => {
          this.event(run, 'error', '実行結果の記録に失敗しました。資料の保持版は残っています。');
        });
      const done: AgentEvent = {
        runId: run.id,
        type: 'done',
        outcome,
        text:
          outcome === 'completed'
            ? '完了'
            : outcome === 'cancelled'
              ? '停止しました'
              : '実行に失敗しました',
      };
      if (run.recorded) {
        try {
          await this.conversations.finish(run.binding, done);
        } catch {
          done.outcome = 'failed';
          done.text =
            '実行は終了しましたが、会話履歴を保存できませんでした。変更内容を確認してください。';
        }
      }
      if (this.runs.get(run.binding.scopeId) === run) this.runs.delete(run.binding.scopeId);
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
          this.event(run, 'tool', 'ファイルを変更しました', {
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
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      sandbox: 'workspace-write',
    };
    const thread = await rpc.request(
      session ? 'thread/resume' : 'thread/start',
      session ? { ...params, threadId: session } : params,
    );
    run.threadId = thread.thread.id;
    await this.sessions.save(binding, thread.thread.id);
    this.event(run, 'status', 'Codex: ワークスペース書き込み・必要時に許可を確認');
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
      const reply = await this.ask(run, p.reason ?? '実行の許可', p);
      result = { decision: reply.allow ? 'accept' : 'decline' };
    } else if (m.method === 'item/tool/requestUserInput') {
      const questions: Question[] = p.questions.map((q: any) => ({
        id: q.id,
        title: q.question,
        options: q.options?.map((o: any) => o.label),
      }));
      const reply = await this.ask(run, 'エージェントからの質問', p, questions);
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
      const reply = await this.ask(run, p.reason ?? '追加アクセスの許可', p);
      result = { permissions: reply.allow ? p.permissions : {}, scope: 'turn' };
    } else {
      // Unsupported forms/dynamic tools must never be implicitly approved.
      this.event(run, 'error', `未対応の要求を拒否しました: ${m.method}`);
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
    const response = query({
      prompt,
      options: {
        cwd,
        pathToClaudeCodeExecutable: 'claude',
        env: agentEnv(),
        settingSources: ['user', 'project', 'local'],
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        permissionMode: 'default',
        includePartialMessages: true,
        resume: session,
        abortController: run.abort,
        spawnClaudeCodeProcess: (options) => {
          const child = launch(options.command, options.args, options.cwd ?? cwd, options.env);
          run.child = child;
          child.stderr!.on('data', (b) => {
            stderr = (stderr + b).slice(-6000);
          });
          return child as ChildProcessWithoutNullStreams;
        },
        canUseTool: async (tool, input) => {
          if (tool === 'AskUserQuestion') {
            const questions = (input.questions as any[]).map((q) => ({
              id: q.question,
              title: q.question,
              options: q.options?.map((o: any) => o.label),
              multiple: q.multiSelect === true,
            }));
            const reply = await this.ask(run, 'Claude Code からの質問', input, questions);
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
          const reply = await this.ask(run, `${tool} の許可`, input);
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
          await this.sessions.save(binding, msg.session_id);
        if (msg.type === 'stream_event') {
          const event = msg.event;
          if (event.type === 'message_start') streamed = false;
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            streamed = true;
            this.event(run, 'text', event.delta.text);
          }
        }
        if (msg.type === 'assistant')
          for (const block of msg.message.content) {
            if (block.type === 'text' && !streamed) this.event(run, 'text', block.text);
            if (block.type === 'tool_use')
              this.event(run, 'tool', block.name, {
                details: JSON.stringify(block.input).slice(0, 16000),
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
