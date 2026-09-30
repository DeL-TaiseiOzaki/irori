import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export { seedDataConsent } from '../tests/data-consent-fixture';

/** Only cloud protocol suites replace keychain access inside their disposable Electron launcher. */
export async function createCloudFixtureLauncher(base: string) {
  const keyFile = path.join(base, 'secure-storage-fixture-key.bin');
  await writeFile(keyFile, randomBytes(32), { mode: 0o600 });
  const launcher = path.join(base, 'cloud-fixture.cjs');
  await writeFile(
    launcher,
    `// Synthetic OS storage for disposable cloud protocol fixtures, never shipped.
const { safeStorage } = require('electron');
const { createCipheriv, createDecipheriv, randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const key = readFileSync(${JSON.stringify(keyFile)});
safeStorage.isEncryptionAvailable = () => true;
safeStorage.getSelectedStorageBackend = () => 'fixture_keychain';
safeStorage.encryptString = value => {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
};
safeStorage.decryptString = value => {
  const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
  decipher.setAuthTag(value.subarray(12, 28));
  return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8');
};
require(${JSON.stringify(path.resolve('dist-host/main.cjs'))});
`,
    { mode: 0o600 },
  );
  return launcher;
}
