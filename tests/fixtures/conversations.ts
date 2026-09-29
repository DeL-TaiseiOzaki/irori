import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ConversationMeta } from '../../src/domain/conversation';

/** Every conversation's metadata in a data directory, as the files hold it. */
export async function conversationMetas(dataDir: string) {
  const folder = path.join(dataDir, 'conversations');
  const names = await readdir(folder).catch(() => [] as string[]);
  const metas: ConversationMeta[] = [];
  for (const name of names)
    try {
      metas.push(JSON.parse(await readFile(path.join(folder, name, 'meta.json'), 'utf8')));
    } catch {
      // A folder without readable metadata is not a conversation to inspect here.
    }
  return metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function deviceId(dataDir: string) {
  return (JSON.parse(await readFile(path.join(dataDir, 'device.json'), 'utf8')) as { id: string })
    .id;
}
/** The owner's latest conversation with a CLI, and this device's native session in it. */
export async function latestConversation(dataDir: string, scopeId: string, agent: string) {
  const meta = (await conversationMetas(dataDir)).find(
    (item) => item.owner.id === scopeId && item.agent === agent,
  );
  const native = meta ? meta.native[await deviceId(dataDir).catch(() => '')] : undefined;
  return { meta, native };
}
