import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { t, type Language } from '../domain/i18n';
import type {
  AgentAnswers,
  AgentEvent,
  AgentId,
  Category,
  Document,
  Entry,
  HostEvent,
  Space,
  StartRun,
} from '../domain/types';
import type { KnowledgeSearch } from '../domain/search';
import {
  remoteHostInput,
  sshDestination,
  type RemoteFolders,
  type RemoteHost,
  type RemoteHostAbout,
  type RemoteHostInput,
  type RemoteHostQuestion,
  type RemoteHostState,
} from '../domain/remote-hosts';
import type {
  HandOff,
  HandOffResult,
  HandedTask,
  RemoteBrief,
  RemoteVault,
  RemoteVaults,
} from '../agents/remote-vaults';
import {
  hostArity,
  isByConversation,
  type ForwardedAgent,
  type ForwardedRead,
  type HandOffState,
} from '../remote/protocol';
import type { AttachmentRef } from '../domain/attachments';
import type { Conversation, ConversationRow } from '../domain/conversation';
import { readLocalJson, writeLocalJson } from './local-json';
import { SerialQueue } from './serial-queue';
import {
  ConnectionEnded,
  LoginCancelled,
  RemoteLink,
  type RemoteLauncher,
  type RemotePayload,
} from './remote-link';
import type { AskLogin, LoginQuestion, LoginSession } from './ssh-askpass';

/** A vault on a host as this device last saw it, so that it shows while the host is away. */
const vaultRecord = z
  .object({
    schemaVersion: z.literal(1),
    scopeId: z.uuid(),
    name: z.string().min(1),
    root: z.string().min(1),
    contents: z.array(z.string()),
  })
  .loose();
const hostRecord = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(60),
  destination: sshDestination,
  port: z.number().int().min(1).max(65535).optional(),
  vaults: z.array(vaultRecord).max(200).default([]),
});
type HostRecord = z.infer<typeof hostRecord>;

type Follow = {
  follow(event: AgentEvent): void;
  settle(result: HandOffResult): void;
  /** Requests already shown, so that one sent again after a reconnection is not shown twice. */
  seen: Set<string>;
};
type Live = {
  state: RemoteHostState;
  detail?: string;
  about?: RemoteHostAbout;
  link?: RemoteLink;
  opening?: Promise<RemoteLink>;
  /** When the last attempt failed, and with what: asked again at once, the same answer is given. */
  failed?: { at: number; error: Error };
  handOffs: Map<string, Follow>;
  /**
   * Runs of its vaults' agents this device has seen begin there and not end, with
   * what the window needs to close them should the host lose them.
   */
  runs: Map<string, Pick<AgentEvent, 'scopeId' | 'conversationId' | 'agent'>>;
  retry?: NodeJS.Timeout;
  retries: number;
  /** What `ssh` asks the person for this host's login, the first of them shown. */
  questions: (RemoteHostQuestion & { answer(value: string | undefined): void })[];
  /** The words of what the login under way has asked so far. */
  asked?: Set<string>;
  /**
   * Set once a login that asked the person failed or was given no answer: no
   * login asks again by itself, only when they connect.
   */
  hold?: Error;
};

/** How a question of `ssh` is answered: yes or no, nothing at all, or words to type. */
const questionKind = ({ text, hint }: LoginQuestion): RemoteHostQuestion['kind'] =>
  hint === 'none'
    ? 'notice'
    : hint === 'confirm' ||
        /\(yes\/no(\/\[fingerprint\])?\)\?\s*$/.test(text) ||
        /^Please type 'yes', 'no' or the fingerprint/.test(text)
      ? 'confirm'
      : 'secret';

/**
 * How long a host that could not be reached is left alone by what the window
 * reads by itself; the person's 接続 tries at once.
 */
const cooldown = 30_000;
const notYet = () =>
  t(
    'SSH ホストにある vault では、まだこの操作はできません。',
    'This is not available yet for a vault on an SSH host.',
  );

