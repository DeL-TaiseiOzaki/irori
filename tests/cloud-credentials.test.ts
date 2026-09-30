import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat, symlink } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  protectRcloneConfig,
  rcloneEnv,
  secureStorageAvailable,
  type SecureStorage,
} from '../src/cloud/credentials';
import { Rclone } from '../src/cloud/rclone';
import { CloudAccounts } from '../src/cloud/accounts';
import { fixtureSecureStorage } from './rclone-fixture';

async function fixture(t: any) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori-secure-config-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const directory = path.join(base, 'rclone');
  await mkdir(directory);
  const config = path.join(directory, 'rclone.conf');
  const plaintext = '[fixture]\ntype = local\ntoken = synthetic-oauth-token\n';
  await writeFile(config, plaintext);
  return { base, directory, config, plaintext };
}

test('Unavailable or insecure keychain never mutates legacy credentials or starts rclone', async (t) => {
  const { base, directory, config, plaintext } = await fixture(t);
  const unavailable: SecureStorage = {
    ...fixtureSecureStorage,
    isEncryptionAvailable: () => false,
  };
  const insecure: SecureStorage = {
    ...fixtureSecureStorage,
    getSelectedStorageBackend: () => 'basic_text',
  };
  for (const storage of [
    undefined,
    unavailable,
    ...(process.platform === 'linux' ? [insecure] : []),
  ]) {
    const rpc = new Rclone(base, 'nonexistent-irori-rclone', storage);
    await assert.rejects(rpc.call('config/listremotes'), /キーチェーン|keychain/);
    await rpc.close();
    assert.equal(await readFile(config, 'utf8'), plaintext);
    assert.deepEqual(await readdir(directory), ['rclone.conf']);
  }
});

test('Linux backend checks never call its Linux-only API on Windows or macOS', () => {
  const storage: SecureStorage = {
    ...fixtureSecureStorage,
    getSelectedStorageBackend: () => {
      throw Error('Linux-only API');
    },
  };
  assert.equal(secureStorageAvailable(storage, 'win32'), true);
  assert.equal(secureStorageAvailable(storage, 'darwin'), true);
  assert.equal(secureStorageAvailable(storage, 'linux'), false);
  assert.equal(
    secureStorageAvailable(
      { ...fixtureSecureStorage, getSelectedStorageBackend: () => 'basic_text' },
      'linux',
    ),
    false,
  );
});

test('Unavailable credential storage refuses account creation and preserves ready reauthorization metadata', async (t) => {
  const { base, directory, config, plaintext } = await fixture(t);
  const rpc = new Rclone(base, 'nonexistent-irori-rclone');
  t.after(() => rpc.close());
  let browserCalls = 0;
  const oauth = {
    clientId: 'fixture.apps.googleusercontent.com',
    clientSecret: 'synthetic-client',
  };
  const accounts = new CloudAccounts(
    base,
    rpc,
    async () => {
      browserCalls++;
    },
    oauth,
  );
  await assert.rejects(accounts.add('Unavailable test'), /キーチェーン|keychain/);
  assert.deepEqual(await accounts.list(), []);
  await assert.rejects(readFile(path.join(base, 'cloud-accounts.json')), { code: 'ENOENT' });
  const ready = [
    {
      id: '36b40f5d-365a-4b64-a4c0-209d0047b5d2',
      name: 'Earlier ready account',
      provider: 'google-drive',
      state: 'ready',
      writable: true,
    },
  ];
  const filename = path.join(base, 'cloud-accounts.json');
  const original = JSON.stringify(ready);
  await writeFile(filename, original);
  const restored = new CloudAccounts(
    base,
    rpc,
    async () => {
      browserCalls++;
    },
    oauth,
  );
  await assert.rejects(restored.reauthorize(ready[0].id), /キーチェーン|keychain/);
  assert.equal(await readFile(filename, 'utf8'), original);
  assert.equal((await restored.list())[0].state, 'ready');
  assert.equal(browserCalls, 0);
  assert.equal(await readFile(config, 'utf8'), plaintext);
  assert.deepEqual(await readdir(directory), ['rclone.conf']);
});

