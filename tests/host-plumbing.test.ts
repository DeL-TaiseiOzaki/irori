import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, stat, writeFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { dispatchHost, hostArguments, type HostHandlers } from '../src/domain/host-requests';
import { hostBridge, type HostRequests } from '../src/domain/host-bridge';
import { SerialQueue } from '../src/host/serial-queue';
import { readLocalJson, replaceFile, writeLocalJson } from '../src/host/local-json';

test('Host requests reject unknown/prototype methods and invalid arguments before invoking handlers', async () => {
  const calls: unknown[] = [];
  const handlers = Object.fromEntries(
    Object.keys(hostArguments).map((name) => [
      name,
      (...args: unknown[]) => calls.push({ name, args }),
    ]),
  ) as unknown as HostHandlers;
  for (const method of ['constructor', 'toString', '__proto__', 'invoke', null, {}])
    assert.throws(() => dispatchHost(handlers, method, []), /Unknown host operation/);
  for (const [method, args] of [
    ['spaces', ['extra']],
    ['read', ['not-a-uuid', 'note.md']],
    ['gitStage', ['00000000-0000-4000-8000-000000000000', 'note.md', true, 'stale']],
    ['respond', ['00000000-0000-4000-8000-000000000000', true, { q: [1] }]],
  ] as const)
    assert.throws(() => dispatchHost(handlers, method, [...args]));
  assert.deepEqual(calls, []);
  const bridge = hostBridge(
    Object.keys(hostArguments) as (keyof HostRequests)[],
    async (method, ...args) => dispatchHost(handlers, method, args),
  );
  assert.deepEqual(Object.keys(bridge).sort(), Object.keys(hostArguments).sort());
  assert.equal(Object.hasOwn(bridge, 'invoke'), false);
  await bridge.spaces();
  await bridge.saveWorkspace('  Workspace  ', ['00000000-0000-4000-8000-000000000000']);
  assert.deepEqual(calls, [
    { name: 'spaces', args: [] },
    { name: 'saveWorkspace', args: ['Workspace', ['00000000-0000-4000-8000-000000000000']] },
  ]);
});

test('Serial operations include waiting tasks in busy state and recover after rejection', async () => {
  const queue = new SerialQueue(),
    other = new SerialQueue();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const order: number[] = [];
  const first = queue.run(async () => {
    await gate;
    order.push(1);
    throw Error('failed write');
  });
  const rejected = assert.rejects(first, /failed write/);
  const second = queue.run(() => {
    order.push(2);
    return 'saved';
  });
  assert.equal(queue.busy, true);
  assert.equal(await other.run(() => 'independent'), 'independent');
  assert.deepEqual(order, []);
  release();
  await rejected;
  assert.equal(await second, 'saved');
  await queue.idle();
  assert.deepEqual(order, [1, 2]);
  assert.equal(queue.busy, false);
});

test('Device metadata remains private and complete after concurrent writes and a failed serialization', async (t) => {
  const base = await mkdtemp(path.join(tmpdir(), 'irori-metadata-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const file = path.join(base, 'device', 'state.json');
  await writeLocalJson(file, { previous: true });
  // A malformed value must not truncate the last valid record.
  await assert.rejects(writeLocalJson(file, { unsupported: 1n }));
  assert.deepEqual(await readLocalJson(file, null), { previous: true });
  await Promise.all(
    Array.from({ length: 12 }, (_, revision) =>
      writeLocalJson(file, { revision, text: '日本語'.repeat(1000) }),
    ),
  );
  const saved = (await readLocalJson(file, null)) as { revision: number; text: string };
  assert.ok(Number.isInteger(saved.revision));
  assert.equal(saved.text, '日本語'.repeat(1000));
  assert.deepEqual(await readdir(path.dirname(file)), ['state.json']);
  if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
  await writeFile(file, '{');
  await assert.rejects(readLocalJson(file, []));
  if (process.platform !== 'win32') {
    const link = path.join(base, 'linked.json');
    await symlink(file, link);
    await assert.rejects(writeLocalJson(link, { changed: true }), /regular file/);
    await assert.rejects(readLocalJson(file, []));
  }
});

test('A save retries a replacement Windows briefly refuses, and nothing else', async () => {
  const refusing = (codes: string[]) => {
    const calls: string[] = [];
    return {
      calls,
      rename: async (from: string, to: string) => {
        calls.push(`${from}>${to}`);
        const code = codes.shift();
        if (code) throw Object.assign(Error(code), { code });
      },
    };
  };
  const busy = refusing(['EPERM', 'EBUSY', 'EACCES']);
  await replaceFile('a.tmp', 'a.md', { platform: 'win32', rename: busy.rename });
  assert.equal(busy.calls.length, 4);
  // Elsewhere a refusal is real, and so is any other error on Windows.
  const posix = refusing(['EPERM']);
  await assert.rejects(replaceFile('a.tmp', 'a.md', { platform: 'linux', rename: posix.rename }), {
    code: 'EPERM',
  });
  assert.equal(posix.calls.length, 1);
  const missing = refusing(['ENOENT']);
  await assert.rejects(
    replaceFile('a.tmp', 'a.md', { platform: 'win32', rename: missing.rename }),
    {
      code: 'ENOENT',
    },
  );
  assert.equal(missing.calls.length, 1);
  // A file held open for good still fails, after about three seconds.
  const held = refusing(Array(20).fill('EBUSY'));
  const started = Date.now();
  await assert.rejects(replaceFile('a.tmp', 'a.md', { platform: 'win32', rename: held.rename }), {
    code: 'EBUSY',
  });
  assert.equal(held.calls.length, 8);
  assert.ok(Date.now() - started < 5000);
});