export interface RemoteHostsOptions {
  dataDir: string;
  /** `ssh` for a host. With a `session`, what it asks while signing in is asked through it. */
  launcher(host: { destination: string; port?: number }, session?: LoginSession): RemoteLauncher;
  /** Where the person can be asked what `ssh` asks; without it no login asks anything. */
  logins?: { session(ask: AskLogin): LoginSession | undefined };
  payload: RemotePayload;
  language(): Language;
  /** The ids of the vaults on this device: a vault is registered in one place only. */
  localScopes(): string[];
  emit(event: HostEvent): void;
  /** Shows the person what a host's vault host asks, and answers with their choice. */
  ask(host: RemoteHost, question: string, params: unknown): Promise<unknown>;
}

/**
 * The SSH hosts this device knows and the vaults on them (ADR 061). A host's
 * vaults are served by irori's vault host there, reached through `ssh`; this
 * keeps the connections, the list of those vaults, and what an agent run on this
 * device does with them.
 */
export class RemoteHosts implements RemoteVaults {
  private records: HostRecord[] = [];
  private live = new Map<string, Live>();
  /** Requests that runs on hosts wait on, by id, with the host each is on. */
  private asked = new Map<string, string>();
  /** The conversations of vault agents on hosts this device has seen, with the host of each. */
  private conversations = new Map<string, string>();
  private queue = new SerialQueue();
  private closing = false;
  constructor(private options: RemoteHostsOptions) {}
  private get file() {
    return path.join(this.options.dataDir, 'remote-hosts.json');
  }
  async init() {
    const parsed = z.array(hostRecord).safeParse(await readLocalJson(this.file, []));
    if (parsed.success) this.records = parsed.data;
    else console.warn('SSH hosts could not be read', parsed.error.message);
  }
  private save() {
    return writeLocalJson(this.file, this.records);
  }
  private record(id: string) {
    const found = this.records.find((item) => item.id === id);
    if (!found) throw Error(t('SSH ホストが見つかりません。', 'The SSH host was not found.'));
    return found;
  }
  private state(id: string) {
    let live = this.live.get(id);
    if (!live)
      this.live.set(
        id,
        (live = {
          state: 'offline',
          handOffs: new Map(),
          runs: new Map(),
          retries: 0,
          questions: [],
        }),
      );
    return live;
  }
  private shown(record: HostRecord): RemoteHost {
    const { state, detail, about, questions } = this.state(record.id);
    const [asking] = questions;
    return {
      id: record.id,
      name: record.name,
      destination: record.destination,
      ...(record.port && { port: record.port }),
      state,
      ...(asking
        ? { detail: t('入力を待っています', 'Waiting for your answer') }
        : detail && { detail }),
      ...(asking && {
        asking: {
          id: asking.id,
          text: asking.text,
          kind: asking.kind,
          ...(asking.again && { again: true }),
        },
      }),
      ...(about && { about }),
      vaults: record.vaults.length,
    };
  }
  private set(id: string, state: RemoteHostState, detail?: string) {
    const live = this.state(id);
    if (live.state === state && live.detail === detail) return;
    live.state = state;
    live.detail = detail;
    this.options.emit({ type: 'hosts' });
  }

  hosts(): RemoteHost[] {
    return this.records.map((record) => this.shown(record));
  }
  /** The vaults on SSH hosts, each with its host. */
  list(): RemoteVault[] {
    return this.records.flatMap((record) =>
      record.vaults.map((vault) => ({
        ...(vault as unknown as Space),
        host: { id: record.id, name: record.name },
      })),
    );
  }
  /** Whether a vault with this id lives on an SSH host. */
  has(scopeId: unknown): scopeId is string {
    return (
      typeof scopeId === 'string' &&
      this.records.some((record) => record.vaults.some((vault) => vault.scopeId === scopeId))
    );
  }
  /** Where a vault on a host is: the host as `ssh` reaches it, and the folder there. */
  where(scopeId: string) {
    if (!this.has(scopeId)) return undefined;
    const record = this.hostOf(scopeId);
    const vault = record.vaults.find((item) => item.scopeId === scopeId)!;
    return {
      name: record.name,
      destination: record.destination,
      ...(record.port && { port: record.port }),
      root: vault.root,
    };
  }
  private hostOf(scopeId: string) {
    const record = this.records.find((item) =>
      item.vaults.some((vault) => vault.scopeId === scopeId),
    );
    if (!record) throw Error(t('vault が見つかりません。', 'The vault was not found.'));
    return record;
  }