test('Keychain and encryption failures preserve plaintext config and hide error details', async (t) => {
  const { directory, config, plaintext } = await fixture(t);
  const failing: SecureStorage = {
    ...fixtureSecureStorage,
    encryptString: () => {
      throw Error('synthetic-oauth-token machine/private-path');
    },
  };
  await assert.rejects(protectRcloneConfig(directory, 'unused', failing), (error: Error) => {
    assert(!error.message.includes('synthetic-oauth-token'));
    assert(!error.message.includes('private-path'));
    return true;
  });
  assert.deepEqual(await readdir(directory), ['rclone.conf']);
  await assert.rejects(
    protectRcloneConfig(directory, 'nonexistent-irori-rclone', fixtureSecureStorage),
  );
  assert.equal(await readFile(config, 'utf8'), plaintext);
  assert.deepEqual((await readdir(directory)).sort(), ['config-key.bin', 'rclone.conf']);
});

test('Existing encrypted config never receives a newly generated replacement key', async (t) => {
  const { directory, config } = await fixture(t);
  const encrypted = '# fixture\nRCLONE_ENCRYPT_V0:\nexisting-encrypted-content';
  await writeFile(config, encrypted);
  await assert.rejects(protectRcloneConfig(directory, 'unused', fixtureSecureStorage));
  assert.equal(await readFile(config, 'utf8'), encrypted);
  assert.deepEqual(await readdir(directory), ['rclone.conf']);
});

test('Secure startup removes interrupted migration directories only and preserves config, key, cache and link targets', async (t) => {
  const { base, directory, config, plaintext } = await fixture(t);
  const keyFile = path.join(directory, 'config-key.bin');
  const sealed = fixtureSecureStorage.encryptString('a'.repeat(64));
  await writeFile(keyFile, sealed);
  const interrupted = path.join(directory, '.encrypt-A1b2C3');
  await mkdir(interrupted, { mode: 0o700 });
  await writeFile(path.join(interrupted, 'rclone.conf'), plaintext, { mode: 0o600 });
  for (const name of ['.encrypt-', '.encrypt-short', '.encrypt-Abc1234', 'other-directory']) {
    await mkdir(path.join(directory, name));
    await writeFile(path.join(directory, name, 'preserved'), 'unrelated bytes');
  }
  const ordinaryFile = path.join(directory, '.encrypt-F1l2E3');
  await writeFile(ordinaryFile, 'ordinary file');
  const cache = path.join(directory, 'cache', '.encrypt-V1f2S3');
  await mkdir(cache, { recursive: true });
  await writeFile(path.join(cache, 'pending'), 'unsent bytes');
  const outside = path.join(base, 'outside');
  await mkdir(outside);
  await writeFile(path.join(outside, 'preserved'), 'outside bytes');
  const linked = path.join(directory, '.encrypt-Z9y8X7');
  if (process.platform !== 'win32') await symlink(outside, linked, 'dir');
  await assert.rejects(protectRcloneConfig(directory, 'unused'));
  assert.equal(await readFile(path.join(interrupted, 'rclone.conf'), 'utf8'), plaintext);
  // Encryption failure must not undo recovery cleanup or replace the existing credentials.
  await assert.rejects(
    protectRcloneConfig(directory, 'nonexistent-irori-rclone', fixtureSecureStorage),
  );
  await assert.rejects(stat(interrupted), { code: 'ENOENT' });
  assert.equal(await readFile(config, 'utf8'), plaintext);
  assert.deepEqual(await readFile(keyFile), sealed);
  assert.equal(await readFile(path.join(cache, 'pending'), 'utf8'), 'unsent bytes');
  assert.equal(await readFile(ordinaryFile, 'utf8'), 'ordinary file');
  for (const name of ['.encrypt-', '.encrypt-short', '.encrypt-Abc1234', 'other-directory'])
    assert.equal(
      await readFile(path.join(directory, name, 'preserved'), 'utf8'),
      'unrelated bytes',
    );
  assert.equal(await readFile(path.join(outside, 'preserved'), 'utf8'), 'outside bytes');
  if (process.platform !== 'win32') {
    assert.equal(await readFile(path.join(linked, 'preserved'), 'utf8'), 'outside bytes');
    await rm(interrupted, { recursive: true, force: true });
    await mkdir(interrupted);
    await symlink(outside, path.join(interrupted, 'nested-link'), 'dir');
    await assert.rejects(
      protectRcloneConfig(directory, 'nonexistent-irori-rclone', fixtureSecureStorage),
    );
    assert.equal(await readFile(path.join(outside, 'preserved'), 'utf8'), 'outside bytes');
  }
});

test('Credential protection rejects symlinks instead of replacing outside config', async (t) => {
  if (process.platform === 'win32') return t.skip('Creating symlinks requires Windows privileges');
  const { base, directory, config, plaintext } = await fixture(t);
  const outside = path.join(base, 'outside.conf');
  await writeFile(outside, plaintext);
  await rm(config);
  await symlink(outside, config);
  await assert.rejects(protectRcloneConfig(directory, 'unused', fixtureSecureStorage));
  assert.equal(await readFile(outside, 'utf8'), plaintext);
});

