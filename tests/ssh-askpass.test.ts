import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SshAskpass, type AskLogin, type LoginQuestion } from '../src/host/ssh-askpass';

const posixOnly = {
  skip:
    process.platform === 'win32' && 'Windows runs a program of its own, built with its compiler',
};

/** irori's side of what `ssh` asks, with this Node standing in for irori's own program. */
async function askpass(t: TestContext) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'irori askpass '));
  const service = new SshAskpass({ dataDir, runtime: process.execPath });
  await service.init();
  t.after(async () => {
    await service.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  return { dataDir, service };
}

/** Runs the program as `ssh` does: the question as its one argument, the answer on its output. */
function run(env: NodeJS.ProcessEnv, question: string, more: NodeJS.ProcessEnv = {}) {
  const child = spawn(env.SSH_ASKPASS!, [question], {
    env: { ...process.env, ...env, ...more },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (chunk) => (out += chunk));
  return {
    child,
    done: new Promise<{ code: number | null; out: string }>((resolve) =>
      child.once('close', (code) => resolve({ code, out })),
    ),
  };
}

test(
  'what ssh asks reaches irori through the program it runs, and the answer goes back on its output',
  posixOnly,
  async (t) => {
    const { dataDir, service } = await askpass(t);
    assert.equal(service.available, true);
    const asked: LoginQuestion[] = [];
    const session = service.session(async (question) => {
      asked.push(question);
      return 'correct horse パスワード';
    })!;
    assert.equal(session.env.SSH_ASKPASS_REQUIRE, 'force');
    assert.ok(session.env.DISPLAY);
    // The program and its client are the person's alone, and nothing of a session is in them.
    assert.equal((await stat(session.env.SSH_ASKPASS!)).mode & 0o077, 0);
    assert.equal((await stat(path.join(dataDir, 'ssh'))).mode & 0o077, 0);
    assert.doesNotMatch(
      await readFile(path.join(dataDir, 'ssh', 'askpass.cjs'), 'utf8'),
      new RegExp(session.env.IRORI_SSH_ASKPASS_SESSION!),
    );
    const first = await run(session.env, '(taro@gpu) Password: ').done;
    assert.deepEqual(first, { code: 0, out: 'correct horse パスワード\n' });
    // ssh's hint goes with the question; one it does not have is no hint.
    await run(session.env, 'Allow use of key?', { SSH_ASKPASS_PROMPT: 'confirm' }).done;
    await run(session.env, 'Touch your key', { SSH_ASKPASS_PROMPT: 'none' }).done;
    await run(session.env, 'x', { SSH_ASKPASS_PROMPT: 'whatever' }).done;
    // What a host could send to redraw the window is not shown; line breaks stay.
    await run(session.env, 'line one\nline \u001b[2Jtwo\u0007\r').done;
    assert.deepEqual(asked, [
      { text: '(taro@gpu) Password:', hint: '' },
      { text: 'Allow use of key?', hint: 'confirm' },
      { text: 'Touch your key', hint: 'none' },
      { text: 'x', hint: '' },
      { text: 'line one\nline [2Jtwo', hint: '' },
    ]);
    assert.equal(session.asking(), false);
    assert.equal(session.cancelled(), false);
  },
);

test(
  'no answer is a failure that ends the attempt, and a session that is over asks nothing',
  posixOnly,
  async (t) => {
    const { service } = await askpass(t);
    let stopped = 0;
    const session = service.session(async () => undefined)!;
    session.onCancel(() => stopped++);
    assert.deepEqual(await run(session.env, 'Password:').done, { code: 1, out: '' });
    assert.equal(session.cancelled(), true);
    assert.equal(stopped, 1);

    // A question still open when the attempt ends is taken back: its program fails, its asker is told.
    let gone: AbortSignal | undefined;
    const waiting: AskLogin = (_question, signal) => {
      gone = signal;
      return new Promise(() => {});
    };
    const open = service.session(waiting)!;
    const pending = run(open.env, 'Verification code:');
    while (!open.asking()) await new Promise((resolve) => setTimeout(resolve, 10));
    open.settle();
    assert.deepEqual(await pending.done, { code: 1, out: '' });
    assert.equal(gone?.aborted, true);
    assert.equal(open.asking(), false);
    assert.equal(open.cancelled(), false);

    // After that, and for a session irori never made, the program is refused without asking anyone.
    let asked = 0;
    const live = service.session(async () => {
      asked++;
      return 'x';
    })!;
    assert.equal((await run(open.env, 'Password:').done).code, 1);
    assert.equal(
      (await run({ ...live.env, IRORI_SSH_ASKPASS_SESSION: 'f'.repeat(32) }, 'Password:').done)
        .code,
      1,
    );
    assert.equal((await run({ ...live.env, IRORI_SSH_ASKPASS: '' }, 'Password:').done).code, 1);
    assert.equal(asked, 0);

    // The program that goes away while the person is asked takes its question with it.
    let left: AbortSignal | undefined;
    const leaving = service.session((_question, signal) => {
      left = signal;
      return new Promise(() => {});
    })!;
    const killed = run(leaving.env, 'Password:');
    while (!leaving.asking()) await new Promise((resolve) => setTimeout(resolve, 10));
    killed.child.kill('SIGKILL');
    await killed.done;
    while (!left?.aborted) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(leaving.asking(), false);
  },
);

test('on Windows nothing can be asked without the program built for it', async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'irori askpass win '));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const missing = new SshAskpass({
    dataDir,
    platform: 'win32',
    windowsClient: path.join(dataDir, 'irori-askpass.exe'),
  });
  await missing.init();
  assert.equal(missing.available, false);
  assert.equal(
    missing.session(async () => 'x'),
    undefined,
  );
  await missing.close();
});

test(
  'on Windows ssh is given the name of its program alone, and where to find it',
  { skip: process.platform !== 'win32' && 'a named pipe is listened on, which Windows has' },
  async (t) => {
    // A folder with letters ssh.exe cannot take in a path: the reason the name goes alone.
    const dataDir = await mkdtemp(path.join(tmpdir(), 'irori askpass 日本語 '));
    t.after(() => rm(dataDir, { recursive: true, force: true }));
    const built = path.join(dataDir, 'app', 'irori-askpass.exe');
    await mkdir(path.dirname(built), { recursive: true });
    await writeFile(built, 'MZ');
    const service = new SshAskpass({ dataDir, windowsClient: built });
    await service.init();
    t.after(() => service.close());
    const session = service.session(async () => 'x')!;
    assert.equal(session.env.SSH_ASKPASS, 'irori-askpass.exe');
    assert.ok(session.env.IRORI_SSH_ASKPASS!.startsWith('\\\\.\\pipe\\irori-ssh-'));
    assert.deepEqual(session.found, {
      searchPath: path.dirname(built),
      cwd: path.join(dataDir, 'ssh'),
    });
  },
);