  /** Adds a host, or changes one's name, destination or port. */
  saveHost(input: RemoteHostInput) {
    return this.queue.run(async () => {
      const value = remoteHostInput.parse(input);
      const taken = this.records.find((item) => item.name === value.name && item.id !== value.id);
      if (taken)
        throw Error(t('同じ名前の SSH ホストがあります。', 'An SSH host with that name exists.'));
      const previous = value.id ? this.record(value.id) : undefined;
      const next: HostRecord = {
        id: previous?.id ?? randomUUID(),
        name: value.name,
        destination: value.destination,
        ...(value.port && { port: value.port }),
        vaults: previous?.vaults ?? [],
      };
      const moved =
        previous && (previous.destination !== next.destination || previous.port !== next.port);
      this.records = previous
        ? this.records.map((item) => (item.id === next.id ? next : item))
        : [...this.records, next];
      await this.save();
      // Another destination is another connection.
      if (moved) this.drop(next.id);
      this.options.emit({ type: 'hosts' });
      return this.shown(next);
    });
  }
  /** Forgets a host. Its vaults go off this device's list first, one by one. */
  removeHost(id: string) {
    return this.queue.run(async () => {
      const record = this.record(id);
      if (record.vaults.length)
        throw Error(
          t(
            'この SSH ホストの vault を一覧から外してから削除してください。',
            "Take this SSH host's vaults off the list before removing it.",
          ),
        );
      this.drop(id);
      this.live.delete(id);
      this.records = this.records.filter((item) => item.id !== id);
      await this.save();
      this.options.emit({ type: 'hosts' });
    });
  }
  private drop(id: string) {
    const live = this.state(id);
    clearTimeout(live.retry);
    live.retry = undefined;
    live.link?.close();
    live.link = undefined;
    live.failed = undefined;
    live.hold = undefined;
    for (const question of [...live.questions]) question.answer(undefined);
    this.set(id, 'offline');
  }

  /** Shows the person what `ssh` asks for a host's login, and resolves with their answer. */
  private question(id: string, asked: LoginQuestion, gone: AbortSignal) {
    const live = this.state(id);
    return new Promise<string | undefined>((resolve) => {
      const question = {
        id: randomUUID(),
        text: asked.text,
        kind: questionKind(asked),
        // `ssh` says only on its error output that an answer was wrong; it asks again in the same words.
        again: live.asked?.has(asked.text) ?? false,
        answer: (value: string | undefined) => {
          const at = live.questions.indexOf(question);
          if (at < 0) return;
          live.questions.splice(at, 1);
          this.options.emit({ type: 'hosts' });
          resolve(value);
        },
      };
      (live.asked ??= new Set()).add(asked.text);
      live.questions.push(question);
      // The login that ended, or the program that asked going away, takes the question back.
      gone.addEventListener('abort', () => question.answer(undefined), { once: true });
      this.options.emit({ type: 'hosts' });
    });
  }
  /** The person's answer to a question of `ssh`; `null` gives none, which ends that login. */
  answer(hostId: string, questionId: string, value: string | null) {
    const question = this.state(hostId).questions.find((item) => item.id === questionId);
    if (!question)
      throw Error(t('この質問はもう終わっています。', 'This question has already ended.'));
    question.answer(value ?? undefined);
  }

