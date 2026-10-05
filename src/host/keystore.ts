import { z } from 'zod';
import { t } from '../domain/i18n';
import { secretName, secretValue, type SecretList } from '../domain/routines';
import { readLocalJson, writeLocalJson } from './local-json';

/** Electron's `safeStorage`, given by the host once the app is ready. */
export interface SecureStorage {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend?(): string;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

/**
 * Whether the OS protects the key. On Linux without a secret service, Electron
 * falls back to `basic_text`, a key every copy of Chromium knows; its
 * asynchronous API even reports that as available, so only the synchronous
 * check is trusted (docs/research/spike-external-tool-credentials.md).
 */
export function secureStorageAvailable(storage?: SecureStorage, platform = process.platform) {
  try {
    return !!(
      storage?.isEncryptionAvailable() &&
      (platform !== 'linux' ||
        !['basic_text', 'unknown'].includes(storage.getSelectedStorageBackend?.() ?? 'unknown'))
    );
  } catch {
    return false;
  }
}

/**
 * A stand-in that protects nothing, for UI smokes on displays without a
 * keychain. The host uses it only in a source run that asks for it.
 */
export const reversibleStorage: SecureStorage = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'reversible-test',
  encryptString: (value) => Buffer.from(`test:${value}`, 'utf8'),
  decryptString: (value) => {
    const text = value.toString('utf8');
    if (!text.startsWith('test:')) throw Error('Not a test value');
    return text.slice(5);
  },
};

export const unavailableText = () =>
  t(
    'この端末ではシークレットを保存できません。OS のキーチェーンが必要です。',
    'This device cannot store secrets. It needs the OS keychain.',
  );

const record = z.object({
  schemaVersion: z.literal(1),
  values: z.record(secretName, z.base64().max(64 * 1024)),
});

/**
 * The secrets of this device (ADR 016 D5): a name and its value encrypted with
 * the OS-held key, in one file of irori's data directory. Nothing here returns
 * a value to the renderer; `values` is for the routine host only.
 */
export class SecretStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private file: string,
    private storage?: SecureStorage,
    private platform = process.platform,
  ) {}
  get available() {
    return secureStorageAvailable(this.storage, this.platform);
  }
  private async read() {
    const value = record.safeParse(
      await readLocalJson(this.file, { schemaVersion: 1, values: {} }).catch(() => undefined),
    );
    if (!value.success)
      throw Error(t('シークレットの記録を読めません。', 'The secrets record cannot be read.'));
    return value.data.values;
  }
  /** One change at a time, so two routines writing back never lose one another's. */
  private change(apply: (values: Record<string, string>) => void) {
    const next = this.queue.then(async () => {
      const values = await this.read();
      apply(values);
      await writeLocalJson(this.file, { schemaVersion: 1, values });
    });
    this.queue = next.catch(() => {});
    return next;
  }
  private seal(name: string, value: string) {
    if (!this.available) throw Error(unavailableText());
    if (!secretName.safeParse(name).success)
      throw Error(t(`${name} はシークレットの名前に使えません。`, `${name} cannot name a secret.`));
    if (!secretValue.safeParse(value).success)
      throw Error(
        t('値は 8〜8192 文字の 1 行です。', 'A value is one line of 8 to 8192 characters.'),
      );
    return this.storage!.encryptString(value).toString('base64');
  }
  async list(): Promise<SecretList> {
    return { available: this.available, names: Object.keys(await this.read()).sort() };
  }
  async set(name: string, value: string) {
    const sealed = this.seal(name, value);
    await this.change((values) => {
      values[name] = sealed;
    });
  }
  /** Several values at once, as a step writes them back. */
  async update(entries: Record<string, string>) {
    const sealed = Object.entries(entries).map(([name, value]) => [name, this.seal(name, value)]);
    await this.change((values) => {
      for (const [name, value] of sealed) values[name] = value;
    });
  }
  async delete(name: string) {
    await this.change((values) => {
      delete values[name];
    });
  }
  /** The values a step receives; throws when one is missing or cannot be decrypted. */
  async values(names: string[]) {
    if (!this.available) throw Error(unavailableText());
    await this.queue;
    const stored = await this.read();
    const found: Record<string, string> = {};
    for (const name of names) {
      if (!stored[name])
        throw Error(t(`シークレット ${name} がありません。`, `The secret ${name} is missing.`));
      try {
        found[name] = this.storage!.decryptString(Buffer.from(stored[name], 'base64'));
      } catch {
        throw Error(
          t(
            `シークレット ${name} を読めません。入力し直してください。`,
            `The secret ${name} cannot be read. Enter it again.`,
          ),
        );
      }
    }
    return found;
  }
}

const hidden = '***';

/**
 * Hides every value a run handed out or got back from what it records. Output
 * arrives in pieces, so a stream keeps back the end of what it was given while
 * that end could still be the start of a value.
 */
export class Redactor {
  private values: string[] = [];
  add(value: string) {
    if (!value || this.values.includes(value)) return;
    this.values.push(value);
    // A longer value that contains a shorter one is hidden whole.
    this.values.sort((a, b) => b.length - a.length);
  }
  hide(text: string) {
    for (const value of this.values) text = text.split(value).join(hidden);
    return text;
  }
  /** How many characters at the end of `text` could begin a value. */
  private held(text: string) {
    let held = 0;
    for (const value of this.values) {
      const first = value[0];
      // Only positions where the value's first character stands can begin it.
      for (let at = Math.max(0, text.length - value.length + 1); at < text.length; at++) {
        if (text[at] !== first) continue;
        if (value.startsWith(text.slice(at))) {
          held = Math.max(held, text.length - at);
          break;
        }
      }
    }
    return held;
  }
  stream() {
    let pending = '';
    return {
      /** The part of `pending + text` that is safe to show now. */
      write: (text: string) => {
        const all = this.hide(pending + text);
        const keep = this.held(all);
        pending = all.slice(all.length - keep);
        return all.slice(0, all.length - keep);
      },
      end: (text = '') => {
        const all = this.hide(pending + text);
        pending = '';
        return all;
      },
    };
  }
}

/**
 * What a `run` step wrote to `IRORI_SECRETS_OUT`: `NAME=value` lines for names
 * it declared, the last line of a name winning. A step that did not end
 * successfully may have been cut off mid-line, so then only finished lines count.
 * Refused lines are named by number, never by their text.
 */
export function readWriteBack(text: string, declared: string[], complete: boolean) {
  const values: Record<string, string> = {};
  const refused: string[] = [];
  const lines = text.split('\n');
  const last = lines.pop()!;
  if (complete && last) lines.push(last);
  lines.forEach((raw, index) => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (!line) return;
    const equals = line.indexOf('=');
    const name = equals > 0 ? line.slice(0, equals) : '';
    const value = line.slice(equals + 1);
    if (!declared.includes(name)) {
      refused.push(
        secretName.safeParse(name).success
          ? t(
              `${index + 1} 行目（${name} は宣言されていません）`,
              `line ${index + 1} (${name} is not declared)`,
            )
          : t(`${index + 1} 行目`, `line ${index + 1}`),
      );
      return;
    }
    if (!secretValue.safeParse(value).success) {
      refused.push(t(`${index + 1} 行目（${name} の値）`, `line ${index + 1} (${name}'s value)`));
      return;
    }
    values[name] = value;
  });
  return { values, refused };
}
