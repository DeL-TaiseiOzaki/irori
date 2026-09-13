import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { writeLocalJson } from '../host/local-json';
import { z } from 'zod';
import type { AgentId, AgentSession } from '../domain/types';
import { agentIds } from '../domain/types';

export type SessionBinding = { scopeId: string; agent: AgentId; root: string };
export function sessionKey(binding: SessionBinding) {
  return createHash('sha256')
    .update(JSON.stringify([binding.scopeId, binding.agent, binding.root]))
    .digest('hex');
}
const record = z
  .object({
    schemaVersion: z.literal(1),
    scopeId: z.uuid(),
    agent: z.enum(agentIds),
    root: z.string().min(1),
    handle: z.string().min(1).max(4096),
    updatedAt: z.iso.datetime(),
  })
  .strict();

// Provider handles belong to this device and exact checkout, never to portable KB metadata.
export class SessionStore {
  constructor(private dataDir: string) {}
  private filename(binding: SessionBinding) {
    const key = sessionKey(binding);
    return path.join(this.dataDir, 'agent-sessions', key + '.json');
  }
  async read(binding: SessionBinding) {
    try {
      const filename = this.filename(binding);
      if ((await fs.stat(filename)).size > 32768) throw Error('Session record is too large');
      const value = record.parse(JSON.parse(await fs.readFile(filename, 'utf8')));
      if (
        value.scopeId !== binding.scopeId ||
        value.agent !== binding.agent ||
        value.root !== binding.root
      )
        throw Error('Session binding mismatch');
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw Error(
        '保存済みの会話を読み込めません。再試行するか、会話の継続をリセットしてください。',
        { cause: error },
      );
    }
  }
  async status(binding: SessionBinding): Promise<AgentSession> {
    try {
      const saved = await this.read(binding);
      return saved ? { state: 'saved', updatedAt: saved.updatedAt } : { state: 'empty' };
    } catch (error) {
      return { state: 'unavailable', detail: (error as Error).message };
    }
  }
  async save(binding: SessionBinding, handle: string) {
    const value = record.parse({
      ...binding,
      schemaVersion: 1,
      handle,
      updatedAt: new Date().toISOString(),
    });
    await writeLocalJson(this.filename(binding), value);
  }
  async reset(binding: SessionBinding) {
    await fs.rm(this.filename(binding), { force: true });
  }
}