  /**
   * The open connection to a host, opened first when there is none. `quiet` is a
   * login nobody asked for at this moment (a retry on a timer): it asks the person nothing.
   */
  private link(id: string, quiet = false): Promise<RemoteLink> {
    const record = this.record(id);
    const live = this.state(id);
    if (live.link?.connected) return Promise.resolve(live.link);
    if (live.opening) return live.opening;
    if (live.hold && !quiet) return Promise.reject(live.hold);
    if (live.failed && Date.now() - live.failed.at < cooldown)
      return Promise.reject(live.failed.error);
    let asked = false;
    live.asked = undefined;
    const session = quiet
      ? undefined
      : this.options.logins?.session((question, gone) => {
          asked = true;
          return this.question(id, question, gone);
        });
    const link = new RemoteLink({
      launcher: this.options.launcher(record, session),
      payload: this.options.payload,
      language: this.options.language,
      onEvent: (event) => this.event(id, event),
      ask: (question, params) => this.options.ask(this.shown(this.record(id)), question, params),
      onProgress: (detail) => this.set(id, 'connecting', detail),
      onClosed: () => this.closed(id, link),
    });
    // What the last connection had received carries over, so that nothing between is missed.
    link.seq = live.link?.seq;
    this.set(id, 'connecting');
    live.opening = link
      .connect()
      .then(
        async (reply) => {
          live.link = link;
          live.about = reply.about;
          live.failed = undefined;
          live.hold = undefined;
          live.retries = 0;
          this.set(id, 'connected');
          await this.refresh(id, link).catch(() => {});
          await this.resume(id, link).catch(() => {});
          // The events missed while away came before the answer to that request; a run
          // still open after them, on a host where nothing runs, ended unseen.
          if (!reply.running) this.lost(id);
          return link;
        },
        (error: Error) => {
          live.failed = { at: Date.now(), error };
          // The person was asked and it did not work, or they gave no answer: what the
          // window reads by itself does not ask them again.
          if (asked || error instanceof LoginCancelled) live.hold = error;
          this.set(id, 'error', error.message);
          throw error;
        },
      )
      .finally(() => {
        live.opening = undefined;
      });
    return live.opening;
  }
  /**
   * Connects to a host now, as the person asks to: a failure a moment ago is tried
   * again, and what `ssh` asks is asked again.
   */
  async connect(id: string) {
    const live = this.state(id);
    live.failed = undefined;
    live.hold = undefined;
    await this.link(id);
    return this.shown(this.record(id));
  }
  private closed(id: string, link: RemoteLink) {
    const live = this.state(id);
    if (live.link !== link) return;
    if (this.closing) return;
    this.set(id, 'offline');
    // A run goes on there; this device comes back for its report, and for the rest of what it shows.
    if (this.awaited(live)) this.retry(id);
  }
  /** Whether this device waits on something running on a host: a hand-off, or a vault agent's run. */
  private awaited(live: Live) {
    return live.handOffs.size > 0 || live.runs.size > 0;
  }
  /**
   * Tries a host again after a while, for the hand-offs and runs waiting on it;
   * one attempt is scheduled at a time.
   */
  private retry(id: string) {
    const live = this.state(id);
    if (this.closing || !this.awaited(live) || live.retry) return;
    const wait = Math.min(60_000, 2000 * 2 ** Math.min(live.retries++, 5));
    live.retry = setTimeout(() => {
      live.retry = undefined;
      live.failed = undefined;
      // Nobody is asked for a retry of irori's own: a host that needs an answer waits for the person.
      this.link(id, true).catch(() => this.retry(id));
    }, wait);
  }
  /** After a reconnection: where each hand-off stands, and what it still asks. */
  private async resume(id: string, link: RemoteLink) {
    const live = this.state(id);
    for (const [runId, entry] of [...live.handOffs]) {
      const state = await link
        .request<HandOffState>('handOffState', [runId])
        .catch(() => undefined);
      if (!state) continue;
      if (state.state === 'unknown') {
        live.handOffs.delete(runId);
        entry.settle({
          outcome: 'failed',
          report: '',
          error: 'The SSH host no longer knows this hand-off; its vault host was restarted.',
        });
      } else if (state.state === 'running')
        for (const event of state.pending) this.followed(id, entry, event);
    }
  }
  /** Brings this device's record of a host's vaults up to date with the host. */
  private async refresh(id: string, link: RemoteLink) {
    const there = z.array(vaultRecord).parse(await link.request('spaces', []));
    await this.queue.run(async () => {
      const record = this.record(id);
      const next = record.vaults.map(
        (vault) => there.find((item) => item.scopeId === vault.scopeId) ?? vault,
      );
      if (JSON.stringify(next) === JSON.stringify(record.vaults)) return;
      record.vaults = next;
      await this.save();
      this.options.emit({ type: 'vaults' });
    });
  }
  private event(id: string, event: HostEvent) {
    if (!event || typeof event !== 'object') return;
    if (event.type === 'files') {
      if (typeof event.scopeId === 'string' && this.has(event.scopeId)) this.options.emit(event);
    } else if (event.type === 'agent' && event.event && typeof event.event === 'object') {
      const entry = this.state(id).handOffs.get(event.event.runId);
      if (entry) this.followed(id, entry, event.event);
      this.relay(id, event.event);
    }
  }
  /**
   * A run of a vault's agent there is shown here as one of this device is (ADR 061,
   * amended 0.2.79): its events go to the windows, and what it asks is answered here.
   */
  private relay(id: string, event: AgentEvent) {
    if (
      typeof event.scopeId !== 'string' ||
      typeof event.runId !== 'string' ||
      !this.has(event.scopeId)
    )
      return;
    // Never let a remote host overwrite a conversation or request already owned by another host or local hand-off.
    const holderIds = new Set([...this.live.values()].flatMap((live) => [...live.handOffs.keys()]));
    if (
      typeof event.conversationId === 'string' &&
      event.conversationId &&
      !holderIds.has(event.conversationId) &&
      (!this.conversations.has(event.conversationId) ||
        this.conversations.get(event.conversationId) === id)
    )
      this.conversations.set(event.conversationId, id);
    if (
      (event.type === 'permission' || event.type === 'question') &&
      typeof event.requestId === 'string' &&
      event.requestId &&
      (!this.asked.has(event.requestId) || this.asked.get(event.requestId) === id)
    )
      this.asked.set(event.requestId, id);
    else if (event.type === 'status' && event.resolved && this.asked.get(event.resolved) === id)
      this.asked.delete(event.resolved);
    const runs = this.state(id).runs;
    if (event.type === 'done') runs.delete(event.runId);
    else if (!runs.has(event.runId))
      runs.set(event.runId, {
        scopeId: event.scopeId,
        conversationId: event.conversationId,
        agent: event.agent,
      });
    this.options.emit({ type: 'agent', event });
  }
  /**
   * With nothing running on a host: ends, in the windows, the runs it no longer has
   * (its vault host was restarted), and forgets what they asked.
   */
  private lost(id: string) {
    for (const [requestId, host] of [...this.asked]) if (host === id) this.asked.delete(requestId);
    const runs = this.state(id).runs;
    for (const [runId, run] of [...runs]) {
      runs.delete(runId);
      const base = { ...run, runId };
      this.options.emit({
        type: 'agent',
        event: {
          ...base,
          type: 'error',
          text: t(
            'SSH ホストでこの実行が見つからなくなりました（vault host が再起動されました）。',
            'The SSH host no longer has this run; its vault host was restarted.',
          ),
        },
      });
      this.options.emit({
        type: 'agent',
        event: { ...base, type: 'done', text: '', outcome: 'failed' },
      });
    }
  }
  private followed(id: string, entry: Follow, event: AgentEvent) {
    if (event.type === 'permission' || event.type === 'question') {
      if (!event.requestId || entry.seen.has(event.requestId)) return;
      entry.seen.add(event.requestId);
      this.asked.set(event.requestId, id);
    } else if (event.type === 'status' && event.resolved) this.asked.delete(event.resolved);
    entry.follow(event);
  }

