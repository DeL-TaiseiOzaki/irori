import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { descendantsOf, killTree, launch, liveChildren, version } from '../src/agents/process';
import { Tail } from '../src/agents/tail';

const posix = { skip: process.platform === 'win32' && 'POSIX process groups and ps' };
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  return true;
};
/** Whether the process is still running, apart from a zombie its reaper has not collected. */
async function running(pid: number) {
  if (!alive(pid)) return false;
  const { stdout } = await promisify(execFile)('ps', ['-o', 'stat=', '-p', String(pid)]).catch(
    () => ({ stdout: '' }),
  );
  return stdout.trim() !== '' && !stdout.trim().startsWith('Z');
}
async function until(check: () => Promise<boolean> | boolean, ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return check();
}
/** A child that starts a grandchild in its own session and prints its pid, then waits. */
const parentScript = (ignoreTerm: boolean) => `
  const { spawn } = require('node:child_process');
  ${ignoreTerm ? "process.on('SIGTERM', () => {});" : ''}
  const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
  grandchild.unref();
  process.stdout.write(String(grandchild.pid) + '\\n');
  setInterval(() => {}, 1000);
`;
function firstLine(child: ReturnType<typeof launch>) {
  return new Promise<string>((resolve) => {
    let text = '';
    child.stdout!.on('data', (chunk) => {
      text += chunk;
      if (text.includes('\n')) resolve(text.split('\n')[0]);
    });
  });
}

test('Descendants are read from a ps listing, children before grandchildren', () => {
  const listing = '  1 0\n 10 1\n 11 10\n 12 10\n 20 11\n 30 2\n';
  assert.deepEqual(descendantsOf(10, listing), [11, 12, 20]);
  assert.deepEqual(descendantsOf(30, listing), []);
  assert.deepEqual(descendantsOf(99, ''), []);
});

test(
  'Stopping a child also stops a grandchild that moved to its own session, soon after the child exits',
  posix,
  async () => {
    const child = launch(process.execPath, ['-e', parentScript(false)], process.cwd());
    const grandchild = Number(await firstLine(child));
    assert.ok(grandchild > 0);
    assert.ok(liveChildren().includes(child), 'a launched child is registered until it exits');
    assert.ok(await running(grandchild));
    const started = Date.now();
    await killTree(child);
    assert.ok(
      Date.now() - started < 2000,
      'a child that exits on SIGTERM is not waited on for the grace period',
    );
    assert.ok(
      await until(async () => !(await running(grandchild)), 2000),
      'the grandchild is gone',
    );
    assert.ok(await until(() => !liveChildren().includes(child), 2000));
  },
);

test(
  'A child that ignores SIGTERM is killed when the grace period ends, with what it started',
  { ...posix, timeout: 15000 },
  async () => {
    const child = launch(process.execPath, ['-e', parentScript(true)], process.cwd());
    const grandchild = Number(await firstLine(child));
    const started = Date.now();
    await killTree(child);
    const took = Date.now() - started;
    assert.ok(took >= 2000 && took < 6000, `waited ${took} ms`);
    assert.ok(await until(() => child.exitCode !== null || child.signalCode !== null, 2000));
    assert.ok(await until(async () => !(await running(grandchild)), 2000));
  },
);

test(
  'Children still running when the process ends are killed by its exit handler',
  { ...posix, timeout: 20000 },
  async () => {
    const script = `
      import { launch } from ${JSON.stringify(new URL('../src/agents/process.ts', import.meta.url).href)};
      const child = launch(process.execPath, ['-e', ${JSON.stringify(parentScript(true))}], process.cwd());
      child.stdout.on('data', (chunk) => {
        process.stdout.write(child.pid + ' ' + chunk);
        setTimeout(() => process.exit(0), 50);
      });
    `;
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', script],
      { timeout: 15000 },
    );
    const [child, grandchild] = stdout.trim().split(/\s+/).map(Number);
    assert.ok(child > 0 && grandchild > 0, stdout);
    assert.ok(await until(async () => !(await running(child)), 3000), 'the child is gone');
    assert.ok(
      await until(async () => !(await running(grandchild)), 3000),
      'the grandchild is gone',
    );
  },
);

test('A CLI is asked its version once per installed executable', posix, async (t) => {
  const base = await mkdtemp(path.join(tmpdir(), 'irori version cache '));
  const previous = process.env.PATH;
  process.env.PATH = base + path.delimiter + previous;
  t.after(async () => {
    process.env.PATH = previous;
    await rm(base, { recursive: true, force: true });
  });
  const tool = path.join(base, 'irori-fixture-cli');
  const log = path.join(base, 'asked.log');
  const install = (answer: string) =>
    writeFile(
      tool,
      `#!/bin/sh\necho asked >> ${JSON.stringify(log)}\necho ${JSON.stringify(answer)}\n`,
      { mode: 0o700 },
    );
  await install('1.0.0');
  assert.equal(await version('irori-fixture-cli'), '1.0.0');
  assert.equal(await version('irori-fixture-cli'), '1.0.0');
  assert.equal((await readFile(log, 'utf8')).trim().split('\n').length, 1, 'asked once');
  // An updated executable is asked again.
  await new Promise((resolve) => setTimeout(resolve, 20));
  await install('1.1.0-updated');
  assert.equal(await version('irori-fixture-cli'), '1.1.0-updated');
  assert.equal((await readFile(log, 'utf8')).trim().split('\n').length, 2);
  // A failing one is not remembered.
  await rm(tool);
  await assert.rejects(version('irori-fixture-cli'));
  await install('2.0.0');
  assert.equal(await version('irori-fixture-cli'), '2.0.0');
});

test('A text tail keeps its last characters without copying the whole on every addition', () => {
  const tail = new Tail(10);
  tail.add('abc');
  assert.equal(tail.toString(), 'abc');
  for (let n = 0; n < 1000; n++) tail.add(String(n % 10));
  assert.equal(tail.toString().length, 10);
  assert.equal(tail.toString(), '0123456789');
  tail.add('xyz');
  assert.equal(tail.toString(), '3456789xyz');
  tail.clear();
  assert.equal(tail.toString(), '');
});
