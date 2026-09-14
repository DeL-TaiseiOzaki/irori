import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { FileService } from '../src/host/files';
import { DraftService } from '../src/host/drafts';
import {
  DraftController,
  draftKey,
  type DraftBackend,
  type DraftKey,
  type DraftRecord,
  type DraftValue,
} from '../src/domain/drafts';

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori drafts '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  await mkdir(path.join(base, 'notes'));
  const space = await files.register(path.join(base, 'notes'), 'Draft fixture', 'personal');
  const service = new DraftService(files);
  const key: DraftKey = { kind: 'composer', scopeId: space.scopeId, agent: 'claude' };
  return { base, files, space, service, key };
}
const backend = (service: DraftService): DraftBackend => ({
  draftRead: (key) => service.read(key),
  draftWrite: (key, value, revision) => service.write(key, value, revision),
});

test('Device drafts survive host restart, preserve empty text, and retain acknowledged clears as tombstones', async (t) => {
  const { files, service, key, space } = await fixture(t);
  const first = await service.write(key, { text: 'Unsent 日本語' }, null);
  const restartedFiles = new FileService(files.dataDir);
  await restartedFiles.init();
  const restarted = new DraftService(restartedFiles);
  assert.equal((await restarted.read(key))?.text, 'Unsent 日本語');
  const empty = await restarted.write(key, { text: '' }, first.revision);
  assert.equal((await new DraftService(restartedFiles).read(key))?.text, '');
  const cleared = await restarted.write(key, { text: null }, empty.revision);
  assert.equal((await new DraftService(restartedFiles).read(key))?.text, null);
  await assert.rejects(
    service.write(key, { text: 'Delayed stale text' }, first.revision),
    /下書きが更新/,
  );
  assert.equal((await service.read(key))?.revision, cleared.revision);
  assert.deepEqual((await readdir(space.root)).sort(), ['.gitignore', '.irori']);
});

test('Provider, scope, canonical checkout and conflict path are isolated; base version stays discoverable', async (t) => {
  const { base, files, space, service, key } = await fixture(t);
  await service.write(key, { text: 'Claude draft' }, null);
  assert.equal(await service.read({ ...key, kind: 'composer', agent: 'codex' }), null);
  await mkdir(path.join(base, 'team'));
  const team = await files.register(path.join(base, 'team'), 'Team', 'team');
  assert.equal(
    await service.read({ kind: 'composer', scopeId: team.scopeId, agent: 'claude' }),
    null,
  );
  const conflict: DraftKey = { kind: 'git-resolution', scopeId: space.scopeId, path: 'README.md' };
  await service.write(conflict, { text: '', baseVersion: 'old-native-version' }, null);
  assert.equal((await service.read(conflict))?.baseVersion, 'old-native-version');
  assert.equal(await service.read({ ...conflict, path: 'another.md' }), null);
  assert.equal(await service.read({ kind: 'git-commit', scopeId: space.scopeId }), null);
  await mkdir(path.join(base, 'copied-checkout'));
  const copied = new DraftService({
    dataDir: files.dataDir,
    get: () => ({ ...space, root: path.join(base, 'copied-checkout') }),
  });
  assert.equal(await copied.read(key), null);
  await symlink(space.root, path.join(base, 'alias'), 'dir');
  const alias = new DraftService({
    dataDir: files.dataDir,
    get: () => ({ ...space, root: path.join(base, 'alias') }),
  });
  assert.equal((await alias.read(key))?.text, 'Claude draft');
});

test('Validation bounds records and rejects unknown targets, malformed keys, missing base versions and corrupt storage', async (t) => {
  const { files, service, key, space } = await fixture(t);
  for (const value of ['../escape', '/absolute', 'C:/windows', 'a\\b', 'a//b', 'a/./b', 'a\0b'])
    assert.equal(
      draftKey.safeParse({ kind: 'git-resolution', scopeId: space.scopeId, path: value }).success,
      false,
    );
  await assert.rejects(
    service.read({ kind: 'composer', scopeId: randomUUID(), agent: 'claude' }),
    /Unknown space/,
  );
  await assert.rejects(service.write(key, { text: 'あ'.repeat(800000) }, null), /too large/);
  await assert.rejects(
    service.write(
      { kind: 'git-resolution', scopeId: space.scopeId, path: 'file.md' },
      { text: '' },
      null,
    ),
    /base version/,
  );
  await service.write(key, { text: 'Recoverable' }, null);
  const dir = path.join(files.dataDir, 'drafts');
  const filename = path.join(dir, (await readdir(dir))[0]);
  await writeFile(filename, '{broken JSON');
  await assert.rejects(service.read(key));
  await assert.rejects(service.write(key, { text: 'Must not erase corruption' }, null));
  assert.equal(await readFile(filename, 'utf8'), '{broken JSON');
});

