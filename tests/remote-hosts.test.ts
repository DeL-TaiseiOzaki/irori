import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FileService } from '../src/host/files';
import { YourAiService } from '../src/host/you';
import { WorkspaceService } from '../src/host/workspaces';
import { DraftService } from '../src/host/drafts';
import { RemoteHosts } from '../src/host/remote-hosts';
import type { RemoteLauncher, RemotePayload } from '../src/host/remote-link';
import { AgentService } from '../src/agents/service';
import { decode, encode } from '../src/remote/wire';
import {
  remoteHostInput,
  remotePath,
  sentFileName,
  sshDestination,
} from '../src/domain/remote-hosts';
import { brainsCommandPreamble } from '../prompts';
import type { AgentEvent, HostEvent } from '../src/domain/types';

const posixOnly = {
  skip: process.platform === 'win32' && 'the stand-in for an SSH host is a POSIX shell',
  timeout: 60000,
};

/**
 * An SSH host stood in for by this machine with another home folder: each
 * "login" is a shell there, and the vault host runs from source. Nothing is
 * sent anywhere.
 */
async function farHost(t: TestContext) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori remote '));
  const home = path.join(base, 'far home');
  await mkdir(home);
  // "Node" on the far side: this Node, reading TypeScript, as one small program.
  const node = path.join(base, 'node');
  await writeFile(
    node,
    `#!/bin/sh\nexec "${process.execPath}" --import "${pathToFileURL(path.resolve('node_modules/tsx/dist/loader.mjs')).href}" "$@"\n`,
    { mode: 0o700 },
  );
  const bundle = Buffer.from(
    `require(${JSON.stringify(path.resolve('src/remote/vault-host.ts'))});\n`,
  );
  const payload: RemotePayload = {
    bundle: async () => ({
      version: createHash('sha256').update(bundle).digest('hex').slice(0, 16),
      bytes: bundle,
    }),
    nodeVersion: 'test',
    node: async () => ({ binary: node }),
  };
  // The stand-in CLI, found on the far side's PATH as an installed one would be.
  const bin = path.join(base, 'bin');
  await mkdir(bin);
  await writeFile(
    path.join(bin, 'pi'),
    `#!/usr/bin/env node\nimport(${JSON.stringify(pathToFileURL(path.resolve('tests/fixtures/harnesses.mjs')).href)}).then(m=>m.run('pi'));\n`,
    { mode: 0o700 },
  );
  const previous = process.env.PATH;
  process.env.PATH = bin + path.delimiter + previous;
  const logins: ChildProcess[] = [];
  const launcher: RemoteLauncher = {
    run: (command) => {
      const child = spawn('sh', ['-c', command], {
        env: { ...process.env, HOME: home, IRORI_VAULT_HOST_IDLE_MS: '1500' },
        stdio: 'pipe',
      });
      logins.push(child);
      return child;
    },
  };
  t.after(async () => {
    process.env.PATH = previous;
    // The vault host ends by itself once idle; it is not left to outlive the test.
    const pid = await readFile(path.join(home, '.irori-host/data/host.pid'), 'utf8').catch(
      () => '',
    );
    if (pid)
      try {
        process.kill(Number(pid), 'SIGTERM');
      } catch {
        // Already gone.
      }
    await new Promise((resolve) => setTimeout(resolve, 300));
    await rm(base, { recursive: true, force: true });
  });
  // A vault that exists only there.
  const code = path.join(home, 'projects', 'Code');
  await mkdir(path.join(code, 'notes'), { recursive: true });
  await writeFile(path.join(code, 'AGENTS.md'), '# Code vault\n');
  await writeFile(
    path.join(code, 'notes', 'train.md'),
    '# Training\n\nThe run uses the zebrafinch-42 seed.\n',
  );
  return { base, home, code, payload, launcher, logins };
}

async function hub(t: TestContext, far: Awaited<ReturnType<typeof farHost>>) {
  const dataDir = path.join(far.base, 'device');
  const files = new FileService(dataDir);
  await files.init();
  const events: HostEvent[] = [];
  const asked: string[] = [];
  const remote = new RemoteHosts({
    dataDir,
    launcher: () => far.launcher,
    payload: far.payload,
    language: () => 'en',
    localScopes: () => files.list().map((space) => space.scopeId),
    emit: (event) => events.push(event),
    ask: async (_host, question) => {
      asked.push(question);
      return true;
    },
  });
  await remote.init();
  t.after(() => remote.close());
  const host = await remote.saveHost({ name: 'box', destination: 'box' });
  return { dataDir, files, remote, host, events, asked };
}