  /** The folders in a folder of a host, its home when none is named. */
  async folders(hostId: string, folder?: string): Promise<RemoteFolders> {
    return (await this.link(hostId)).request('folders', folder ? [folder] : []);
  }
  /** Registers a folder of a host as a vault; one whose id is already on this device or another host is refused. */
  async register(hostId: string, root: string, name: string, category: Category) {
    const link = await this.link(hostId);
    const known = new Set(
      z
        .array(vaultRecord)
        .parse(await link.request('spaces', []))
        .map((v) => v.scopeId),
    );
    let vault: z.infer<typeof vaultRecord>;
    try {
      vault = vaultRecord.parse(await link.request('registerVault', [root, name, category]));
    } catch (error) {
      // Registered there already, by this device before or by another of the person's.
      const there = z.array(vaultRecord).parse(await link.request('spaces', []));
      const folders = await this.folders(hostId, root).catch(() => undefined);
      const found = folders && there.find((item) => item.root === folders.path);
      if (!found) throw error;
      vault = found;
    }
    return this.queue.run(async () => {
      const record = this.record(hostId);
      if (record.vaults.some((item) => item.scopeId === vault.scopeId))
        return { ...(vault as unknown as Space), host: { id: record.id, name: record.name } };
      if (this.options.localScopes().includes(vault.scopeId) || this.has(vault.scopeId)) {
        // Left as it was found: a vault this call registered there is taken off again.
        if (!known.has(vault.scopeId))
          await link.request('unregisterVault', [vault.scopeId]).catch(() => {});
        throw Error(
          t(
            'この vault は、このコンピューターか別の SSH ホストにすでに登録されています。同じ vault を登録できるのは 1 か所だけです。',
            'This vault is already registered on this computer or on another SSH host. One vault is registered in one place only.',
          ),
        );
      }
      record.vaults = [...record.vaults, vault];
      await this.save();
      this.options.emit({ type: 'hosts' });
      this.options.emit({ type: 'vaults' });
      return { ...(vault as unknown as Space), host: { id: record.id, name: record.name } };
    });
  }
  /**
   * Takes a vault on a host off this device's list. Its folder stays as it is;
   * the host forgets it too when it can be reached.
   */
  async unregister(scopeId: string) {
    const host = this.hostOf(scopeId);
    const live = this.state(host.id);
    if (live.handOffs.size || [...live.runs.values()].some((run) => run.scopeId === scopeId))
      throw Error(
        t(
          'この SSH ホストでの実行が終わってから外してください。',
          'Take it off after the run on this SSH host finishes.',
        ),
      );
    const link = await this.link(host.id).catch(() => undefined);
    await link?.request('unregisterVault', [scopeId]).catch(() => {});
    await this.queue.run(async () => {
      const record = this.record(host.id);
      record.vaults = record.vaults.filter((vault) => vault.scopeId !== scopeId);
      await this.save();
      this.options.emit({ type: 'hosts' });
      this.options.emit({ type: 'vaults' });
    });
  }

