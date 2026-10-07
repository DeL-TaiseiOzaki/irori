import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  agentIds,
  agentNames,
  type AgentEvent,
  type AgentId,
  type StartRun,
} from '../domain/types';
import {
  conversationMeta,
  conversationName,
  conversationTitle,
  messageInput,
  queuedMessage,
  type ConversationMeta,
  type ConversationOwner,
  type ConversationRow,
  type ConversationSummary,
  type QueuedMessage,
} from '../domain/conversation';
import { readLocalJson, writeLocalFile, writeLocalJson } from '../host/local-json';
import { SerialQueue } from '../host/serial-queue';
import type { DeviceIdentity } from '../host/device';
import { t } from '../domain/i18n';

const MiB = 1024 * 1024;
/** A tool's details are kept to their first 1 MiB (ADR 017 D1). */
export const detailLimit = MiB;
/** What a view gets of an event's details; the conversation keeps up to `detailLimit`. */
export const viewDetails = 16000;
/** Streamed text is written in lines of at most this many characters, all under one id. */
const lineText = MiB;
/** A longer line is not read. */
const lineLimit = 8 * MiB;
const metaLimit = 64 * 1024;
const queueLimit = MiB;
/** The newest events a view is sent; the file keeps all of them. */
const viewEvents = 1000;
const viewBytes = 8 * MiB;
/** `events.jsonl` is read from its end this many bytes at a time. */
const chunkSize = 256 * 1024;
/** How many conversations keep the count of the lines before their view window. */
const countedLimit = 256;

const delegate = z.object({
  scopeId: z.string(),
  task: z.string(),
  state: z.enum(['started', 'working', 'reported', 'failed']),
});
/**
 * One line of `events.jsonl`. Permission and question requests are kept as status
 * text, never as something to answer. Lines of a streamed reply share its id and
 * are joined when read.
 */
export const storedEvent = z.object({
  id: z.uuid(),
  runId: z.string().min(1).max(200),
  at: z.iso.datetime(),
  role: z.enum(['user', 'agent']),
  type: z.enum(['status', 'text', 'tool', 'error', 'done']),
  text: z.string(),
  details: z.string().optional(),
  /** The bytes `details` had before being kept to their first 1 MiB. */
  cut: z.number().int().positive().optional(),
  outcome: z.enum(['completed', 'failed', 'cancelled']).optional(),
  delegate: delegate.optional(),
  call: z.string().max(400).optional(),
  result: z.literal(true).optional(),
});
export type StoredEvent = z.infer<typeof storedEvent>;

/**
 * What only this device knows of a conversation (ADR 017 D2): the instructions
 * waiting to be sent and the run in progress. Kept in irori's data directory,
 * never in the conversations folder.
 */
export const deviceState = z
  .object({
    schemaVersion: z.literal(1),
    conversationId: z.uuid(),
    owner: z.uuid(),
    agent: z.enum(agentIds),
    queued: z.array(queuedMessage).max(20),
    active: z
      .object({
        runId: z.uuid(),
        /** The id of the person's message that started it. */
        eventId: z.uuid(),
        at: z.iso.datetime(),
        input: messageInput,
      })
      .optional(),
  })
  .strict();
export type DeviceState = z.infer<typeof deviceState>;

export const conversationsFolder = (dataDir: string) => path.join(dataDir, 'conversations');
export const stateFolder = (dataDir: string) => path.join(dataDir, 'conversation-state');
/** A checkout path as a conversation records it, so no local path enters its folder. */
export const rootDigest = (root: string) => createHash('sha256').update(root).digest('hex');
const uuidName = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

/** Keeps a value to its first `limit` UTF-8 bytes, on a character boundary. */
export function cutBytes(value: string, limit: number): { value: string; cut?: number } {
  if (value.length * 3 <= limit) return { value };
  const bytes = Buffer.from(value);
  if (bytes.length <= limit) return { value };
  let end = limit;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return { value: bytes.subarray(0, end).toString('utf8'), cut: bytes.length };
}

/**
 * One line of `events.jsonl`. JSON leaves U+2028 and U+2029 unescaped, and some
 * line readers split at them; escaped, a line ends only at its newline.
 */
export const jsonLine = (value: unknown) =>
  JSON.stringify(value)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029') + '\n';
/** An event as `events.jsonl` keeps it. */
export function storedLine(event: AgentEvent, at = new Date().toISOString()): StoredEvent {
  const details = event.details === undefined ? undefined : cutBytes(event.details, detailLimit);
  return storedEvent.parse({
    id: event.id ?? randomUUID(),
    runId: event.runId,
    at,
    role: event.role === 'user' ? 'user' : 'agent',
    type: event.type === 'permission' || event.type === 'question' ? 'status' : event.type,
    text: event.text,
    details: details?.value,
    cut: details?.cut ?? event.cut,
    outcome: event.outcome,
    delegate: event.delegate,
    call: event.call,
    result: event.result || undefined,
  });
}

