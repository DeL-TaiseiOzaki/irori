import { z } from 'zod';
import type { AgentId } from './types';

export const draftKey = z.discriminatedUnion('kind', [
  z
    .object({
      scopeId: z.uuid(),
      kind: z.literal('composer'),
      agent: z.enum(['codex', 'claude', 'opencode', 'pi']),
    })
    .strict(),
  z.object({ scopeId: z.uuid(), kind: z.literal('git-commit') }).strict(),
  z
    .object({
      scopeId: z.uuid(),
      kind: z.literal('git-resolution'),
      path: z
        .string()
        .min(1)
        .max(4096)
        .refine(
          (value) =>
            !value.includes('\\') &&
            !value.includes('\0') &&
            !/^[a-z]:/i.test(value) &&
            value.split('/').every((part) => part && part !== '.' && part !== '..'),
        ),
    })
    .strict(),
]);
export type DraftKey =
  | { scopeId: string; kind: 'composer'; agent: AgentId }
  | { scopeId: string; kind: 'git-commit' }
  | { scopeId: string; kind: 'git-resolution'; path: string };
export const draftValue = z
  .object({
    text: z
      .string()
      .max(2 * 1024 * 1024)
      .nullable(),
    baseVersion: z.string().min(1).max(256).optional(),
  })
  .strict();
export type DraftValue = z.infer<typeof draftValue>;
export const draftRevision = z.uuid().nullable();
export interface DraftRecord extends DraftValue {
  revision: string;
  updatedAt: string;
}
export interface DraftBackend {
  draftRead(key: DraftKey): Promise<DraftRecord | null>;
  draftWrite(
    key: DraftKey,
    value: DraftValue,
    expectedRevision: string | null,
  ): Promise<DraftRecord>;
}
export interface DraftState {
  text: string;
  record: DraftRecord | null;
  ready: boolean;
  pending: boolean;
  error: string;
}

/** One immutable target per controller: delayed reads/writes cannot migrate to another draft. */
export class DraftController {
  private state: DraftState = { text: '', record: null, ready: false, pending: true, error: '' };
  private listeners = new Set<() => void>();
  private desired: DraftValue = { text: '' };
  private edits = 0;
  private persisted = 0;
  private reading?: Promise<void>;
  private writing?: Promise<void>;
  constructor(
    readonly key: DraftKey,
    private backend: DraftBackend,
  ) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(values: Partial<DraftState>) {
    this.state = { ...this.state, ...values };
    for (const listener of this.listeners) listener();
  }
  load = async () => {
    if (this.state.ready) return;
    if (this.reading) return this.reading;
    this.reading = (async () => {
      try {
        const record = await this.backend.draftRead(this.key);
        if (this.edits === this.persisted)
          this.desired = record
            ? { text: record.text, baseVersion: record.baseVersion }
            : { text: '' };
        this.update({
          record,
          text: this.desired.text ?? '',
          ready: true,
          pending: this.edits > this.persisted,
          error: '',
        });
      } catch (error) {
        this.update({ pending: false, error: `下書きを読み込めませんでした: ${String(error)}` });
      }
    })().finally(() => {
      this.reading = undefined;
    });
    return this.reading;
  };
  setText = (text: string, baseVersion?: string) => {
    this.desired = { text, ...(baseVersion ? { baseVersion } : {}) };
    this.edits++;
    this.update({ text, pending: !this.state.error });
    void this.flush();
  };
  flush = async (): Promise<boolean> => {
    await this.load();
    if (!this.state.ready || this.state.error) return false;
    if (!this.writing) {
      this.writing = (async () => {
        while (this.persisted < this.edits && !this.state.error) {
          const edit = this.edits;
          const value = this.desired;
          try {
            const record = await this.backend.draftWrite(
              this.key,
              value,
              this.state.record?.revision ?? null,
            );
            this.persisted = edit;
            this.update({ record, pending: this.persisted < this.edits });
          } catch (error) {
            this.update({
              pending: false,
              error: `下書きを保存できませんでした: ${String(error)}`,
            });
          }
        }
      })().finally(() => {
        this.writing = undefined;
      });
    }
    await this.writing;
    return !this.state.error && this.persisted === this.edits;
  };
  /** Acknowledgement of an older send/resolve must never erase later typing. */
  clear = async (expectedRevision = this.state.record?.revision): Promise<boolean> => {
    if (!this.state.ready || this.state.error) return false;
    if (this.state.record?.revision !== expectedRevision || this.edits !== this.persisted)
      return true;
    this.desired = { text: null };
    this.edits++;
    this.update({ text: '', pending: true });
    return this.flush();
  };
  /** Explicit retry may recover a failed disk write or rebase a local draft after a CAS refusal. */
  retry = async (): Promise<boolean> => {
    if (this.writing) await this.writing;
    this.update({ ready: false, pending: true, error: '' });
    await this.load();
    return this.flush();
  };
}