test('rclone receives a sanitized private environment without changing the host environment', () => {
  const names = ['RCLONE_CONFIG_PASS', '_RCLONE_CONFIG_KEY_FILE', 'rclone_rc_pass'];
  const previous = names.map((name) => process.env[name]);
  try {
    for (const name of names) process.env[name] = 'synthetic inherited secret';
    const env = rcloneEnv();
    for (const name of names) {
      assert.equal(env[name], undefined);
      assert.equal(process.env[name], 'synthetic inherited secret');
    }
  } finally {
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  }
});

test(
  'Native binary diagnostics work without keychain and never read or change existing credentials',
  { skip: !process.env.IRORI_TEST_RCLONE_PATH, timeout: 15000 },
  async (t) => {
    const { base, directory, config, plaintext } = await fixture(t);
    const rpc = new Rclone(base, process.env.IRORI_TEST_RCLONE_PATH);
    t.after(() => rpc.close());
    assert.match((await rpc.call('core/version')).version, /^v1\./);
    assert(Array.isArray((await rpc.call('mount/types')).mountTypes));
    await assert.rejects(rpc.call('config/listremotes'), /キーチェーン|keychain/);
    await assert.rejects(rpc.call('backend/command', { command: 'list' }), /キーチェーン|keychain/);
    assert.equal(await readFile(config, 'utf8'), plaintext);
    assert.deepEqual(await readdir(directory), ['rclone.conf']);
    await rpc.close();
    await assert.rejects(rpc.call('core/version'), /終了|stopped/);
  },
);

test(
  'Native rclone encrypts legacy config, keeps config updates encrypted, and survives restart',
  { skip: !process.env.IRORI_TEST_RCLONE_PATH, timeout: 25000 },
  async (t) => {
    const { base, directory, config } = await fixture(t);
    const executable = process.env.IRORI_TEST_RCLONE_PATH!;
    const protectedConfig = await protectRcloneConfig(directory, executable, fixtureSecureStorage);
    const encrypted = await readFile(config, 'utf8');
    assert.match(encrypted, /RCLONE_ENCRYPT_V0:/);
    assert(!encrypted.includes('synthetic-oauth-token'));
    assert.equal(
      fixtureSecureStorage.decryptString(await readFile(path.join(directory, 'config-key.bin'))),
      protectedConfig.password,
    );
    assert(!encrypted.includes(protectedConfig.password));
    assert.deepEqual((await readdir(directory)).sort(), ['config-key.bin', 'rclone.conf']);
    const sealedBefore = await readFile(path.join(directory, 'config-key.bin'));
    const interrupted = path.join(directory, '.encrypt-R1e2D3');
    await mkdir(interrupted);
    await writeFile(path.join(interrupted, 'rclone.conf'), 'synthetic interrupted token');
    await protectRcloneConfig(directory, executable, fixtureSecureStorage);
    assert.equal(await readFile(config, 'utf8'), encrypted);
    assert.deepEqual(await readFile(path.join(directory, 'config-key.bin')), sealedBefore);
    await assert.rejects(stat(interrupted), { code: 'ENOENT' });
    if (process.platform !== 'win32') {
      assert.equal((await stat(config)).mode & 0o777, 0o600);
      assert.equal((await stat(directory)).mode & 0o777, 0o700);
    }
    const rpc = new Rclone(base, executable, fixtureSecureStorage);
    t.after(() => rpc.close());
    assert.deepEqual((await rpc.call('config/listremotes')).remotes, ['fixture']);
    await rpc.call('config/create', { name: 'another', type: 'local', parameters: {} });
    assert.match(await readFile(config, 'utf8'), /RCLONE_ENCRYPT_V0:/);
    await rpc.close();
    const restarted = new Rclone(base, executable, fixtureSecureStorage);
    t.after(() => restarted.close());
    assert.deepEqual((await restarted.call('config/listremotes')).remotes.sort(), [
      'another',
      'fixture',
    ]);
    const sealed = await readFile(path.join(directory, 'config-key.bin'));
    await writeFile(path.join(directory, 'config-key.bin'), Buffer.from('corrupt fixture key'));
    const before = await readFile(config);
    await assert.rejects(protectRcloneConfig(directory, executable, fixtureSecureStorage));
    assert.deepEqual(await readFile(config), before);
    await writeFile(path.join(directory, 'config-key.bin'), sealed);
  },
);
