import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { agentIds } from '../domain/types';
import { conversationMeta, messageInput, queuedMessage } from '../domain/conversation';
import { t } from '../domain/i18n';
import { writeLocalFile, writeLocalJson } from '../host/local-json';
import {
  conversationsFolder,
  deviceState,
  jsonLine,
  rootDigest,
  stateFolder,
  storedLine,
  type StoredEvent,
} from './conversations';
import { legacySession, sessionKey } from './sessions';

// The display history irori kept per space, CLI and checkout before ADR 017.
const legacyEvent = z.object({
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
const legacyConversation = z
  .object({
    schemaVersion: z.literal(1),
    scopeId: z.uuid(),
    agent: z.enum(agentIds),
    root: z.string().min(1),
    events: z.array(legacyEvent).max(400),
    queued: z
      .array(messageInput.extend({ id: z.uuid(), newSession: z.boolean().optional() }))
      .max(20),
    truncated: z.boolean(),
    activeRunId: z.uuid().optional(),
  })
  .strict();

/** The same old record always becomes the same conversation, so a second attempt adds nothing. */
export function migratedId(key: string) {
  const bytes = createHash('sha256').update(`irori-conversation-migration\0${key}`).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function jsonKeys(dir: string) {
  const names = await fs.readdir(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [] as string[];
    throw error;
  });
  return names.filter((name) => /^[0-9a-f]{64}\.json$/.test(name)).map((name) => name.slice(0, -5));
}
async function readRecord<T>(filename: string, schema: z.ZodType<T>) {
  const stat = await fs.lstat(filename).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (!stat) return undefined;
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw Error('Not a readable record');
  return { value: schema.parse(JSON.parse(await fs.readFile(filename, 'utf8'))) };
}

export interface Migration {
  migrated: number;
  /** Old records that could not be read; they stay where they are. */
  skipped: string[];
}

/**
 * ADR 017 D8: on the first start of this version, each conversation irori kept
 * per space, CLI and checkout becomes one conversation titled 以前の会話, with
 * its events, its queue and its native handle under this device. The old files
 * are left in place and nothing is sent to a model.
 */
export async function migrateConversations(
  dataDir: string,
  options: {
    deviceId: () => Promise<string>;
    /** The irori agent's id: its records become its conversations. */
    youId?: string;
    /** A registered hibachi's name, for the conversation's owner. */
    spaceName: (scopeId: string) => string | undefined;
  },
): Promise<Migration | undefined> {
  const marker = path.join(dataDir, 'conversations-migrated.json');
  if (
    await fs.lstat(marker).then(
      () => true,
      () => false,
    )
  )
    return undefined;
  const conversations = path.join(dataDir, 'agent-conversations');
  const sessions = path.join(dataDir, 'agent-sessions');
  const keys = [...new Set([...(await jsonKeys(conversations)), ...(await jsonKeys(sessions))])];
  const result: Migration = { migrated: 0, skipped: [] };
  if (keys.length) {
    const deviceId = await options.deviceId();
    for (const key of keys.sort())
      try {
        const record = await readRecord(
          path.join(conversations, `${key}.json`),
          legacyConversation,
        );
        // A handle that cannot be read is left behind; the conversation still moves.
        const session = await readRecord(path.join(sessions, `${key}.json`), legacySession).catch(
          () => undefined,
        );
        const binding = record?.value ?? session?.value;
        if (!binding) continue;
        if (sessionKey(binding) !== key) throw Error('The record does not match its file name');
        const handle = session && sessionKey(session.value) === key ? session.value : undefined;
        if (await migrate(dataDir, key, binding, record?.value, handle, deviceId, options))
          result.migrated++;
      } catch (error) {
        result.skipped.push(key);
        console.warn('A saved conversation could not be migrated', key, String(error));
      }
  }
  await writeLocalJson(marker, { schemaVersion: 1, at: new Date().toISOString(), ...result });
  return result;
}

async function migrate(
  dataDir: string,
  key: string,
  binding: { scopeId: string; agent: (typeof agentIds)[number]; root: string },
  record: z.infer<typeof legacyConversation> | undefined,
  session: z.infer<typeof legacySession> | undefined,
  deviceId: string,
  options: { youId?: string; spaceName: (scopeId: string) => string | undefined },
) {
  const id = migratedId(key);
  const dir = path.join(conversationsFolder(dataDir), id);
  // Its metadata is written last: a folder that has it was migrated by an earlier start.
  if (
    await fs.lstat(path.join(dir, 'meta.json')).then(
      () => true,
      () => false,
    )
  )
    return false;
  const source = path.join(
    dataDir,
    record ? 'agent-conversations' : 'agent-sessions',
    `${key}.json`,
  );
  const at = (await fs.stat(source)).mtime.toISOString();
  const lines: StoredEvent[] = [];
  if (record?.truncated)
    lines.push(
      storedLine(
        {
          runId: 'migration',
          type: 'status',
          text: t('これより前の出来事は保存されていません。', 'Earlier events were not kept.'),
        },
        at,
      ),
    );
  for (const event of record?.events ?? []) lines.push(storedLine(event, at));
  if (record?.activeRunId)
    lines.push(
      storedLine(
        {
          runId: record.activeRunId,
          type: 'error',
          text: t(
            '前回の実行結果は未確認です。この指示は再送していません。',
            'The previous run did not report its result. This instruction was not sent again.',
          ),
        },
        at,
      ),
    );
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const queued = (record?.queued ?? []).map((item, index) =>
    queuedMessage.parse({
      ...item,
      queuedAt: new Date(Date.parse(at) + index).toISOString(),
    }),
  );
  const state = path.join(stateFolder(dataDir), `${id}.json`);
  if (queued.length)
    await writeLocalJson(
      state,
      deviceState.parse({
        schemaVersion: 1,
        conversationId: id,
        owner: binding.scopeId,
        agent: binding.agent,
        queued,
      }),
    );
  await writeLocalFile(path.join(dir, 'events.jsonl'), lines.map(jsonLine).join(''));
  const you = binding.scopeId === options.youId;
  await writeLocalJson(
    path.join(dir, 'meta.json'),
    conversationMeta.parse({
      schemaVersion: 1,
      id,
      owner: {
        kind: you ? 'irori-agent' : 'hibachi',
        id: binding.scopeId,
        name: you
          ? 'irori agent'
          : (options.spaceName(binding.scopeId) ?? path.basename(binding.root)).slice(0, 200),
      },
      agent: binding.agent,
      model: null,
      title: t('以前の会話', 'Earlier conversation'),
      titleSource: 'migration',
      createdAt: at,
      updatedAt: at,
      linkedNote: null,
      hibachis: [],
      pinned: false,
      archived: false,
      forkedFrom: null,
      native: session
        ? {
            [deviceId]: {
              handle: session.handle,
              access: session.access,
              root: rootDigest(session.root),
            },
          }
        : {},
    }),
  );
  return true;
}