/**
 * The lines of `[start, end)` in a file, newest first, each with the byte it starts
 * at: `start` and `end` lie on line boundaries. A line over `lineLimit` is given
 * without its text, and a blank line is left out. The file is read from the end
 * a chunk at a time, so a caller that stops early never reads the rest.
 */
async function* linesBackward(
  handle: fs.FileHandle,
  start: number,
  end: number,
): AsyncGenerator<{ line?: string; offset: number }> {
  let tail: Buffer[] = [];
  let tailSize = 0;
  let skipping = false;
  const give = (bytes: Buffer, offset: number) => {
    const line = bytes.toString('utf8');
    return line.trim() ? { line, offset } : undefined;
  };
  while (end > start) {
    const from = Math.max(start, end - chunkSize);
    const chunk = Buffer.allocUnsafe(end - from);
    for (let read = 0; read < chunk.length;) {
      const { bytesRead } = await handle.read(chunk, read, chunk.length - read, from + read);
      if (!bytesRead) throw Error('events.jsonl ended before its recorded size');
      read += bytesRead;
    }
    let stop = chunk.length;
    while (stop > 0) {
      const newline = chunk.lastIndexOf(10, stop - 1);
      if (newline < 0) break;
      const offset = from + newline + 1;
      if (skipping) {
        skipping = false;
        yield { offset };
      } else {
        const head = chunk.subarray(newline + 1, stop);
        const given = give(tail.length ? Buffer.concat([head, ...tail]) : head, offset);
        if (given) yield given;
      }
      tail = [];
      tailSize = 0;
      stop = newline;
    }
    if (!skipping && stop > 0) {
      tail.unshift(chunk.subarray(0, stop));
      tailSize += stop;
      // A line longer than the limit is counted once and skipped without holding it.
      if (tailSize > lineLimit) {
        skipping = true;
        tail = [];
        tailSize = 0;
      }
    }
    end = from;
  }
  if (skipping) yield { offset: start };
  else if (tail.length) {
    const given = give(Buffer.concat(tail), start);
    if (given) yield given;
  }
}

/** What a stored line says of itself without being parsed: its id and kind, when it has the shape of one. */
const lineShape = (line: string) => {
  line = line.trimEnd();
  if (line[0] !== '{' || !line.endsWith('}')) return undefined;
  const id = /"id":"([0-9a-f-]{36})"/.exec(line);
  const type = /"type":"(status|text|tool|error|done)"/.exec(line);
  return id && type ? { id: id[1], type: type[1] } : undefined;
};

/**
 * The newest events as a view gets them, taken newest first. Lines of one streamed
 * reply join into its event; an older event is taken while fewer than `viewEvents`
 * are kept and those kept are within `viewBytes`, so the event crossing the byte
 * limit stays, as it did when the file was read from its start.
 */
class ViewWindow {
  private kept: StoredEvent[] = [];
  private bytes = 0;
  /** False when the window is complete and `line` begins an older event. */
  take(line: StoredEvent) {
    const oldest = this.kept.at(-1);
    if (line.type === 'text' && oldest?.type === 'text' && oldest.id === line.id) {
      oldest.text = line.text + oldest.text;
      this.bytes += Buffer.byteLength(line.text);
      return true;
    }
    if (this.kept.length >= viewEvents || this.bytes > viewBytes) return false;
    // Copy the shortened string: a slice can keep the full tool output alive.
    const details =
      line.details && line.details.length > viewDetails
        ? structuredClone(line.details.slice(0, viewDetails))
        : line.details;
    this.kept.push({ ...line, details });
    this.bytes += Buffer.byteLength(line.text) + (details?.length ?? 0);
    return true;
  }
  get events() {
    return [...this.kept].reverse();
  }
}

function viewEvent(line: StoredEvent, meta: ConversationMeta): AgentEvent {
  const { at: _at, role, details, ...rest } = line;
  return {
    ...rest,
    conversationId: meta.id,
    scopeId: meta.owner.id,
    agent: meta.agent,
    ...(role === 'user' && { role: 'user' as const }),
    ...(details !== undefined && {
      details: details.length > viewDetails ? details.slice(0, viewDetails) : details,
    }),
  };
}

