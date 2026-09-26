import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { agentIds, type AgentEvent, type StartRun } from '../domain/types';
import {
  appendConversationEvent,
  queuedMessage,
  messageInput,
  type Conversation,
} from '../domain/conversation';
import { readLocalJson, writeLocalJson } from '../host/local-json';
import { SerialQueue } from '../host/serial-queue';
import { sessionKey, type SessionBinding } from './sessions';
import { t } from '../domain/i18n';

// Persist display text, never live approval identifiers or replayable questions.
const storedEvent = z.object({
  runId: z.string(),
  role: z.literal('user').optional(),
  type: z.enum(['status', 'text', 'tool', 'error', 'done']),
  text: z.string(),
  details: z.string().optional(),
  outcome: z.enum(['completed', 'failed', 'cancelled']).optional(),
  delegate: z
    .object({
      scopeId: z.string(),
      task: z.string(),
      state: z.enum(['started', 'working', 'reported', 'failed']),
    })
    .optional(),
});
const recordSchema = z
  .object({
    schemaVersion: z.literal(1),
    scopeId: z.uuid(),
    agent: z.enum(agentIds),
    root: z.string().min(1),
    events: z.array(storedEvent).max(400),
    queued: z.array(queuedMessage).max(20),
    truncated: z.boolean(),
    activeRunId: z.uuid().optional(),
  })
  .strict();
type Record = z.infer<typeof recordSchema>;
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

/** Device-local display history and accepted pending instructions for one exact checkout. */
export class ConversationStore {
  private queue = new SerialQueue();
  private records = new Map<string, Record>();
  private dirty = new Set<string>();
  private timer?: NodeJS.Timeout;
  constructor(
    private dataDir: string,
    private onError: (error: unknown) => void = () => {},
  ) {}
  private filename(key: string) {
    return path.join(this.dataDir, 'agent-conversations', `${key}.json`);
  }
  private async load(binding: SessionBinding) {
    const key = sessionKey(binding);
    const cached = this.records.get(key);
    if (cached) return cached;
    const value = recordSchema.parse(
      await readLocalJson(this.filename(key), {
        ...binding,
        schemaVersion: 1,
        events: [],
        queued: [],
        truncated: false,
      }),
    );
    if (
      value.scopeId !== binding.scopeId ||
      value.agent !== binding.agent ||
      value.root !== binding.root
    )
      throw Error(
        t(
          '保存した会話のスペース・CLI・フォルダが一致しません。',
          'The saved conversation does not match this space, CLI or folder.',
        ),
      );
    // A new host cannot establish whether the old native turn completed. Never requeue it.
    if (value.activeRunId) {
      this.append(value, {
        runId: value.activeRunId,
        type: 'error',
        text: t(
          '前回の実行結果は未確認です。変更内容を確認してください。この指示は再送していません。',
          'The previous run did not report its result. Review the changes. This instruction was not sent again.',
        ),
      });
      delete value.activeRunId;
      await this.persist(binding, value);
    } else this.records.set(key, value);
    return value;
  }
  private async persist(binding: SessionBinding, value: Record) {
    const key = sessionKey(binding);
    // Keep accepted messages intact. Refuse a new oversized queue before acknowledging it.
    if (bytes(value.queued) > 1024 * 1024)
      throw Error(
        t(
          '送信待ちの保存容量を超えています。指示や参照資料を減らしてください。',
          'The queue is out of storage. Shorten the instructions or reference fewer materials.',
        ),
      );
    await writeLocalJson(this.filename(key), recordSchema.parse(value));
    this.records.set(key, value);
    this.dirty.delete(key);
  }
  private append(value: Record, incoming: AgentEvent) {
    const event = storedEvent.parse({
      runId: incoming.runId,
      role: incoming.role,
      type:
        incoming.type === 'permission' || incoming.type === 'question' ? 'status' : incoming.type,
      text: incoming.text,
      details: incoming.details?.slice(0, 24000),
      outcome: incoming.outcome,
      delegate: incoming.delegate,
    });
    value.events = appendConversationEvent(value.events, event) as Record['events'];
    const last = value.events.at(-1)!;
    if (last.text.length > 100000 || bytes(last) > 512 * 1024) {
      last.text = last.text.slice(-40000);
      value.truncated = true;
    }
    while (value.events.length > 400 || bytes(value.events) > 512 * 1024) {
      value.events.shift();
      value.truncated = true;
    }
  }
  read(binding: SessionBinding): Promise<Conversation> {
    return this.queue.run(async () => {
      const { events, queued, truncated, activeRunId } = await this.load(binding);
      return structuredClone({ events, queued, truncated, activeRunId });
    });
  }
  enqueue(binding: SessionBinding, input: StartRun) {
    return this.queue.run(async () => {
      const value = structuredClone(await this.load(binding));
      if (value.queued.length >= 20)
        throw Error(t('送信待ちは 20 件までです。', 'The queue holds up to 20 instructions.'));
      value.queued.push(queuedMessage.parse({ ...input, id: randomUUID() }));
      await this.persist(binding, value);
      return structuredClone(value.queued);
    });
  }
  remove(binding: SessionBinding, id: string) {
    return this.queue.run(async () => {
      const value = structuredClone(await this.load(binding));
      if (!value.queued.some((item) => item.id === id))
        throw Error(t('この指示は送信待ちにありません。', 'This instruction is not in the queue.'));
      value.queued = value.queued.filter((item) => item.id !== id);
      await this.persist(binding, value);
      return structuredClone(value.queued);
    });
  }
  begin(binding: SessionBinding, runId: string, input: StartRun, queuedId?: string) {
    return this.queue.run(async () => {
      const value = structuredClone(await this.load(binding));
      if (queuedId) {
        if (value.queued[0]?.id !== queuedId)
          throw Error(t('送信待ちの順序が変わりました。', 'The queue order has changed.'));
        value.queued.shift();
      } else if (value.queued.length)
        throw Error(
          t(
            '送信待ちを再開または取り消してください。',
            'Resume or cancel the queued instructions.',
          ),
        );
      messageInput.parse(input);
      value.activeRunId = runId;
      if (input.newSession)
        this.append(value, {
          runId,
          type: 'status',
          text: t('新しい会話を開始します。', 'Starting a new conversation.'),
        });
      this.append(value, { runId, type: 'status', role: 'user', text: input.prompt });
      // Claim the queued instruction and record its run in one durable write, before CLI launch.
      await this.persist(binding, value);
    });
  }
  event(binding: SessionBinding, event: AgentEvent) {
    return this.queue.run(async () => {
      const value = await this.load(binding);
      this.append(value, event);
      this.dirty.add(sessionKey(binding));
      if (!this.timer) {
        this.timer = setTimeout(() => {
          this.timer = undefined;
          void this.flush().catch(this.onError);
        }, 250);
        this.timer.unref();
      }
    });
  }
  finish(binding: SessionBinding, event: AgentEvent) {
    return this.queue.run(async () => {
      const value = structuredClone(await this.load(binding));
      this.append(value, event);
      delete value.activeRunId;
      await this.persist(binding, value);
    });
  }
  flush() {
    return this.queue.run(async () => {
      clearTimeout(this.timer);
      this.timer = undefined;
      for (const key of [...this.dirty]) {
        const value = this.records.get(key)!;
        await this.persist(value, value);
      }
    });
  }
}
