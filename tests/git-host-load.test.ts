import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, readdir, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { FileService } from '../src/host/files';
import { GitProcess } from '../src/git/process';
import { GitService } from '../src/git/service';
import { lineKey } from '../src/knowledge/authorship';

function gate() {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release };
}

class CountingGit extends GitProcess {
  calls: string[][] = [];
  pause?: { started: ReturnType<typeof gate>; resume: ReturnType<typeof gate> };
  pauseLog?: { started: ReturnType<typeof gate>; resume: ReturnType<typeof gate> };
  failStatus = false;
  override async run(cwd: string, args: string[], options?: Parameters<GitProcess['run']>[2]) {
    this.calls.push(args);
    if (args[0] === 'status' && this.failStatus) {
      this.failStatus = false;
      throw Error('Temporary status failure');
    }
    const output = await super.run(cwd, args, options);
    if (args[0] === 'status' && this.pause) {
      const pause = this.pause;
      this.pause = undefined;
      pause.started.release();
      await pause.resume.wait;
    }
    if (args[0] === 'log' && this.pauseLog) {
      const pause = this.pauseLog;
      this.pauseLog = undefined;
      pause.started.release();
      await pause.resume.wait;
    }
    return output;
  }
  count(command: string) {
    return this.calls.filter((args) => args[0] === command).length;
  }
}

function git(root: string, ...args: string[]) {
  return execFileSync(
    'git',
    [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd: root, encoding: 'utf8' },
  ).trimEnd();
}

function attach(root: string, line: number) {
  const oid = git(root, 'rev-parse', 'HEAD');
  const text = `note.md\n  h_0123456789abcd ${line}\n---\n${JSON.stringify({
    schema_version: 'authorship/3.0.0',
    base_commit_sha: oid,
    prompts: {},
    humans: { h_0123456789abcd: { author: 'Fixture <fixture@example.invalid>' } },
  })}\n`;
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'notes',
      '--ref=ai',
      'add',
      '-f',
      '-F',
      '-',
      oid,
    ],
    { cwd: root, input: text, stdio: ['pipe', 'pipe', 'pipe'] },
  );
}

async function fixture(t: TestContext) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori-host-git-'));
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const root = path.join(base, 'KB');
  await mkdir(root);
  git(root, 'init', '-b', 'main');
  const space = await files.register(root, 'Fixture', 'personal');
  await writeFile(path.join(root, 'note.md'), 'Original paragraph.\nSecond paragraph.\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'Initial');
  const process = new CountingGit();
  const service = new GitService(files, () => true, undefined, process);
  t.after(async () => {
    await service.close();
    await rm(base, { recursive: true, force: true });
  });
  return { root, space, process, service };
}

test('A simultaneous status burst shares one snapshot; failures remain retryable', async (t) => {
  const { space, process, service } = await fixture(t);
  const results = await Promise.all(
    Array.from({ length: 20 }, () => service.status(space.scopeId)),
  );
  assert.equal(process.count('status'), 1);
  assert.ok(results.every((result) => result.version === results[0].version));
  process.failStatus = true;
  await assert.rejects(service.status(space.scopeId), /Temporary status failure/);
  assert.equal((await service.status(space.scopeId)).available, true);
  assert.equal(process.count('status'), 3);
});

test('Refreshes arriving during a status read get only one follow-up and see the newer worktree', async (t) => {
  const { root, space, process, service } = await fixture(t);
  const pause = { started: gate(), resume: gate() };
  t.after(pause.resume.release);
  process.pause = pause;
  const first = service.status(space.scopeId);
  await pause.started.wait;
  await writeFile(path.join(root, 'note.md'), 'Edited paragraph.\n');
  const rest = Array.from({ length: 20 }, () => service.status(space.scopeId));
  pause.resume.release();
  const results = await Promise.all([first, ...rest]);
  assert.equal(process.count('status'), 2);
  assert.ok(results.every((result) => result.changes.some((change) => change.path === 'note.md')));
});

test('Requests arriving during the follow-up pass do not create further status reads', async (t) => {
  const { space, process, service } = await fixture(t);
  const firstPause = { started: gate(), resume: gate() };
  const secondPause = { started: gate(), resume: gate() };
  t.after(firstPause.resume.release);
  t.after(secondPause.resume.release);
  process.pause = firstPause;
  const first = service.status(space.scopeId);
  await firstPause.started.wait;
  const joined = service.status(space.scopeId);
  process.pause = secondPause;
  firstPause.resume.release();
  await secondPause.started.wait;
  const burst = Array.from({ length: 20 }, () => service.status(space.scopeId));
  secondPause.resume.release();
  await Promise.all([first, joined, ...burst]);
  assert.equal(process.count('status'), 2);
});

