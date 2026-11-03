import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  readWriteBack,
  Redactor,
  reversibleStorage,
  SecretStore,
  secureStorageAvailable,
  type SecureStorage,
} from '../src/host/keystore';
import { secretName, secretValue } from '../src/domain/routines';

const storage = (available: boolean, backend: string): SecureStorage => ({
  ...reversibleStorage,
  isEncryptionAvailable: () => available,
  getSelectedStorageBackend: () => backend,
});

test('only a key the OS keeps counts as secure storage', () => {
  // Measured on Electron 44.3.0: without a secret service Linux reports basic_text.
  assert.equal(secureStorageAvailable(storage(true, 'basic_text'), 'linux'), false);
  assert.equal(secureStorageAvailable(storage(true, 'unknown'), 'linux'), false);
  assert.equal(secureStorageAvailable(storage(false, 'gnome_libsecret'), 'linux'), false);
  assert.equal(secureStorageAvailable(storage(true, 'gnome_libsecret'), 'linux'), true);
  assert.equal(secureStorageAvailable(storage(true, 'kwallet6'), 'linux'), true);
  assert.equal(secureStorageAvailable(storage(true, 'basic_text'), 'darwin'), true);
  assert.equal(secureStorageAvailable(storage(false, 'unknown'), 'win32'), false);
  assert.equal(secureStorageAvailable(undefined, 'darwin'), false);
  const throwing = {
    ...reversibleStorage,
    isEncryptionAvailable: () => {
      throw Error('not ready');
    },
  };
  assert.equal(secureStorageAvailable(throwing, 'win32'), false);
});

test('listing secrets on macOS does not touch the Keychain', async (t) => {
  const base = await mkdtemp(path.join(tmpdir(), 'irori keystore '));
  t.after(() => rm(base, { recursive: true, force: true }));
  let touched = 0;
  const keychain: SecureStorage = {
    isEncryptionAvailable: () => (touched++, true),
    encryptString: (value) => (touched++, reversibleStorage.encryptString(value)),
    decryptString: (value) => (touched++, reversibleStorage.decryptString(value)),
  };
  const store = new SecretStore(path.join(base, 'secrets.json'), keychain, 'darwin');
  assert.deepEqual(await store.list(), { available: true, names: [] });
  assert.equal(touched, 0);
  await store.set('SLACK_TOKEN', 'xoxb-first-value');
  assert.equal(touched, 1);
  assert.deepEqual((await store.list()).names, ['SLACK_TOKEN']);
  assert.equal(touched, 1);
  // A refused Keychain is reported as one, not as Electron's encryption error.
  const refused = new SecretStore(
    path.join(base, 'secrets.json'),
    {
      ...keychain,
      encryptString: () => {
        throw Error('Error while encrypting the text provided to safeStorage.encryptString.');
      },
    },
    'darwin',
  );
  await assert.rejects(refused.set('GH_TOKEN', 'ghp_value_12345'), /キーチェーンが必要です/);
});

test('names and values are bounded', () => {
  for (const name of [
    'SLACK_TOKEN',
    'GH_TOKEN',
    'GIT_TOKEN',
    'LDAP_PASSWORD',
    'ENV_KEY',
    '_X',
    'A1',
  ])
    assert.ok(secretName.safeParse(name).success, name);
  for (const name of ['slack', '1A', 'PATH', 'HOME', 'NODE_OPTIONS', 'IRORI_WORK', 'A-B', ''])
    assert.ok(!secretName.safeParse(name).success, name);
  // Names that change how a program starts or where it loads code from.
  for (const name of [
    'BASH_ENV',
    'ENV',
    'NODE_PATH',
    'PYTHONPATH',
    'PYTHONSTARTUP',
    'PYTHONHOME',
    'PERL5OPT',
    'PERL5LIB',
    'RUBYOPT',
    'RUBYLIB',
    'GIT_SSH_COMMAND',
    'GIT_SSH',
    'GIT_EXEC_PATH',
    'GIT_CONFIG_GLOBAL',
    'GIT_CONFIG_SYSTEM',
    'GIT_CONFIG_COUNT',
    'GIT_CONFIG_KEY_0',
    'PATHEXT',
    'COMSPEC',
    'PROMPT_COMMAND',
    'ZDOTDIR',
    'LD_PRELOAD',
    'LD_AUDIT',
    'DYLD_INSERT_LIBRARIES',
    'DYLD_LIBRARY_PATH',
  ])
    assert.ok(!secretName.safeParse(name).success, name);
  assert.ok(secretValue.safeParse('xoxb-1234-abcd').success);
  for (const value of ['short', 'line\nbreak', 'tab\there12', 'x'.repeat(8193)])
    assert.ok(!secretValue.safeParse(value).success, JSON.stringify(value.slice(0, 20)));
});

