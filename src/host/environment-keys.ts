import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto';
import { z } from 'zod';
import { t } from '../domain/i18n';
import { secretName, secretValue } from '../domain/routines';

/**
 * The routine secrets kept beside the saved environment (ADR 047): every value
 * sealed together with a key made from a passphrase the person chooses, so the
 * file in the settings repository never holds a value GitHub or anyone reading
 * the repository could use. The values are opened with the device's key and
 * sealed again in the host's memory only.
 */

/** scrypt's cost as OWASP recommends it: 128 MiB and about a second. */
const cost = { N: 2 ** 17, r: 8, p: 1 };
/** A file may ask for more, but never more than this much memory. */
const maxmem = 512 * 1024 * 1024;
/** GitHub's contents API gives no content for a file over 1 MB. */
const fileBudget = 900 * 1024;

const sealedKeys = z.object({
  schemaVersion: z.literal(1),
  savedAt: z.iso.datetime(),
  /** The names, readable without the passphrase; the sealed data repeats them. */
  names: z
    .array(secretName)
    .max(1000)
    .refine((names) => new Set(names).size === names.length),
  kdf: z.object({
    name: z.literal('scrypt'),
    N: z
      .number()
      .int()
      .min(2 ** 14)
      .max(2 ** 20)
      .refine((value) => (value & (value - 1)) === 0),
    r: z.number().int().min(1).max(32),
    p: z.number().int().min(1).max(4),
    salt: z.base64().length(24),
  }),
  cipher: z.literal('aes-256-gcm'),
  iv: z.base64().length(16),
  tag: z.base64().length(24),
  data: z.base64().max(fileBudget),
});
export type SealedKeys = z.infer<typeof sealedKeys>;
export { sealedKeys };

const opened = z.record(secretName, secretValue);

function derive(passphrase: string, salt: Buffer, params: { N: number; r: number; p: number }) {
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(passphrase.normalize('NFC'), salt, 32, { ...params, maxmem }, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}

/** The names bound to the sealed data, so a changed name list fails to open. */
const bound = (names: string[]) => Buffer.from(JSON.stringify(names), 'utf8');

/** Seals these values with a key made from the passphrase. */
export async function sealKeys(
  values: Record<string, string>,
  passphrase: string,
  savedAt: string,
): Promise<SealedKeys> {
  const names = Object.keys(values).sort();
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await derive(passphrase, salt, cost);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(bound(names));
  const plain = Buffer.from(
    JSON.stringify(Object.fromEntries(names.map((name) => [name, values[name]]))),
    'utf8',
  );
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  plain.fill(0);
  key.fill(0);
  const sealed: SealedKeys = {
    schemaVersion: 1,
    savedAt,
    names,
    kdf: { name: 'scrypt', ...cost, salt: salt.toString('base64') },
    cipher: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
  if (Buffer.byteLength(JSON.stringify(sealed, null, 2)) > fileBudget)
    throw Error(
      t(
        'シークレットが多すぎて、環境に保存できません。',
        'There are too many secrets to save with the environment.',
      ),
    );
  return sealed;
}

/** Opens sealed values with the passphrase; a wrong one or a changed file is refused. */
export async function openKeys(sealed: SealedKeys, passphrase: string) {
  const { salt, ...params } = sealed.kdf;
  const key = await derive(passphrase, Buffer.from(salt, 'base64'), params);
  let plain: Buffer;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'));
    decipher.setAAD(bound(sealed.names));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    plain = Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]);
  } catch {
    throw Error(
      t(
        '合言葉が違うため、シークレットを開けません。',
        'The passphrase does not open the saved secrets.',
      ),
    );
  } finally {
    key.fill(0);
  }
  let values: unknown;
  try {
    values = JSON.parse(plain.toString('utf8'));
  } catch {
    values = undefined;
  } finally {
    plain.fill(0);
  }
  const parsed = opened.safeParse(values);
  if (
    !parsed.success ||
    JSON.stringify(Object.keys(parsed.data).sort()) !== JSON.stringify(sealed.names)
  )
    throw Error(t('保存されたシークレットを読めません。', 'The saved secrets cannot be read.'));
  return parsed.data;
}
