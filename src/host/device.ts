import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { t } from '../domain/i18n';
import { readLocalJson, writeLocalJson } from './local-json';

const record = z.object({ schemaVersion: z.literal(1), id: z.uuid() }).strict();

/**
 * This device's id (ADR 017 D2): a random UUID made once in irori's data
 * directory. A conversation's native sessions are kept under it, since each CLI
 * keeps its transcripts on the machine that ran it. A damaged record is never
 * replaced: runs are refused with the reason until the person removes it.
 */
export class DeviceIdentity {
  private value?: Promise<string>;
  constructor(private dataDir: string) {}
  private get filename() {
    return path.join(this.dataDir, 'device.json');
  }
  id() {
    this.value ??= this.load().catch((error) => {
      this.value = undefined;
      throw Error(
        t(
          'この端末の識別子（device.json）を読み込めません。',
          "Could not read this device's id (device.json).",
        ),
        { cause: error },
      );
    });
    return this.value;
  }
  private async load() {
    const stored = await readLocalJson(this.filename, undefined);
    if (stored !== undefined) return record.parse(stored).id;
    const value = { schemaVersion: 1 as const, id: randomUUID() };
    await writeLocalJson(this.filename, value);
    return value.id;
  }
}