/** How a run's conversation is found or made, and what a new one says about itself. */
export interface Placement {
  owner: ConversationOwner;
  agent: AgentId;
  /** A new conversation may be made under this id: one the host chose, not one a view named. */
  create?: boolean;
  title?: string;
  titleSource?: ConversationMeta['titleSource'];
  routine?: ConversationMeta['routine'];
  handedBy?: ConversationMeta['handedBy'];
}
export interface OpenConversation {
  meta: ConversationMeta;
  events: AgentEvent[];
  earlier: number;
  damaged: number;
  queued: QueuedMessage[];
  activeRunId?: string;
}
export type NativeSession = ConversationMeta['native'][string];

/**
 * The conversations irori keeps (ADR 017): a folder per conversation with its
 * metadata and its events, and beside them, in the data directory, what this
 * device is doing with each. Writes to one conversation go through one queue;
 * different conversations write independently.
 */
export class ConversationStore {
  readonly folder: string;
  private stateDir: string;
  private queues = new Map<string, SerialQueue>();
  private metas = new Map<string, ConversationMeta>();
  private damagedMetas = new Map<string, { owner?: string; reason: string }>();
  private states = new Map<string, DeviceState>();
  private damagedStates = new Map<string, Error>();
  /** Ids given to new conversations that have not had an instruction yet. */
  private reserved = new Map<string, { owner: string; agent: AgentId }>();
  private buffers = new Map<string, StoredEvent[]>();
  /** Conversations whose `events.jsonl` is known to end with a newline. */
  private terminated = new Set<string>();
  /**
   * What the lines before a conversation's view window add up to, as far as `offset`:
   * the events they hold and the damaged ones among them. The file is append-only
   * and the window only moves on, so a later read counts from there.
   */
  private counted = new Map<
    string,
    { offset: number; events: number; damaged: number; lastText?: string }
  >();
  private scanned?: Promise<void>;
  private loaded?: Promise<void>;
  private timer?: NodeJS.Timeout;
  private clock = 0;
  constructor(
    dataDir: string,
    private device: DeviceIdentity,
    private onError: (error: unknown) => void = () => {},
  ) {
    this.folder = conversationsFolder(dataDir);
    this.stateDir = stateFolder(dataDir);
  }
  /** Runs `operation` after the conversation's earlier ones; a conversation at rest keeps no queue. */
  private queued<T>(id: string, operation: () => Promise<T>) {
    let queue = this.queues.get(id);
    if (!queue) this.queues.set(id, (queue = new SerialQueue()));
    return queue.run(operation).finally(() => {
      if (queue.busy || this.queues.get(id) !== queue) return;
      this.queues.delete(id);
      // Its file's end is checked again before the next write, unless a run is still adding to it.
      if (!this.states.get(id)?.active && !this.buffers.has(id)) this.terminated.delete(id);
    });
  }
  /** A time never earlier than the last one given, so queue order and last update are strict. */
  private now() {
    this.clock = Math.max(Date.now(), this.clock + 1);
    return new Date(this.clock).toISOString();
  }
  private dir(id: string) {
    if (!uuidName.test(id)) throw Error('Invalid conversation id');
    return path.join(this.folder, id);
  }
  private async checkedDir(id: string) {
    const dir = this.dir(id);
    if (!(await fs.lstat(dir)).isDirectory())
      throw Error(
        t(
          '会話のフォルダが通常のフォルダではありません。',
          'The conversation folder is not an ordinary folder.',
        ),
      );
    return dir;
  }