const until = async <T>(get: () => T | undefined | false, ms = 20000) => {
  const end = Date.now() + ms;
  for (;;) {
    const value = get();
    if (value) return value;
    if (Date.now() > end) throw Error('Timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

test('bytes cross as base64 and come back as bytes', () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 255]);
  const frame = decode(encode({ id: 1, method: 'sendFile', args: ['a', Buffer.from(bytes)] }));
  assert.ok('args' in frame);
  assert.ok(frame.args[1] instanceof Uint8Array);
  assert.deepEqual([...(frame.args[1] as Uint8Array)], [...bytes]);
});

test('an SSH destination is one argument that cannot be read as an option', () => {
  for (const good of ['gpu1', 'me@gpu1.example.com', 'me@[::1]', 'box_2'])
    assert.equal(sshDestination.safeParse(good).success, true, good);
  for (const bad of ['-oProxyCommand=x', 'a b', 'a;b', '$(x)', '', 'a\nb', "a'b"])
    assert.equal(sshDestination.safeParse(bad).success, false, bad);
  assert.equal(remotePath.safeParse('/home/me/x y').success, true);
  assert.equal(remotePath.safeParse('relative').success, false);
  assert.equal(sentFileName.safeParse('../x').success, false);
  assert.equal(sentFileName.safeParse('note.md').success, true);
  assert.equal(
    remoteHostInput.safeParse({ name: 'a', destination: 'b', port: 70000 }).success,
    false,
  );
});

test('the irori agent is told where a vault on an SSH host is and how to reach it', () => {
  const text = brainsCommandPreamble([
    { name: 'Notes', agent: 'vault-notes', root: '/here/notes' },
    { name: 'Code', agent: 'vault-code', root: '/home/me/code', host: 'gpu1' },
  ]);
  assert.match(text, /- Notes: folder "\/here\/notes", vault agent "vault-notes"/);
  assert.match(
    text,
    /- Code: on the SSH host "gpu1", folder "\/home\/me\/code" there, vault agent "vault-code"/,
  );
  assert.match(text, /irori ls <vault>/);
  assert.match(text, /irori send <vault> <file>/);
  // Nothing about SSH hosts when none is handed.
  assert.doesNotMatch(
    brainsCommandPreamble([{ name: 'Notes', agent: 'vault-notes', root: '/here/notes' }]),
    /SSH host/,
  );
});

test(
  'a vault on a host is installed for, registered, read and searched from this device',
  posixOnly,
  async (t) => {
    const far = await farHost(t);
    const { remote, host, events, dataDir } = await hub(t, far);
    assert.equal(remote.hosts()[0].state, 'offline');
    const connected = await remote.connect(host.id);
    assert.equal(connected.state, 'connected');
    assert.equal(connected.about?.home, far.home);
    // What was sent is under one folder of the far home, readable by its user alone.
    assert.deepEqual((await readdir(path.join(far.home, '.irori-host'))).sort(), [
      'bin',
      'data',
      'node',
    ]);
    const folders = await remote.folders(host.id, path.join(far.home, 'projects'));
    assert.deepEqual(
      folders.folders.map((folder) => folder.name),
      ['Code'],
    );
    assert.equal(folders.parent, far.home);
    const vault = await remote.register(host.id, far.code, 'Code', 'team');
    assert.equal(vault.host.name, 'box');
    assert.equal(vault.root, far.code);
    assert.ok(remote.has(vault.scopeId));
    assert.ok(events.some((event) => event.type === 'vaults'));
    // The folder now says it is a vault, as one registered on this device would.
    assert.equal((await remote.folders(host.id, path.dirname(far.code))).folders[0].vault, true);
    const entries = await remote.entries(vault.scopeId, '');
    assert.ok(entries.some((entry) => entry.path === 'notes' && entry.directory));
    assert.match((await remote.read(vault.scopeId, 'notes/train.md')).text, /zebrafinch-42/);
    assert.equal(
      (await remote.search(vault.scopeId, 'zebrafinch')).hits[0]?.path,
      'notes/train.md',
    );
    // A change made there reaches this device as the vault's own event.
    const before = events.length;
    await writeFile(path.join(far.code, 'notes', 'new.md'), 'made there\n');
    await until(() =>
      events
        .slice(before)
        .some((event) => event.type === 'files' && event.scopeId === vault.scopeId),
    );
    // A path outside the vault is refused there, as it is here.
    await assert.rejects(remote.read(vault.scopeId, '../../outside.md'));
    // This device remembers the vault without the host: it is listed after a restart.
    const again = new RemoteHosts({
      dataDir,
      launcher: () => far.launcher,
      payload: far.payload,
      language: () => 'en',
      localScopes: () => [],
      emit: () => {},
      ask: async () => false,
    });
    await again.init();
    assert.deepEqual(
      again.list().map((item) => [item.name, item.host.name]),
      [['Code', 'box']],
    );
    assert.equal(again.hosts()[0].state, 'offline');
    // A workspace holds it beside vaults of this device, and its drafts are kept here.
    const files = new FileService(dataDir);
    await files.init();
    const workspaces = new WorkspaceService(files);
    await assert.rejects(workspaces.save('Mixed', [vault.scopeId]));
    workspaces.elsewhere = (scopeId) => remote.has(scopeId);
    assert.deepEqual((await workspaces.save('Mixed', [vault.scopeId])).scopeIds, [vault.scopeId]);
    const drafts = new DraftService(files);
    drafts.elsewhere = (scopeId) =>
      remote.has(scopeId) ? `ssh:${host.id}:${vault.root}` : undefined;
    const key = { scopeId: vault.scopeId, kind: 'composer', agent: 'pi' } as const;
    const written = await drafts.write(key, { text: 'ask later' }, null);
    assert.equal((await drafts.read(key))?.revision, written.revision);
    // Off this device's list: the folder there stays as it is.
    await remote.unregister(vault.scopeId);
    assert.equal(remote.has(vault.scopeId), false);
    assert.match(await readFile(path.join(far.code, 'notes', 'train.md'), 'utf8'), /zebrafinch/);
    await assert.rejects(remote.removeHost('00000000-0000-4000-8000-000000000000'));
    await remote.removeHost(host.id);
    assert.deepEqual(remote.hosts(), []);
  },
);