test('the store keeps sealed values, lists names only and refuses without a key', async (t) => {
  const base = await mkdtemp(path.join(tmpdir(), 'irori keystore '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const file = path.join(base, 'data', 'secrets.json');
  const store = new SecretStore(file, reversibleStorage, 'darwin');
  assert.deepEqual(await store.list(), { available: true, names: [] });
  await store.set('SLACK_TOKEN', 'xoxb-first-value');
  await store.set('GH_TOKEN', 'ghp_value_12345');
  assert.deepEqual(await store.list(), { available: true, names: ['GH_TOKEN', 'SLACK_TOKEN'] });
  const written = await readFile(file, 'utf8');
  assert.doesNotMatch(written, /xoxb-first-value/);
  if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.deepEqual(await store.values(['SLACK_TOKEN']), { SLACK_TOKEN: 'xoxb-first-value' });
  await assert.rejects(store.values(['MISSING_ONE']), /シークレット MISSING_ONE がありません/);
  await assert.rejects(
    store.set('PATH', 'something-long'),
    /PATH はシークレットの名前に使えません/,
  );
  await assert.rejects(store.set('SHORT_ONE', 'abc'), /8〜8192 文字の 1 行/);
  // Concurrent write-backs keep each other's values.
  await Promise.all([
    store.update({ SLACK_TOKEN: 'xoxb-second-value' }),
    store.update({ GH_TOKEN: 'ghp_value_67890' }),
  ]);
  assert.deepEqual(await store.values(['SLACK_TOKEN', 'GH_TOKEN']), {
    SLACK_TOKEN: 'xoxb-second-value',
    GH_TOKEN: 'ghp_value_67890',
  });
  await store.delete('GH_TOKEN');
  assert.deepEqual((await store.list()).names, ['SLACK_TOKEN']);
  // The same file on a device whose key is gone: names stay listed, values do not leave.
  const locked = new SecretStore(file, storage(true, 'basic_text'), 'linux');
  assert.deepEqual(await locked.list(), { available: false, names: ['SLACK_TOKEN'] });
  await assert.rejects(locked.values(['SLACK_TOKEN']), /OS のキーチェーンが必要です/);
  await assert.rejects(locked.set('OTHER_ONE', 'value-long-enough'), /OS のキーチェーンが必要です/);
  await locked.delete('SLACK_TOKEN');
  assert.deepEqual((await locked.list()).names, []);
  // A value sealed with another key asks to be entered again.
  await store.set('SLACK_TOKEN', 'xoxb-third-value');
  const other = new SecretStore(
    file,
    { ...reversibleStorage, decryptString: () => assert.fail('decrypt') },
    'darwin',
  );
  await assert.rejects(other.values(['SLACK_TOKEN']), /入力し直してください/);
});

test('values are hidden in records, even when they arrive in pieces', () => {
  const redactor = new Redactor();
  redactor.add('xoxb-abc-123');
  redactor.add('xoxb-abc-123-longer');
  assert.equal(redactor.hide('a xoxb-abc-123 b xoxb-abc-123-longer c'), 'a *** b *** c');
  const stream = redactor.stream();
  let shown = '';
  for (const piece of ['token: xo', 'xb-a', 'bc-1', '23\nnext x', 'o'])
    shown += stream.write(piece);
  // The held end could still begin a value; nothing of the value was shown.
  assert.equal(shown, 'token: ***\nnext ');
  shown += stream.end();
  assert.equal(shown, 'token: ***\nnext xo');
  const plain = new Redactor().stream();
  assert.equal(plain.write('nothing to hide'), 'nothing to hide');
});

test('a value is hidden in its base64 and percent-encoded forms too', () => {
  const value = 'p@ss w/rd&x=1?>>';
  const redactor = new Redactor();
  redactor.add(value);
  const base64 = Buffer.from(value).toString('base64');
  const urlSafe = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.notEqual(base64.replace(/=+$/, ''), urlSafe);
  const form = new URLSearchParams({ q: value }).toString();
  assert.equal(
    redactor.hide(`a ${base64} b ${urlSafe} c ${encodeURIComponent(value)} d ${form}`),
    'a ***== b *** c *** d q=***',
  );
  // `echo "$TOKEN" | base64` encodes a line break after the value.
  const echoed = Buffer.from(`${value}\n`).toString('base64');
  assert.doesNotMatch(redactor.hide(echoed), new RegExp(base64.slice(0, 16)));
  // A stream holds back the beginning of an encoding as it does the value's.
  const stream = redactor.stream();
  let shown = '';
  for (const piece of [`Authorization: Basic ${base64.slice(0, 5)}`, base64.slice(5), '\n'])
    shown += stream.write(piece);
  shown += stream.end();
  assert.equal(shown, 'Authorization: Basic ***==\n');
});

test('a write-back keeps declared names and names refused lines without their text', () => {
  assert.deepEqual(
    readWriteBack(
      'SLACK_TOKEN=xoxe-new-1\nSLACK_REFRESH=xoxe-refresh-1\r\n',
      ['SLACK_TOKEN', 'SLACK_REFRESH'],
      true,
    ),
    { values: { SLACK_TOKEN: 'xoxe-new-1', SLACK_REFRESH: 'xoxe-refresh-1' }, refused: [] },
  );
  assert.deepEqual(readWriteBack('A_ONE=first-value\nA_ONE=second-value', ['A_ONE'], true), {
    values: { A_ONE: 'second-value' },
    refused: [],
  });
  const refused = readWriteBack(
    'OTHER=leaked-value-1\nnot a line\nA_ONE=short\nA_ONE=good-value-1\n',
    ['A_ONE'],
    true,
  );
  assert.deepEqual(refused.values, { A_ONE: 'good-value-1' });
  assert.deepEqual(refused.refused, [
    '1 行目（OTHER は宣言されていません）',
    '2 行目',
    '3 行目（A_ONE の値）',
  ]);
  assert.doesNotMatch(refused.refused.join(), /leaked-value/);
  // A step that did not end well may have stopped mid-line.
  assert.deepEqual(readWriteBack('A_ONE=finished-1\nA_ONE=unfinish', ['A_ONE'], false), {
    values: { A_ONE: 'finished-1' },
    refused: [],
  });
});

test('a secret saved under a name reserved later stays readable and removable', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'irori-keys-reserved-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'secrets.json');
  const { writeFile } = await import('node:fs/promises');
  const sealed = (value: string) => reversibleStorage.encryptString(value).toString('base64');
  await writeFile(
    file,
    JSON.stringify({
      schemaVersion: 1,
      values: { PYTHONPATH: sealed('saved-before'), API_TOKEN: sealed('kept-value') },
    }),
  );
  const store = new SecretStore(file, reversibleStorage);
  assert.equal(secretName.safeParse('PYTHONPATH').success, false);
  assert.deepEqual((await store.values(['API_TOKEN'])).API_TOKEN, 'kept-value');
  await store.delete('PYTHONPATH');
  assert.deepEqual(Object.keys(JSON.parse(await readFile(file, 'utf8')).values), ['API_TOKEN']);
});