  /** Reads this device's queues and recovers runs an earlier host left unfinished. */
  private init() {
    this.loaded ??= (async () => {
      const names = await fs.readdir(this.stateDir).catch((error) => {
        if (missing(error)) return [] as string[];
        throw error;
      });
      for (const name of names) {
        const id = name.replace(/\.json$/, '');
        if (!name.endsWith('.json') || !uuidName.test(id)) continue;
        try {
          const value = deviceState.parse(
            await readLocalJson(path.join(this.stateDir, name), undefined),
          );
          if (value.conversationId !== id)
            throw Error('The pending record names another conversation');
          this.states.set(id, value);
        } catch (error) {
          this.damagedStates.set(id, error as Error);
        }
      }
      // A new host cannot establish whether the old native turn completed. Never requeue it.
      // Every operation waits for this first, so it needs no conversation's queue.
      for (const [id, state] of this.states)
        if (state.active)
          await this.recover(id, state).catch((error) =>
            this.damagedStates.set(id, error as Error),
          );
    })();
    return this.loaded;
  }
  private async recover(id: string, state: DeviceState) {
    const active = state.active!;
    // Its message is among the newest lines; older ones are not read. A line the
    // crash cut short is not the message, even if its id survived the cut.
    let found = false;
    await this.withEvents(id, async (handle, size) => {
      for await (const { line } of linesBackward(handle, 0, size)) {
        if (!line?.includes(`"id":"${active.eventId}"`)) continue;
        try {
          found = storedEvent.parse(JSON.parse(line)).id === active.eventId;
        } catch {
          continue;
        }
        if (found) break;
      }
    });
    const lines: StoredEvent[] = [];
    // The run was claimed and its message not yet written: the message comes back from the claim.
    if (!found)
      lines.push(
        storedLine(
          {
            id: active.eventId,
            runId: active.runId,
            type: 'status',
            role: 'user',
            text: active.input.prompt,
          },
          active.at,
        ),
      );
    lines.push(
      storedLine({
        runId: active.runId,
        type: 'error',
        text: t(
          '前回の実行結果は未確認です。この指示は再送していません。',
          'The previous run did not report its result. This instruction was not sent again.',
        ),
      }),
    );
    await this.append(id, lines);
    await this.writeState({ ...state, active: undefined });
  }
  private usable(id: string) {
    const damaged = this.damagedStates.get(id);
    if (damaged)
      throw Error(
        t(
          'この会話の送信待ちの記録を読み込めません。',
          "Could not read this conversation's queued instructions.",
        ),
        { cause: damaged },
      );
  }
  private async writeState(state: DeviceState) {
    const file = path.join(this.stateDir, `${state.conversationId}.json`);
    const value = deviceState.parse(state);
    if (!value.queued.length && !value.active) {
      await fs.rm(file, { force: true });
      this.states.delete(value.conversationId);
      return;
    }
    await writeLocalJson(file, value);
    this.states.set(value.conversationId, value);
  }
  private stateOf(meta: ConversationMeta): DeviceState {
    return (
      this.states.get(meta.id) ?? {
        schemaVersion: 1,
        conversationId: meta.id,
        owner: meta.owner.id,
        agent: meta.agent,
        queued: [],
      }
    );
  }

  /** Reads every conversation's metadata once; later writes keep the index current. */
  private scan() {
    this.scanned ??= (async () => {
      const entries = await fs.readdir(this.folder, { withFileTypes: true }).catch((error) => {
        if (missing(error)) return [];
        throw error;
      });
      for (const entry of entries)
        if (uuidName.test(entry.name)) await this.loadMeta(entry.name).catch(() => {});
    })().catch((error) => {
      this.scanned = undefined;
      throw error;
    });
    return this.scanned;
  }
  private async loadMeta(id: string): Promise<ConversationMeta | undefined> {
    const cached = this.metas.get(id);
    if (cached) return cached;
    const dir = this.dir(id);
    const folder = await fs.lstat(dir).catch((error) => {
      if (missing(error)) return undefined;
      throw error;
    });
    if (!folder) return undefined;
    let raw: unknown;
    try {
      if (!folder.isDirectory()) throw Error('The conversation folder is not a directory');
      const file = path.join(dir, 'meta.json');
      const stat = await fs.lstat(file).catch((error) => {
        if (missing(error)) return undefined;
        throw error;
      });
      if (!stat) {
        // A conversation whose creation stopped before its metadata holds nothing yet.
        const events = await fs.lstat(path.join(dir, 'events.jsonl')).catch(() => undefined);
        if (!events?.size) return undefined;
        throw Error('meta.json is missing');
      }
      if (!stat.isFile()) throw Error('meta.json is not a regular file');
      if (stat.size > metaLimit) throw Error('meta.json is too large');
      raw = JSON.parse(await fs.readFile(file, 'utf8'));
      const meta = conversationMeta.parse(raw);
      if (meta.id !== id) throw Error('meta.json names another conversation');
      this.metas.set(id, meta);
      this.damagedMetas.delete(id);
      return meta;
    } catch (error) {
      // Its owner, when that much can still be read, keeps the row in the right list.
      const owner = (raw as { owner?: { id?: unknown } } | undefined)?.owner?.id;
      const reason = t(
        '会話の情報（meta.json）を読み込めません。',
        "Could not read the conversation's details (meta.json).",
      );
      this.damagedMetas.set(id, { owner: typeof owner === 'string' ? owner : undefined, reason });
      throw Error(reason, { cause: error });
    }
  }
  async meta(id: string) {
    const meta = await this.loadMeta(id);
    if (!meta) throw Error(t('この会話はありません。', 'This conversation no longer exists.'));
    return meta;
  }
  private async writeMeta(meta: ConversationMeta) {
    const value = conversationMeta.parse(meta);
    await writeLocalJson(path.join(await this.checkedDir(value.id), 'meta.json'), value);
    this.metas.set(value.id, value);
    return value;
  }
  /** The conversation a run or a queued instruction goes to, made on its first instruction. */
  private async ensure(id: string, placement: Placement, input: StartRun) {
    const meta = await this.loadMeta(id);
    if (meta) {
      if (meta.owner.id !== placement.owner.id)
        throw Error(
          t('この会話は別の持ち主のものです。', 'This conversation belongs to someone else.'),
        );
      if (meta.agent !== placement.agent)
        throw Error(
          t(
            `この会話は ${agentNames[meta.agent]} の会話です。`,
            `This conversation is with ${agentNames[meta.agent]}.`,
          ),
        );
      return meta;
    }
    const reserved = this.reserved.get(id);
    if (
      !placement.create &&
      !(reserved?.owner === placement.owner.id && reserved.agent === placement.agent)
    )
      throw Error(t('この会話はありません。', 'This conversation no longer exists.'));
    const dir = this.dir(id);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await writeLocalFile(path.join(dir, 'events.jsonl'), '');
    const now = this.now();
    const created = await this.writeMeta({
      schemaVersion: 1,
      id,
      owner: placement.owner,
      agent: placement.agent,
      model: input.model ?? null,
      title: placement.title ?? conversationTitle(input.prompt),
      titleSource: placement.titleSource ?? 'first-message',
      createdAt: now,
      updatedAt: now,
      linkedNote: input.notePath ?? null,
      hibachis: [],
      pinned: false,
      archived: false,
      forkedFrom: null,
      ...(placement.routine && { routine: placement.routine }),
      ...(placement.handedBy && { handedBy: placement.handedBy }),
      native: {},
    });
    this.reserved.delete(id);
    return created;
  }