test('A status read overlapping a mutation never returns its pre-mutation index', async (t) => {
  const { root, space, process, service } = await fixture(t);
  await writeFile(path.join(root, 'note.md'), 'Edited paragraph.\n');
  const before = await service.status(space.scopeId);
  const diff = await service.diff(space.scopeId, 'note.md', false);
  const pause = { started: gate(), resume: gate() };
  t.after(pause.resume.release);
  process.pause = pause;
  const pending = service.status(space.scopeId);
  await pause.started.wait;
  await service.stage(space.scopeId, 'note.md', true, diff.version);
  const after = service.status(space.scopeId);
  pause.resume.release();
  for (const status of await Promise.all([pending, after])) {
    const change = status.changes.find((change) => change.path === 'note.md')!;
    assert.equal(change.index, 'M');
    assert.equal(change.worktree, ' ');
    assert.notEqual(status.version, before.version);
  }
});

test('Authorship history is coalesced and cached by HEAD, notes ref and path', async (t) => {
  const { root, space, process, service } = await fixture(t);
  attach(root, 1);
  const results = await Promise.all(
    Array.from({ length: 12 }, () => service.noted(space.scopeId, 'note.md')),
  );
  assert.ok(results.every((keys) => keys.has(lineKey('Original paragraph.')!)));
  assert.equal(process.count('log'), 1);
  assert.equal(process.count('cat-file'), 1);
  results[0].clear();
  assert.ok((await service.noted(space.scopeId, 'note.md')).has(lineKey('Original paragraph.')!));
  await writeFile(path.join(root, 'note.md'), 'Working copy edit.\n');
  await service.noted(space.scopeId, 'note.md');
  assert.equal(process.count('log'), 1);
  attach(root, 2);
  assert.deepEqual(
    await service.noted(space.scopeId, 'note.md'),
    new Set([lineKey('Second paragraph.')!]),
  );
  assert.equal(process.count('log'), 2);
  await service.noted(space.scopeId, 'other.md');
  assert.equal(process.count('log'), 3);
  git(root, 'add', 'note.md');
  git(root, 'commit', '-m', 'Changed HEAD');
  await service.noted(space.scopeId, 'note.md');
  assert.equal(process.count('log'), 4);
});

test('An authorship refresh joining a moving notes ref receives the completed revision', async (t) => {
  const { root, space, process, service } = await fixture(t);
  attach(root, 1);
  const pause = { started: gate(), resume: gate() };
  t.after(pause.resume.release);
  process.pauseLog = pause;
  const first = service.noted(space.scopeId, 'note.md');
  await pause.started.wait;
  attach(root, 2);
  const joined = service.noted(space.scopeId, 'note.md');
  pause.resume.release();
  for (const keys of await Promise.all([first, joined]))
    assert.deepEqual(keys, new Set([lineKey('Second paragraph.')!]));
  assert.equal(process.count('log'), 2);
  await service.noted(space.scopeId, 'note.md');
  assert.equal(process.count('log'), 2);
});

test(
  'Git children have a global limit, and close kills active children and rejects queued work',
  { skip: process.platform === 'win32', timeout: 15000 },
  async (t) => {
    const base = await mkdtemp(path.join(tmpdir(), 'irori-git-process-'));
    const command = path.join(base, 'git-fixture');
    await writeFile(
      command,
      `#!/usr/bin/env node
const fs = require('node:fs');
const label = process.argv.at(-1);
fs.writeFileSync('started-' + label, '');
const active = 'active-' + process.pid;
fs.writeFileSync(active, '');
setInterval(() => {
  if (fs.existsSync('release')) {
    fs.unlinkSync(active);
    process.stdout.write('done');
    process.exit(0);
  }
}, 10);
`,
    );
    await chmod(command, 0o700);
    const first = new GitProcess(command),
      second = new GitProcess(command);
    t.after(async () => {
      await first.close();
      await second.close();
      await rm(base, { recursive: true, force: true });
    });
    const calls = [
      ...Array.from({ length: 8 }, (_, index) => first.run(base, [`a${index}`])),
      ...Array.from({ length: 8 }, (_, index) => second.run(base, [`b${index}`])),
    ];
    const settled = Promise.allSettled(calls);
    const waitFor = async (predicate: (names: string[]) => boolean) => {
      for (let i = 0; i < 500; i++) {
        const names = await readdir(base);
        if (predicate(names)) return names;
        await delay(10);
      }
      throw Error('Children did not reach the expected state');
    };
    const started = await waitFor(
      (names) => names.filter((name) => name.startsWith('started-')).length === 4,
    );
    assert.equal(started.filter((name) => name.startsWith('active-')).length, 4);
    await first.close();
    const resumed = await waitFor(
      (names) => names.filter((name) => name.startsWith('started-b')).length === 4,
    );
    assert.equal(resumed.filter((name) => name.startsWith('started-a')).length, 4);
    await assert.rejects(first.run(base, ['closed']), /closed/);
    await writeFile(path.join(base, 'release'), '');
    const results = await settled;
    assert.ok(results.slice(0, 8).every((result) => result.status === 'rejected'));
    assert.ok(
      results.slice(8).every((result) => result.status === 'fulfilled' && result.value === 'done'),
    );
  },
);
