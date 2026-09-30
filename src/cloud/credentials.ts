import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { launch, killTree, agentEnv } from '../agents/process';
import { writeLocalFile } from '../host/local-json';
import { t } from '../domain/i18n';

/** Electron safeStorage is injected by the host after app readiness. */
export interface SecureStorage {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend?(): string;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export function credentialStorageError() {
  return Error(
    t(
      '安全な認証情報の保存先を利用できません。OSのキーチェーンを有効にしてからGoogle連携を再試行してください。ローカルのノートは引き続き利用できます。',
      'Secure credential storage is unavailable. Enable your OS keychain and retry Google connection. Local notes remain available.',
    ),
  );
}

const storageError = credentialStorageError;

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

/** Only rclone receives its credentials; never modify the application environment. */
export function rcloneEnv() {
  const env = agentEnv();
  for (const key of Object.keys(env)) {
    const upper = key.toUpperCase();
    if (upper.startsWith('RCLONE_') || upper.startsWith('_RCLONE_')) delete env[key];
  }
  return env;
}

async function configCommand(
  executable: string,
  config: string,
  command: 'set' | 'check',
  password: string,
) {
  const env = rcloneEnv();
  if (command === 'check') env.RCLONE_CONFIG_PASS = password;
  const child = launch(
    executable,
    ['config', 'encryption', command, '--config', config, '--ask-password=false'],
    path.dirname(config),
    env,
  );
  // Native errors and prompts may contain config values. Do not forward or retain them.
  child.stdout?.resume();
  child.stderr?.resume();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      void killTree(child);
      reject(storageError());
    }, 10000);
    child.once('error', () => {
      clearTimeout(timer);
      reject(storageError());
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(storageError());
    });
    child.stdin?.on('error', () => {});
    child.stdin?.end(command === 'set' ? `${password}\n${password}\n` : undefined);
  });
}

function encrypted(config: Buffer) {
  const first = config
    .toString('utf8')
    .split(/\r?\n/)
    .find((line) => line.trim() && !/^[\s]*[;#]/.test(line));
  return first?.trim().startsWith('RCLONE_ENCRYPT_V') ?? false;
}

async function readOptional(filename: string) {
  try {
    if (!(await fs.lstat(filename)).isFile()) throw storageError();
    return await fs.readFile(filename);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function removeInterruptedMigrations(directory: string) {
  const entries = await fs.readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const name of entries) {
    // Node mkdtemp appends exactly six random characters to this private prefix.
    if (!/^\.encrypt-[A-Za-z0-9]{6}$/.test(name)) continue;
    const candidate = path.join(directory, name);
    const entry = await fs.lstat(candidate).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    // Never follow links or remove regular files that happen to have a reserved name.
    if (entry?.isDirectory() && !entry.isSymbolicLink())
      await fs.rm(candidate, { recursive: true, force: true });
  }
}

/** Migrate plaintext config without overwriting it until encryption has been verified. */
export async function protectRcloneConfig(
  directory: string,
  executable: string,
  storage?: SecureStorage,
) {
  try {
    // basic_text uses a public hardcoded password and must never protect credentials.
    if (!secureStorageAvailable(storage) || !storage) throw storageError();
    // The host owns a single instance; these can only be leftovers from interrupted migration.
    await removeInterruptedMigrations(directory);
    const config = path.join(directory, 'rclone.conf');
    const keyFile = path.join(directory, 'config-key.bin');
    const original = await readOptional(config);
    const sealed = await readOptional(keyFile);
    if (!sealed && original && encrypted(original)) throw storageError();
    const password = sealed ? storage.decryptString(sealed) : randomBytes(32).toString('hex');
    if (!/^[a-f0-9]{64}$/.test(password)) throw storageError();
    // Persist the recoverable key before the config: interruption can safely retry migration.
    if (!sealed) await writeLocalFile(keyFile, storage.encryptString(password));
    if (original && encrypted(original)) {
      await configCommand(executable, config, 'check', password);
    } else {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = await fs.mkdtemp(path.join(directory, '.encrypt-'));
      try {
        const candidate = path.join(temporary, 'rclone.conf');
        await fs.writeFile(candidate, original ?? Buffer.alloc(0), { mode: 0o600 });
        await configCommand(executable, candidate, 'set', password);
        const protectedConfig = await fs.readFile(candidate);
        if (!encrypted(protectedConfig)) throw storageError();
        await configCommand(executable, candidate, 'check', password);
        // Do not keep plaintext backups in irori's data directory.
        await writeLocalFile(config, protectedConfig);
      } finally {
        await fs.rm(temporary, { recursive: true, force: true });
      }
    }
    if (process.platform !== 'win32') {
      await fs.chmod(directory, 0o700);
      await fs.chmod(config, 0o600);
      await fs.chmod(keyFile, 0o600);
    }
    return { config, password };
  } catch {
    // Keychain, filesystem and subprocess errors must never expose stored secrets or paths.
    throw storageError();
  }
}