  /** Opens `events.jsonl` for `use`, with its size; a missing file is an empty one. */
  private async withEvents<T>(
    id: string,
    use: (handle: fs.FileHandle, size: number) => Promise<T>,
  ): Promise<T | undefined> {
    const file = path.join(this.dir(id), 'events.jsonl');
    const stat = await fs.lstat(file).catch((error) => {
      if (missing(error)) return undefined;
      throw error;
    });
    if (!stat) return undefined;
    if (!stat.isFile()) throw Error('events.jsonl is not a regular file');
    const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      return await use(handle, stat.size);
    } finally {
      await handle.close();
    }
  }
  /**
   * The events of `events.jsonl` a view gets, read from the end of the file until
   * the window is full, with how many events come before them and how many lines
   * could not be read. The lines before the window are counted by their shape
   * rather than parsed: a line that is not a JSON object naming an id and a kind
   * is damaged, and the lines of one streamed reply are one event. A count made
   * once is kept, so a later read counts only the lines written since.
   */
  private async readWindow(id: string, window: ViewWindow, newerText?: string) {
    let damaged = 0;
    const result = await this.withEvents(id, async (handle, size) => {
      let start = size;
      for await (const { line, offset } of linesBackward(handle, 0, size)) {
        let parsed: StoredEvent | undefined;
        if (line !== undefined)
          try {
            parsed = storedEvent.parse(JSON.parse(line));
          } catch {
            // Counted below as damaged, in the window or before it.
          }
        if (parsed && !window.take(parsed)) break;
        if (!parsed) damaged++;
        start = offset;
      }
      // A count kept for a file that has since been replaced by a shorter one starts over.
      const cached = this.counted.get(id);
      const kept = cached && cached.offset <= start ? cached : undefined;
      const count = kept ? { ...kept } : { offset: 0, events: 0, damaged: 0 };
      // A reply can straddle the window's edge or the counted part's. The text id
      // on the newer side (the unwritten lines, when the window has nothing from
      // the file) joins its lines here; the newest line counted here is kept, so
      // the lines a later turn adds to its reply join it then.
      let lastText = start === size ? newerText : undefined;
      let newest: string | undefined;
      let oldest: { id: string; type: string } | undefined;
      for await (const { line } of linesBackward(handle, count.offset, start)) {
        const shape = line === undefined ? undefined : lineShape(line);
        if (!shape) {
          count.damaged++;
          continue;
        }
        oldest = shape;
        newest ??= shape.type === 'text' && shape.id !== lastText ? shape.id : '';
        if (shape.type === 'text' && shape.id === lastText) continue;
        count.events++;
        lastText = shape.type === 'text' ? shape.id : undefined;
      }
      // The oldest line here may continue the reply the counted part ends with.
      if (kept && oldest?.type === 'text' && oldest.id === kept.lastText) count.events--;
      if (newest !== undefined) count.lastText = newest || undefined;
      count.offset = start;
      this.counted.delete(id);
      this.counted.set(id, count);
      if (this.counted.size > countedLimit) this.counted.delete(this.counted.keys().next().value!);
      return count;
    });
    return { earlier: result?.events ?? 0, damaged: damaged + (result?.damaged ?? 0) };
  }
  private async append(id: string, lines: StoredEvent[]) {
    if (!lines.length) return;
    const file = path.join(await this.checkedDir(id), 'events.jsonl');
    const existing = await fs.lstat(file).catch((error) => {
      if (missing(error)) return undefined;
      throw error;
    });
    if (existing && !existing.isFile()) throw Error('Conversation files must be regular files');
    let text = lines.map(jsonLine).join('');
    const handle = await fs.open(
      file,
      constants.O_RDWR | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    try {
      if (!this.terminated.has(id)) {
        const { size } = await handle.stat();
        if (size) {
          const last = Buffer.alloc(1);
          await handle.read(last, 0, 1, size - 1);
          // A line a crash cut short stays a line of its own, read as damaged.
          if (last[0] !== 0x0a) text = '\n' + text;
        }
      }
      await handle.appendFile(text);
      await handle.sync();
      this.terminated.add(id);
    } catch (error) {
      this.terminated.delete(id);
      throw error;
    } finally {
      await handle.close();
    }
  }

  summary(meta: ConversationMeta): ConversationSummary {
    const state = this.states.get(meta.id);
    return {
      id: meta.id,
      agent: meta.agent,
      model: meta.model,
      title: meta.title,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      linkedNote: meta.linkedNote,
      pinned: meta.pinned,
      archived: meta.archived,
      ...(meta.routine
        ? { origin: 'routine' as const }
        : meta.handedBy
          ? { origin: 'hand-off' as const }
          : {}),
      running: !!state?.active,
      queued: state?.queued.length ?? 0,
    };
  }
  /** The owner's conversations, pinned first and then by last update; damaged ones last. */
  async list(owner: string): Promise<ConversationRow[]> {
    await this.init();
    await this.scan();
    const rows = [...this.metas.values()]
      .filter((meta) => meta.owner.id === owner)
      .map((meta) => this.summary(meta))
      .sort(
        (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt),
      );
    // A folder whose owner cannot be read is listed everywhere, so it can be deleted.
    const damaged = [...this.damagedMetas]
      .filter(([, value]) => !value.owner || value.owner === owner)
      .map(([id, value]) => ({ id, damaged: value.reason }));
    return [...rows, ...damaged];
  }
  /** The owner's latest conversation of its own with this CLI: not a routine's or a hand-off's. */
  async latest(owner: string, agent: AgentId) {
    await this.scan();
    return [...this.metas.values()]
      .filter(
        (meta) =>
          meta.owner.id === owner &&
          meta.agent === agent &&
          !meta.archived &&
          !meta.routine &&
          !meta.handedBy,
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.id;
  }
  /** The conversation to show for an owner: the one running, the one queued longest, or the latest. */
  async current(owner: string, agent: AgentId) {
    await this.init();
    await this.scan();
    for (const state of this.states.values())
      if (state.owner === owner && state.active && this.metas.has(state.conversationId))
        return state.conversationId;
    return this.next(owner)?.conversationId ?? (await this.latest(owner, agent));
  }
  /** The hibachi conversation that work from one of the irori agent's conversations went to. */
  async handed(owner: string, agent: AgentId, from: string) {
    await this.scan();
    return [...this.metas.values()].find(
      (meta) =>
        meta.owner.id === owner && meta.agent === agent && meta.handedBy?.conversationId === from,
    )?.id;
  }
  reserve(owner: string, agent: AgentId) {
    const id = randomUUID();
    this.reserved.set(id, { owner, agent });
    return id;
  }
  reservation(id: string) {
    return this.metas.has(id) ? undefined : this.reserved.get(id);
  }
  private next(owner: string, accept: (conversationId: string) => boolean = () => true) {
    let best: { conversationId: string; agent: AgentId; item: QueuedMessage } | undefined;
    for (const state of this.states.values()) {
      const item = state.queued[0];
      if (
        state.owner === owner &&
        item &&
        !state.active &&
        accept(state.conversationId) &&
        !this.damagedStates.has(state.conversationId) &&
        (!best || item.queuedAt < best.item.queuedAt)
      )
        best = { conversationId: state.conversationId, agent: state.agent, item };
    }
    return best;
  }
  /**
   * The owner's oldest queued instruction in a conversation not running now, of
   * those `accept` allows. Each conversation's queue waits only for its own run.
   */
  async nextQueued(owner: string, accept?: (conversationId: string) => boolean) {
    await this.init();
    const next = this.next(owner, accept);
    return next && structuredClone(next);
  }
  /** Instructions waiting across the owner's conversations. */
  async pending(owner: string) {
    await this.init();
    let count = 0;
    for (const state of this.states.values())
      if (state.owner === owner) count += state.queued.length;
    return count;
  }

  /** The newest events of a conversation for a view, with its queue and run. */
  read(id: string): Promise<OpenConversation> {
    return this.queued(id, async () => {
      await this.init();
      this.usable(id);
      const meta = await this.meta(id);
      // The lines not yet written are the newest; the file is read behind them, from its end.
      const window = new ViewWindow();
      let full = false;
      let skipped = 0;
      let lastText: string | undefined;
      for (const line of [...(this.buffers.get(id) ?? [])].reverse()) {
        if (!full && window.take(line)) continue;
        full = true;
        if (line.type === 'text' && line.id === lastText) continue;
        skipped++;
        lastText = line.type === 'text' ? line.id : undefined;
      }
      const { earlier, damaged } = await this.readWindow(id, window, lastText);
      const state = this.states.get(id);
      return {
        meta,
        events: window.events.map((line) => viewEvent(line, meta)),
        earlier: earlier + skipped,
        damaged,
        queued: structuredClone(state?.queued ?? []),
        activeRunId: state?.active?.runId,
      };
    });
  }
  enqueue(id: string, placement: Placement, input: StartRun) {
    return this.queued(id, async () => {
      await this.init();
      this.usable(id);
      const message = queuedMessage.parse({ ...input, id: randomUUID(), queuedAt: this.now() });
      const queued = [...(this.states.get(id)?.queued ?? []), message];
      if (queued.length > 20)
        throw Error(t('送信待ちは 20 件までです。', 'The queue holds up to 20 instructions.'));
      // Refused before anything is written, so accepted instructions stay as they were.
      if (Buffer.byteLength(JSON.stringify(queued)) > queueLimit)
        throw Error(
          t(
            '送信待ちの保存容量を超えています。指示や参照資料を減らしてください。',
            'The queue is out of storage. Shorten the instructions or reference fewer materials.',
          ),
        );
      const meta = await this.ensure(id, placement, input);
      await this.writeState({ ...this.stateOf(meta), queued });
      if (meta.archived) await this.writeMeta({ ...meta, archived: false });
      return structuredClone(queued);
    });
  }
  removeQueued(id: string, queuedId: string) {
    return this.queued(id, async () => {
      await this.init();
      this.usable(id);
      const state = this.states.get(id);
      if (!state?.queued.some((item) => item.id === queuedId))
        throw Error(t('この指示は送信待ちにありません。', 'This instruction is not in the queue.'));
      await this.writeState({
        ...state,
        queued: state.queued.filter((item) => item.id !== queuedId),
      });
      return structuredClone(this.states.get(id)?.queued ?? []);
    });
  }
  /**
   * Claims a run for the conversation before the CLI starts: the queued instruction
   * leaves the queue and the run is recorded in one durable write, then the
   * person's message is added to the events.
   */
  begin(
    id: string,
    placement: Placement,
    run: { runId: string; eventId: string },
    input: StartRun,
    queuedId?: string,
  ) {
    return this.queued(id, async () => {
      await this.init();
      this.usable(id);
      const message = messageInput.parse(input);
      // One run per conversation; the owner's other conversations run beside it.
      if (this.states.get(id)?.active)
        throw Error(t('この会話は実行中です。', 'This conversation is already running.'));
      const queued = this.states.get(id)?.queued ?? [];
      if (queuedId) {
        if (queued[0]?.id !== queuedId)
          throw Error(t('送信待ちの順序が変わりました。', 'The queue order has changed.'));
      } else if (queued.length)
        throw Error(t('送信待ちがあります。', 'There are queued instructions.'));
      const meta = await this.ensure(id, placement, input);
      const state = this.stateOf(meta);
      const at = this.now();
      await this.writeState({
        ...state,
        queued: queuedId ? state.queued.slice(1) : state.queued,
        active: { runId: run.runId, eventId: run.eventId, at, input: message },
      });
      try {
        await this.append(id, [
          storedLine(
            { id: run.eventId, runId: run.runId, type: 'status', role: 'user', text: input.prompt },
            at,
          ),
        ]);
        return await this.writeMeta({
          ...meta,
          updatedAt: at,
          archived: false,
          ...(input.model && { model: input.model }),
        });
      } catch (error) {
        // The claim is undone, so the instruction stays in the queue it came from.
        await this.writeState(state).catch(() => {});
        throw error;
      }
    });
  }
  /** Buffers an event of a run in progress; it is written within 250 ms. */
  event(id: string, event: AgentEvent) {
    const line = storedLine(event);
    const buffer = this.buffers.get(id) ?? [];
    if (line.type !== 'text') buffer.push(line);
    else
      for (let index = 0; index < line.text.length || index === 0; index += lineText) {
        const text = line.text.slice(index, index + lineText);
        const last = buffer.at(-1);
        if (
          last?.type === 'text' &&
          last.id === line.id &&
          last.text.length + text.length <= lineText
        )
          last.text += text;
        else buffer.push({ ...line, text });
      }
    this.buffers.set(id, buffer);
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.flush().catch(this.onError);
      }, 250);
      this.timer.unref();
    }
  }
  private async drain(id: string) {
    const lines = this.buffers.get(id);
    if (!lines?.length) return;
    this.buffers.delete(id);
    try {
      await this.append(id, lines);
    } catch (error) {
      // Kept for the next attempt, ahead of what arrived meanwhile.
      this.buffers.set(id, [...lines, ...(this.buffers.get(id) ?? [])]);
      throw error;
    }
  }
  flush() {
    clearTimeout(this.timer);
    this.timer = undefined;
    return Promise.all(
      [...this.buffers.keys()].map((id) => this.queued(id, () => this.drain(id))),
    ).then(() => {});
  }
  /** Writes the run's last events and its end before the end is reported. */
  finish(id: string, event: AgentEvent, hibachis: string[] = []) {
    return this.queued(id, async () => {
      await this.drain(id);
      await this.append(id, [storedLine(event)]);
      const meta = await this.meta(id);
      await this.writeMeta({
        ...meta,
        updatedAt: this.now(),
        hibachis: [...new Set([...meta.hibachis, ...hibachis])],
      });
      const state = this.states.get(id);
      if (state?.active) await this.writeState({ ...state, active: undefined });
    });
  }
  private update(id: string, change: (meta: ConversationMeta) => ConversationMeta) {
    return this.queued(id, async () => {
      await this.init();
      return this.summary(await this.writeMeta(change(await this.meta(id))));
    });
  }
  async rename(id: string, title: string) {
    const name = conversationName.parse(title);
    return this.update(id, (meta) => ({ ...meta, title: name, titleSource: 'person' }));
  }
  pin(id: string, pinned: boolean) {
    return this.update(id, (meta) => ({ ...meta, pinned }));
  }
  archive(id: string, archived: boolean) {
    return this.update(id, (meta) => ({ ...meta, archived }));
  }
  /** Removes irori's folder for the conversation; the CLI's own transcript is not touched. */
  remove(id: string) {
    return this.queued(id, async () => {
      await this.init();
      const state = this.states.get(id);
      if (state?.active)
        throw Error(t('実行を停止してから削除してください。', 'Stop the run before deleting.'));
      if (state?.queued.length)
        throw Error(
          t(
            '送信待ちを取り消してから削除してください。',
            'Cancel the queued instructions before deleting.',
          ),
        );
      const dir = this.dir(id);
      const stat = await fs.lstat(dir).catch((error) => {
        if (missing(error)) return undefined;
        throw error;
      });
      // A link is removed as a link; what it points to is not irori's to delete.
      if (stat?.isDirectory()) await fs.rm(dir, { recursive: true, force: true });
      else if (stat) await fs.unlink(dir);
      await fs.rm(path.join(this.stateDir, `${id}.json`), { force: true });
      for (const map of [this.metas, this.damagedMetas, this.damagedStates, this.states])
        map.delete(id);
      this.buffers.delete(id);
      this.terminated.delete(id);
      this.counted.delete(id);
      this.reserved.delete(id);
    });
  }

  /** This device's native session for the conversation, and whether other devices have one. */
  async native(id: string) {
    const deviceId = await this.device.id();
    const meta = await this.meta(id);
    return {
      entry: meta.native[deviceId] as NativeSession | undefined,
      elsewhere: Object.keys(meta.native).some((key) => key !== deviceId),
    };
  }
  /** Records this device's native session; other devices' entries stay as they are. */
  saveNative(id: string, entry: NativeSession | undefined) {
    return this.queued(id, async () => {
      const deviceId = await this.device.id();
      const meta = await this.meta(id);
      const native = { ...meta.native };
      if (entry) native[deviceId] = entry;
      else delete native[deviceId];
      await this.writeMeta({ ...meta, native });
    });
  }
}