  /** Asks the host of a vault. */
  private async request<T>(scopeId: string, method: string, args: unknown[]): Promise<T> {
    return (await this.link(this.hostOf(scopeId).id)).request<T>(method, args);
  }
  /** One of the HostAPI's reads, answered by the vault's host. */
  forward<T>(scopeId: string, method: ForwardedRead, args: unknown[]): Promise<T> {
    return this.request<T>(scopeId, method, args);
  }
  /** What a vault on a host refuses for now, in the words the window shows. */
  static notYet = notYet;

  /** Whether a conversation is one of a vault agent's on a host. */
  keeps(conversationId: unknown): conversationId is string {
    return typeof conversationId === 'string' && this.conversations.has(conversationId);
  }
  /** Whether a request waiting for an answer was asked by a run on a host. */
  asks(requestId: unknown): requestId is string {
    return typeof requestId === 'string' && this.asked.has(requestId);
  }
  /**
   * One of the HostAPI's operations on a vault's own agent, answered by its host
   * (ADR 061, amended 0.2.79): the operations that name a vault go to its host, and
   * those that name a conversation to the host it was seen on.
   */
  async agent<T>(method: ForwardedAgent, args: unknown[]): Promise<T> {
    const [first] = args;
    let id: string;
    if (isByConversation(method)) {
      const known = typeof first === 'string' && this.conversations.get(first);
      if (!known) throw Error(t('会話が見つかりません。', 'The conversation was not found.'));
      id = known;
    } else {
      const scopeId =
        first && typeof first === 'object' && 'scopeId' in first ? first.scopeId : first;
      id = this.hostOf(scopeId as string).id;
    }
    const sent = args.slice(0, hostArity[method] ?? args.length);
    while (sent.length && sent.at(-1) === undefined) sent.pop();
    const value = await (await this.link(id)).request<T>(method, sent);
    this.learn(id, method, args, value);
    return value;
  }
  /** Remembers which host keeps the conversations, and asks the requests, an answer names. */
  private learn(id: string, method: ForwardedAgent, args: unknown[], value: unknown) {
    if (method === 'agentConversations')
      for (const row of value as ConversationRow[]) this.conversations.set(row.id, id);
    else if (method === 'queueAgentMessage' || method === 'start') {
      const { conversationId } = args[0] as StartRun;
      if (conversationId) this.conversations.set(conversationId, id);
    } else if (method === 'agentConversation') {
      const conversation = value as Conversation;
      if (conversation.id) this.conversations.set(conversation.id, id);
      for (const request of conversation.requests ?? [])
        if (request.requestId) this.asked.set(request.requestId, id);
    } else if (method === 'createConversation' || method === 'forkConversation')
      this.conversations.set(value as string, id);
    else if (method === 'deleteConversation') this.conversations.delete(args[0] as string);
  }
  /** Puts a file the person attached here on a vault's host, under the same id. */
  async attach(scopeId: string, ref: AttachmentRef, bytes: Uint8Array) {
    await this.request(scopeId, 'attach', [ref, bytes]);
  }

