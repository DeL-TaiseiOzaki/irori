import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { releasePlace, takePlace } from '../src/remote/host-place';

// A vault host's place is its folder's pid file (ADR 061); its socket is where it listens.
const posix = { skip: process.platform === 'win32' && 'vault hosts run on POSIX SSH hosts' };

test(
  'a vault host that ends while another takes its place leaves that one its place',
  posix,
  async (t) => {
    const dir = await mkdtemp(path.join(tmpdir(), 'irori-host-place-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const socketPath = path.join(dir, 'host.sock');
    const pidFile = path.join(dir, 'host.pid');
    // Host A has served for a while, then begins to end: it stops listening, and its
    // closing takes time. Its pid file is older than a start takes, and nothing answers.
    const ending = 2_000_000_000;
    await writeFile(pidFile, String(ending));
    const old = new Date(Date.now() - 60_000);
    await utimes(pidFile, old, old);
    // Meanwhile a login starts host B, which takes the place that looks left behind.
    assert.equal(await takePlace(dir, socketPath), pidFile);
    assert.equal(await readFile(pidFile, 'utf8'), String(process.pid));
    // A finishes ending: B's place stays, so the login reaches B and no third host starts.
    await releasePlace(pidFile, ending);
    assert.equal(await readFile(pidFile, 'utf8'), String(process.pid));
    // B ending lets its own place go.
    await releasePlace(pidFile);
    assert.equal(existsSync(pidFile), false);
  },
);

test('a vault host that answers, or is starting, keeps its place', posix, async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'irori-host-place-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const socketPath = path.join(dir, 'host.sock');
  const pidFile = path.join(dir, 'host.pid');
  // Just written by a host that does not listen yet: it is starting.
  await writeFile(pidFile, '2000000001');
  assert.equal(await takePlace(dir, socketPath), undefined);
  // An old file, but its host answers.
  const old = new Date(Date.now() - 60_000);
  await utimes(pidFile, old, old);
  const server = net.createServer((socket) => socket.destroy());
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  assert.equal(await takePlace(dir, socketPath), undefined);
  assert.equal(await readFile(pidFile, 'utf8'), '2000000001');
  // Closing the server takes its socket file away: a host ending removes no socket itself.
  await new Promise<void>((resolve) => server.close(() => resolve()));
  assert.equal(existsSync(socketPath), false);
});
