import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { SecureStorage } from '../src/cloud/credentials';

// Disposable tests use their own process-local key instead of accessing a real OS keychain.
const key = randomBytes(32);
export const fixtureSecureStorage: SecureStorage = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'fixture_keychain',
  encryptString(value) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
  },
  decryptString(value) {
    const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
    decipher.setAuthTag(value.subarray(12, 28));
    return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8');
  },
};
