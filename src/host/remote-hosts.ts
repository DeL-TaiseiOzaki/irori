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
} from '../domain/types';
import type { KnowledgeSearch } from '../domain/search';
import {
  remoteHostInput,
  sshDestination,
  type RemoteFolders,
  type RemoteHost,
  type RemoteHostAbout,
  type RemoteHostInput,
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
import type { ForwardedRead, HandOffState } from '../remote/protocol';
import { readLocalJson, writeLocalJson } from './local-json';
import { SerialQueue } from './serial-queue';
import {
  ConnectionEnded,
  RemoteLink,
  type RemoteLauncher,
  type RemotePayload,
} from './remote-link';

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
  retry?: NodeJS.Timeout;
  retries: number;
};

/** How soon a host that just refused is tried again by itself. */
const cooldown = 4000;
const notYet = () =>
  t(
    'SSH ホストにある vault では、まだこの操作はできません。',
    'This is not available yet for a vault on an SSH host.',
  );

export interface RemoteHostsOptions {
  dataDir: string;
  launcher(host: { destination: string; port?: number }): RemoteLauncher;
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
    if (!live) this.live.set(id, (live = { state: 'offline', handOffs: new Map(), retries: 0 }));
    return live;
  }
  private shown(record: HostRecord): RemoteHost {
    const { state, detail, about } = this.state(record.id);
    return {
      id: record.id,
      name: record.name,
      destination: record.destination,
      ...(record.port && { port: record.port }),
      state,
      ...(detail && { detail }),
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
    live.link?.close();
    live.link = undefined;
    live.failed = undefined;
    this.set(id, 'offline');
  }

  /** The open connection to a host, opened first when there is none. */
  private link(id: string): Promise<RemoteLink> {
    const record = this.record(id);
    const live = this.state(id);
    if (live.link?.connected) return Promise.resolve(live.link);
    if (live.opening) return live.opening;
    if (live.failed && Date.now() - live.failed.at < cooldown)
      return Promise.reject(live.failed.error);
    const link = new RemoteLink({
      launcher: this.options.launcher(record),
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
          live.retries = 0;
          this.set(id, 'connected');
          await this.refresh(id, link).catch(() => {});
          return link;
        },
        (error: Error) => {
          live.failed = { at: Date.now(), error };
          this.set(id, 'error', error.message);
          throw error;
        },
      )
      .finally(() => {
        live.opening = undefined;
      });
    return live.opening;
  }
  /** Connects to a host now, as the person asks to; a failure a moment ago is tried again. */
  async connect(id: string) {
    this.state(id).failed = undefined;
    await this.link(id);
    return this.shown(this.record(id));
  }
  private closed(id: string, link: RemoteLink) {
    const live = this.state(id);
    if (live.link !== link) return;
    if (this.closing) return;
    this.set(id, 'offline');
    // A hand-off goes on there; this device comes back for its report.
    if (live.handOffs.size) this.retry(id);
  }
  private retry(id: string) {
    const live = this.state(id);
    clearTimeout(live.retry);
    if (this.closing || !live.handOffs.size) return;
    const wait = Math.min(60_000, 2000 * 2 ** Math.min(live.retries++, 5));
    live.retry = setTimeout(() => {
      live.failed = undefined;
      this.link(id).then(
        (link) => this.resume(id, link),
        () => this.retry(id),
      );
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
    if (event.type === 'files') {
      if (this.has(event.scopeId)) this.options.emit(event);
    } else if (event.type === 'agent') {
      const entry = this.state(id).handOffs.get(event.event.runId);
      if (entry) this.followed(id, entry, event.event);
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
    if (this.state(host.id).handOffs.size)
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
        const link = await this.link(id);
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
      live.link?.close();
    }
  }
}