  brief(scopeId: string, agent: AgentId): Promise<RemoteBrief> {
    return this.request(scopeId, 'brief', [scopeId, agent]);
  }
  entries(scopeId: string, folder: string): Promise<Entry[]> {
    return this.forward(scopeId, 'entries', [scopeId, folder]);
  }
  read(scopeId: string, file: string): Promise<Document> {
    return this.forward(scopeId, 'read', [scopeId, file]);
  }
  search(scopeId: string, query: string): Promise<KnowledgeSearch> {
    return this.forward(scopeId, 'search', [scopeId, query]);
  }
  send(scopeId: string, name: string, bytes: Uint8Array): Promise<string> {
    return this.request(scopeId, 'sendFile', [scopeId, name, bytes]);
  }
  async handOff(
    task: HandedTask,
    from: string | undefined,
    follow: (event: AgentEvent) => void,
  ): Promise<HandOff> {
    const id = this.hostOf(task.scopeId).id;
    const live = this.state(id);
    const link = await this.link(id);
    let settle!: (result: HandOffResult) => void;
    const result = new Promise<HandOffResult>((resolve) => {
      settle = resolve;
    });
    const entry: Follow = { follow, settle, seen: new Set() };
    const { runId } = await link.request<{ runId: string }>(
      'handOff',
      from ? [task, from] : [task],
      // Listening before the run's first event, which may arrive with this answer.
      (started) => live.handOffs.set(started.runId, entry),
    );
    void this.collect(id, runId, entry);
    return {
      cancel: async () => {
        await (await this.link(id)).request('cancelHandOff', [runId]);
      },
      result,
    };
  }
  /** Waits for a hand-off's end on its host, across reconnections, and settles it. */
  private async collect(id: string, runId: string, entry: Follow) {
    const live = this.state(id);
    const done = (result: HandOffResult) => {
      live.handOffs.delete(runId);
      entry.settle(result);
    };
    while (live.handOffs.get(runId) === entry && !this.closing) {
      try {
        const link = await this.link(id, true);
        const ended = await link.request<HandOffResult>('awaitHandOff', [runId]);
        void link.request('forgetHandOff', [runId]).catch(() => {});
        return done(ended);
      } catch (error) {
        if (error instanceof ConnectionEnded || !this.state(id).link?.connected) {
          // The run goes on there; this waits for the connection to come back.
          this.retry(id);
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }
        return done({
          outcome: 'failed',
          report: '',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  async respond(requestId: string, allow: boolean, answers?: AgentAnswers) {
    const id = this.asked.get(requestId);
    if (!id) throw Error('This request has already ended');
    await (
      await this.link(id)
    ).request('respond', answers ? [requestId, allow, answers] : [requestId, allow]);
  }
  /** Ends every connection. The vault hosts go on by themselves while an agent works there. */
  close() {
    this.closing = true;
    for (const live of this.live.values()) {
      clearTimeout(live.retry);
      for (const question of [...live.questions]) question.answer(undefined);
      live.link?.close();
    }
  }
}