test('a vault is registered in one place only', posixOnly, async (t) => {
  const far = await farHost(t);
  const { remote, host, files } = await hub(t, far);
  // The same vault on this device: a copy of the folder, with the same identity.
  const first = await remote.register(host.id, far.code, 'Code', 'team');
  await remote.unregister(first.scopeId);
  const here = path.join(far.base, 'Code here');
  await cp(far.code, here, { recursive: true });
  const local = await files.register(here, 'Code', 'team');
  assert.equal(local.scopeId, first.scopeId);
  await assert.rejects(remote.register(host.id, far.code, 'Code', 'team'), /1 か所だけ/);
  assert.equal(remote.has(first.scopeId), false);
  // Nothing was left registered on the host by the refused attempt.
  assert.deepEqual(
    JSON.parse(await readFile(path.join(far.home, '.irori-host/data/spaces.json'), 'utf8')),
    [],
  );
  await files.unregister(local.scopeId);
  assert.equal((await remote.register(host.id, far.code, 'Code', 'team')).scopeId, first.scopeId);
});

async function handing(t: TestContext) {
  const far = await farHost(t);
  const made = await hub(t, far);
  const { remote, host, files, dataDir } = made;
  const vault = await remote.register(host.id, far.code, 'Code', 'team');
  const youHome = path.join(far.base, 'home');
  await mkdir(youHome);
  const you = new YourAiService(dataDir, youHome);
  const { id, root } = await you.create();
  const notesRoot = path.join(far.base, 'Notes');
  await mkdir(path.join(notesRoot, 'eval'), { recursive: true });
  await writeFile(
    path.join(notesRoot, 'eval', 'method.md'),
    '# Method\n\nScore with the heron-7 rubric.\n',
  );
  const notes = await files.register(notesRoot, 'Notes', 'personal');
  const events: AgentEvent[] = [];
  const waiting = new Map<string, () => void>();
  const service = new AgentService(
    files,
    (event) => {
      events.push(event);
      if (event.type === 'done') waiting.get(event.runId)?.();
    },
    undefined,
    undefined,
    you,
  );
  service.remote = remote;
  t.after(() => service.cancel());
  const run = async (prompt: string) => {
    const runId = await service.startAccepted({
      scopeId: id,
      agent: 'pi',
      prompt,
      brains: [notes.scopeId, vault.scopeId],
    });
    const done = new Promise<void>((resolve) => waiting.set(runId, resolve));
    return { runId, done, mine: () => events.filter((event) => event.runId === runId) };
  };
  const log = async (folder: string) =>
    (await readFile(path.join(folder, 'fixture-requests.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
  return { ...made, far, vault, notes, root, service, events, run, log };
}

test(
  'the irori agent hands a task to the agent of a vault on a host, which works there (protocol fixture)',
  posixOnly,
  async (t) => {
    const { far, vault, root, run, log } = await handing(t);
    const { done, mine } = await run(
      'Hand over.\nrun: irori call vault-code "run: pwd && echo made-there > made.txt"',
    );
    await done;
    assert.equal(mine().at(-1)?.outcome, 'completed', JSON.stringify(mine()));
    // The irori agent was told the vault is on the host, not at a path here.
    const prompt = (await log(root)).find((call) => call.type === 'prompt').message as string;
    assert.match(prompt, /- Code \(.*\): on the SSH host "box", folder ".*Code" there/);
    // The vault's agent ran in the vault, on the far side, on the handed task.
    const handed = (await log(far.code)).find((call) => call.type === 'prompt').message as string;
    assert.match(handed, /irori: the irori agent handed you this task\./);
    assert.equal((await readFile(path.join(far.code, 'made.txt'), 'utf8')).trim(), 'made-there');
    const command = (await log(root)).find((call) => call.type === 'command');
    assert.equal(command.code, 0, command.stderr);
    assert.match(
      command.stdout,
      new RegExp(`${far.code.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
    );
    // The irori agent's log follows it as a task of that vault.
    const started = mine().find((event) => event.delegate?.state === 'started');
    assert.equal(started?.delegate?.scopeId, vault.scopeId);
    assert.ok(mine().some((event) => event.delegate?.state === 'reported'));
    // The hand-off is one conversation of the vault, kept on the host.
    const kept = await readdir(path.join(far.home, '.irori-host/data/conversations'));
    assert.equal(kept.length, 1);
  },
);

test(
  'the irori agent reads a vault on a host on demand and sends it a file (protocol fixture)',
  posixOnly,
  async (t) => {
    const { far, root, notes, run, log } = await handing(t);
    const commands = async (prompt: string) => {
      const before = (await log(root).catch(() => [])).length;
      const { done } = await run(prompt);
      await done;
      return (await log(root)).slice(before).find((call) => call.type === 'command');
    };
    const listed = await commands('run: irori ls Code notes');
    assert.equal(listed.stdout.trim(), 'notes/train.md');
    const read = await commands('run: irori read Code notes/train.md');
    assert.match(read.stdout, /zebrafinch-42/);
    // A path written from the vault's folder there is the same file.
    const absolute = await commands(`run: irori read Code "${far.code}/notes/train.md"`);
    assert.match(absolute.stdout, /zebrafinch-42/);
    const found = await commands('run: irori search Code zebrafinch');
    assert.match(found.stdout, /^notes\/train\.md:3: /);
    // A file of a vault on this device goes into the far vault's work folder.
    const sent = await commands(`run: irori send Code "${notes.root}/eval/method.md"`);
    assert.equal(sent.code, 0, sent.stderr);
    assert.match(sent.stdout, /Sent to the Code vault on box: contents\/work\/method\.md/);
    assert.match(
      await readFile(path.join(far.code, 'contents', 'work', 'method.md'), 'utf8'),
      /heron-7/,
    );
    // Sent again, it does not replace the first.
    const again = await commands(`run: irori send Code "${notes.root}/eval/method.md"`);
    assert.match(again.stdout, /contents\/work\/method 2\.md/);
    // Only what the irori agent may already read is sent.
    const outside = path.join(far.base, 'secret.txt');
    await writeFile(outside, 'not for the host\n');
    const refused = await commands(`run: irori send Code "${outside}"`);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /from your folder or from a vault on this device/);
    // A vault on this device is read where it is.
    const local = await commands('run: irori read Notes eval/method.md');
    assert.equal(local.code, 1);
    assert.match(local.stderr, /is on this computer/);
  },
);

test(
  'a hand-off goes on while the connection is cut, and its report is collected after it returns (protocol fixture)',
  posixOnly,
  async (t) => {
    const { far, run, remote, host } = await handing(t);
    const { done, mine } = await run(
      'Hand over.\nrun: irori call vault-code "run: sleep 2 && echo survived > survived.txt && echo finished-there"',
    );
    await until(() => mine().some((event) => event.delegate?.state === 'started'));
    await new Promise((resolve) => setTimeout(resolve, 500));
    // The connection drops: the login is killed, as a lost network would end it.
    for (const login of far.logins) login.kill('SIGKILL');
    await until(() => remote.hosts()[0].state !== 'connected');
    await done;
    assert.equal(mine().at(-1)?.outcome, 'completed', JSON.stringify(mine()));
    const reported = mine().find((event) => event.delegate?.state === 'reported');
    assert.match(reported?.text ?? '', /finished-there/);
    assert.equal((await readFile(path.join(far.code, 'survived.txt'), 'utf8')).trim(), 'survived');
    assert.equal(remote.hosts().find((item) => item.id === host.id)?.state, 'connected');
  },
);

// A real SSH host, when one is named: `IRORI_TEST_SSH=<destination> npm test` after
// `npm run build`. It must be a disposable Linux machine that `ssh <destination>`
// reaches without a prompt. The test leaves irori's own files (~/.irori-host) there
// and removes the one folder it makes.
const sshTarget = process.env.IRORI_TEST_SSH;
test(
  'over real ssh, the vault host is installed with the official Node, serves a vault and outlives the connection',
  {
    skip: !sshTarget && 'set IRORI_TEST_SSH to the ssh destination of a disposable Linux host',
    timeout: 900000,
  },
  async (t) => {
    const { execFileSync } = await import('node:child_process');
    const { randomUUID } = await import('node:crypto');
    const { sshLauncher, shippedPayload } = await import('../src/host/remote-payload');
    const far = (script: string) =>
      execFileSync('ssh', ['-T', '-o', 'BatchMode=yes', '--', sshTarget!, script], {
        encoding: 'utf8',
      });
    const base = await mkdtemp(path.join(tmpdir(), 'irori ssh '));
    const folder = `irori-ssh-test-${randomUUID().slice(0, 8)}`;
    const home = far('printf %s "$HOME"');
    far(`mkdir -p ~/${folder}/notes && printf '# Far\\n\\nlapwing-9\\n' > ~/${folder}/notes/a.md`);
    t.after(async () => {
      far(`rm -rf ~/${folder}`);
      await rm(base, { recursive: true, force: true });
    });
    const progress: string[] = [];
    const remote = new RemoteHosts({
      dataDir: path.join(base, 'device'),
      launcher: sshLauncher,
      payload: shippedPayload({
        dataDir: path.join(base, 'device'),
        bundle: path.resolve('dist-host/vault-host.cjs'),
        packaged: false,
      }),
      language: () => 'en',
      localScopes: () => [],
      emit: (event) => {
        if (event.type !== 'hosts') return;
        const detail = remote.hosts()[0]?.detail;
        if (detail && progress.at(-1) !== detail) progress.push(detail);
      },
      ask: async () => true,
    });
    await remote.init();
    const host = await remote.saveHost({ name: 'far', destination: sshTarget! });
    const connected = await remote.connect(host.id);
    assert.equal(connected.state, 'connected', progress.join(' | '));
    assert.equal(connected.about?.home, home);
    assert.equal(connected.about?.platform, 'linux');
    const vault = await remote.register(host.id, `${home}/${folder}`, 'Far', 'team');
    assert.match((await remote.read(vault.scopeId, 'notes/a.md')).text, /lapwing-9/);
    assert.equal((await remote.search(vault.scopeId, 'lapwing')).hits[0]?.path, 'notes/a.md');
    const sent = await remote.send(
      vault.scopeId,
      'from here.txt',
      new TextEncoder().encode('hi\n'),
    );
    assert.equal(sent, 'contents/work/from here.txt');
    assert.equal(far(`cat ~/${folder}/contents/work/'from here.txt'`), 'hi\n');
    // The connection ends; the vault host does not, and the next connection finds it.
    const pid = far('cat ~/.irori-host/data/host.pid').trim();
    remote.close();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.equal(far(`kill -0 ${pid} && echo alive`).trim(), 'alive');
    const again = new RemoteHosts({
      dataDir: path.join(base, 'device'),
      launcher: sshLauncher,
      payload: shippedPayload({
        dataDir: path.join(base, 'device'),
        bundle: path.resolve('dist-host/vault-host.cjs'),
        packaged: false,
      }),
      language: () => 'en',
      localScopes: () => [],
      emit: () => {},
      ask: async () => true,
    });
    await again.init();
    t.after(() => again.close());
    assert.equal((await again.connect(host.id)).state, 'connected');
    assert.equal(far('cat ~/.irori-host/data/host.pid').trim(), pid);
    assert.match((await again.read(vault.scopeId, 'notes/a.md')).text, /lapwing-9/);
    await again.unregister(vault.scopeId);
    console.log(`  steps shown while connecting: ${progress.join(' | ')}`);
  },
);