test('Concurrent stale draft writes cannot overwrite a later revision', async (t) => {
  const { service, key } = await fixture(t);
  const first = await service.write(key, { text: 'Initial' }, null);
  const results = await Promise.allSettled([
    service.write(key, { text: 'First writer' }, first.revision),
    service.write(key, { text: 'Stale writer' }, first.revision),
  ]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.equal((await service.read(key))?.text, 'First writer');
});

test('Device draft reads and writes refuse aliased records and preserve their previous bytes on storage failure', async (t) => {
  const { files, service, key } = await fixture(t);
  const first = await service.write(key, { text: 'Keep the durable original' }, null);
  const dir = path.join(files.dataDir, 'drafts');
  const filename = path.join(dir, (await readdir(dir))[0]);
  const saved = `${filename}.saved`;
  await rename(filename, saved);
  await mkdir(filename);
  await assert.rejects(
    service.write(key, { text: 'Cannot persist' }, first.revision),
    /Invalid draft/,
  );
  assert.equal(JSON.parse(await readFile(saved, 'utf8')).text, 'Keep the durable original');
  await rm(filename, { recursive: true });
  await symlink(saved, filename);
  await assert.rejects(service.read(key), /Invalid draft/);
  await assert.rejects(
    service.write(key, { text: 'Cannot follow alias' }, first.revision),
    /Invalid draft/,
  );
  assert.equal(JSON.parse(await readFile(saved, 'utf8')).text, 'Keep the durable original');
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const record = (text: string | null): DraftRecord => ({
  text,
  revision: randomUUID(),
  updatedAt: new Date().toISOString(),
});

test('Delayed loads remain bound to their target and cannot replace typing that arrived after the read began', async () => {
  const reads = { claude: deferred<DraftRecord | null>(), codex: deferred<DraftRecord | null>() };
  const writes: { key: DraftKey; value: DraftValue }[] = [];
  const api: DraftBackend = {
    draftRead: (key) => reads[(key as { agent: 'claude' | 'codex' }).agent].promise,
    draftWrite: async (key, value) => {
      writes.push({ key, value });
      return { ...record(value.text), ...value };
    },
  };
  const scopeId = randomUUID();
  const old = new DraftController({ scopeId, kind: 'composer', agent: 'claude' }, api);
  const current = new DraftController({ scopeId, kind: 'composer', agent: 'codex' }, api);
  const oldLoad = old.load(),
    currentLoad = current.load();
  current.setText('New typing while loading');
  reads.codex.resolve(record('Older saved Codex input'));
  await currentLoad;
  assert.equal(await current.flush(), true);
  reads.claude.resolve(record('Late Claude response'));
  await oldLoad;
  assert.equal(current.snapshot().text, 'New typing while loading');
  assert.equal(old.snapshot().text, 'Late Claude response');
  assert.deepEqual(
    writes.map((write) => write.key),
    [{ scopeId, kind: 'composer', agent: 'codex' }],
  );
});

test('Acknowledged send clears only its captured revision and preserves later typing, including repeated identical text', async (t) => {
  const { service, key } = await fixture(t);
  const controller = new DraftController(key, backend(service));
  await controller.load();
  controller.setText('Send this');
  assert.equal(await controller.flush(), true);
  const sent = controller.snapshot().record!.revision;
  controller.setText('Next thought');
  controller.setText('Send this');
  assert.equal(await controller.clear(sent), true);
  await controller.flush();
  assert.equal((await service.read(key))?.text, 'Send this');
  assert.equal(await controller.clear(controller.snapshot().record!.revision), true);
  assert.equal((await service.read(key))?.text, null);
  assert.equal(new DraftController(key, backend(service)).snapshot().text, '');
});

test('Write failures remain visible and keep text until explicit retry succeeds; deleting all text is durable', async (t) => {
  const { service, key } = await fixture(t);
  let fail = true;
  const controller = new DraftController(key, {
    ...backend(service),
    draftWrite: async (...args) => {
      if (fail) throw Error('Fixture disk unavailable');
      return service.write(...args);
    },
  });
  await controller.load();
  controller.setText('Do not lose this');
  assert.equal(await controller.flush(), false);
  assert.match(controller.snapshot().error, /disk unavailable/);
  assert.equal(controller.snapshot().text, 'Do not lose this');
  assert.equal(await controller.clear(), false);
  fail = false;
  assert.equal(await controller.retry(), true);
  assert.equal((await service.read(key))?.text, 'Do not lose this');
  controller.setText('');
  assert.equal(await controller.flush(), true);
  assert.equal((await service.read(key))?.text, '');
  assert.equal(controller.snapshot().error, '');
});

test('Explicit retry reloads a clean draft and preserves unsaved text after a stale-revision refusal', async (t) => {
  const { service, key } = await fixture(t);
  const controller = new DraftController(key, backend(service));
  await controller.load();
  controller.setText('Previously persisted');
  await controller.flush();
  let external = await service.write(
    key,
    { text: 'Newer external draft' },
    controller.snapshot().record!.revision,
  );
  assert.equal(await controller.retry(), true);
  assert.equal(controller.snapshot().text, 'Newer external draft');
  external = await service.write(key, { text: 'Another writer' }, external.revision);
  controller.setText('My unsaved local input');
  assert.equal(await controller.flush(), false);
  assert.equal(controller.snapshot().text, 'My unsaved local input');
  assert.equal((await service.read(key))?.revision, external.revision);
  assert.equal(await controller.retry(), true);
  assert.equal((await service.read(key))?.text, 'My unsaved local input');
});

test('An acknowledged clear that cannot reach disk reports failure until the tombstone is durably retried', async (t) => {
  const { service, key } = await fixture(t);
  let failClear = true;
  const controller = new DraftController(key, {
    ...backend(service),
    draftWrite: async (target, value, revision) => {
      if (value.text === null && failClear) throw Error('Fixture clear failure');
      return service.write(target, value, revision);
    },
  });
  await controller.load();
  controller.setText('Acknowledged message');
  await controller.flush();
  assert.equal(await controller.clear(controller.snapshot().record!.revision), false);
  assert.match(controller.snapshot().error, /clear failure/);
  assert.equal((await service.read(key))?.text, 'Acknowledged message');
  failClear = false;
  assert.equal(await controller.retry(), true);
  assert.equal((await service.read(key))?.text, null);
});
