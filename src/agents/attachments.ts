import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import writeFileAtomic from 'write-file-atomic';
import {
  attachmentByteLimit,
  attachmentImageType,
  attachmentName,
  type AttachmentRef,
} from '../domain/attachments';
import { t } from '../domain/i18n';

/** How long a file attached and never sent is kept. */
const unsentLifetime = 24 * 60 * 60 * 1000;
/** What irori remembers of a kept file: the conversation that sent it. */
interface Sent {
  conversationId: string;
}
const missing = () =>
  t(
    '添付ファイルがこの端末に見つかりません。もう一度添付してください。',
    'An attached file is not on this device. Attach it again.',
  );

/**
 * Files the person attaches to instructions, one folder each in irori's data
 * directory: `<id>/<name>` and, once an instruction carried it, `sent.json`
 * naming its conversation. They never enter the conversations folder, which
 * may be synced; deleting the conversation deletes them.
 */
export class AttachmentStore {
  readonly root: string;
  constructor(dataDir: string) {
    this.root = path.join(dataDir, 'attachments');
  }
  private dir(id: string) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw Error(missing());
    return path.join(this.root, id);
  }
  async stage(name: string, bytes: Uint8Array): Promise<AttachmentRef> {
    if (bytes.length > attachmentByteLimit)
      throw Error(
        t('添付できるファイルは 1 つ 25 MB までです。', 'Each attached file can be up to 25 MB.'),
      );
    const id = randomUUID();
    const safe = attachmentName(name);
    await fs.mkdir(this.dir(id), { recursive: true });
    await writeFileAtomic(path.join(this.dir(id), safe), Buffer.from(bytes));
    return { id, name: safe, size: bytes.length };
  }
  /** The file's absolute path, after checking it is the one referenced. */
  async path(ref: Pick<AttachmentRef, 'id' | 'name'>) {
    const file = path.join(this.dir(ref.id), attachmentName(ref.name));
    const info = await fs.stat(file).catch(() => undefined);
    if (!info?.isFile()) throw Error(missing());
    return file;
  }
  /** The folder holding a file, which an agent is allowed to read. */
  folder(id: string) {
    return this.dir(id);
  }
  private async file(id: string) {
    const names = await fs.readdir(this.dir(id)).catch(() => []);
    const name = names.find((entry) => entry !== 'sent.json');
    return name ? path.join(this.dir(id), name) : undefined;
  }
  private async sent(id: string): Promise<Sent | undefined> {
    try {
      return JSON.parse(await fs.readFile(path.join(this.dir(id), 'sent.json'), 'utf8'));
    } catch {
      return undefined;
    }
  }
  /** Ties sent files to their conversation, so they stay as long as it does. */
  async claim(refs: AttachmentRef[] | undefined, conversationId: string) {
    for (const ref of refs ?? []) {
      await this.path(ref);
      if (await this.sent(ref.id)) continue;
      await writeFileAtomic(
        path.join(this.dir(ref.id), 'sent.json'),
        JSON.stringify({ conversationId } satisfies Sent),
      );
    }
  }
  /** Forgets a file the person removed before sending; a sent one is kept. */
  async discard(id: string) {
    if (await this.sent(id)) return;
    await fs.rm(this.dir(id), { recursive: true, force: true });
  }
  /** The bytes of an attached image, or null when it is not one or not here. */
  async image(id: string) {
    const file = await this.file(id);
    if (!file || !attachmentImageType(file)) return null;
    const info = await fs.stat(file);
    if (info.size > attachmentByteLimit) return null;
    return new Uint8Array(await fs.readFile(file));
  }
  /** The file to open for the person. */
  async opened(id: string) {
    const file = await this.file(id);
    if (!file) throw Error(missing());
    return file;
  }
  /** Removes the files a conversation sent, when it is deleted. */
  async removeConversation(conversationId: string) {
    for (const id of await fs.readdir(this.root).catch(() => [] as string[]))
      if ((await this.sent(id).catch(() => undefined))?.conversationId === conversationId)
        await fs.rm(path.join(this.root, id), { recursive: true, force: true });
  }
  /** Removes files attached and never sent, after a day. */
  async prune(now = Date.now()) {
    for (const id of await fs.readdir(this.root).catch(() => [] as string[])) {
      const dir = path.join(this.root, id);
      const info = await fs.stat(dir).catch(() => undefined);
      if (!info?.isDirectory() || now - info.mtimeMs < unsentLifetime) continue;
      if (await this.sent(id)) continue;
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
}
