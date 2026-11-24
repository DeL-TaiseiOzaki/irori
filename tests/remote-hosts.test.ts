import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
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
import type { Conversation, ConversationSummary } from '../src/domain/conversation';
import { AttachmentStore } from '../src/agents/attachments';
import { sshTerminalArgs } from '../src/host/remote-payload';
import { AgentSetup } from '../src/host/agent-setup';

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
  // While `down`, every login fails as `ssh` does when the host cannot be reached.
  const network = { down: false };
  const launcher: RemoteLauncher = {
    run: (command) => {
      const child = spawn('sh', ['-c', network.down ? 'exit 255' : command], {
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
  return { base, home, code, payload, launcher, logins, network };
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

const until = async <T>(
  get: () => T | undefined | false | Promise<T | undefined | false>,
  ms = 20000,
) => {
  const end = Date.now() + ms;
  for (;;) {
    const value = await get();
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
    // Installed and started in the login that found nothing there: one sign-in, not four.
    assert.equal(far.logins.length, 1);
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

test(
  'the irori agent finds, adds, creates and clones vaults on an SSH host with --host',
  posixOnly,
  async (t) => {
    const far = await farHost(t);
    // Git on the far side signs commits as a fixture and clones octo/kb from a folder.
    const seed = path.join(far.base, 'seed');
    const bare = path.join(far.base, 'kb.git');
    const global = path.join(far.base, 'gitconfig');
    await writeFile(
      global,
      `[user]\n\tname = Git fixture\n\temail = fixture@example.invalid\n[commit]\n\tgpgsign = false\n` +
        `[init]\n\tdefaultBranch = main\n[url "${bare}"]\n\tinsteadOf = https://github.com/octo/kb.git\n`,
    );
    const previous = process.env.GIT_CONFIG_GLOBAL;
    process.env.GIT_CONFIG_GLOBAL = global;
    t.after(() => {
      if (previous === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = previous;
    });
    const git = (cwd: string, ...args: string[]) =>
      spawnSync('git', args, { cwd, encoding: 'utf8' }).stdout;
    await mkdir(seed);
    git(seed, 'init', '-q');
    await writeFile(path.join(seed, 'README.md'), '# KB\n');
    git(seed, 'add', '.');
    git(seed, 'commit', '-qm', 'seed');
    git(far.base, 'clone', '-q', '--bare', seed, bare);

    const { remote, files, dataDir } = await hub(t, far);
    const workspaces = new WorkspaceService(files);
    workspaces.elsewhere = (scopeId) => remote.has(scopeId);
    const work = await workspaces.save('Work', []);
    const context = { workspaceId: work.id };
    const setup = new AgentSetup({
      files,
      git: {} as never,
      workspaces,
      cloud: { connections: async () => [] } as never,
      defaultParent: async () => path.join(dataDir, 'vaults'),
      remote,
    });

    // The hosts, and the folders of one, to find what to add.
    assert.match(await setup.run(['hosts'], far.base), /- box: box, offline; no vaults yet/);
    const listed = await setup.run(['hosts', 'box', 'projects'], far.base);
    assert.match(
      listed,
      new RegExp(
        `Folders in ${JSON.stringify(path.join(far.home, 'projects')).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
      ),
    );
    assert.match(listed, /^- Code$/m);
    await assert.rejects(
      setup.run(['hosts', 'nowhere'], far.base),
      /No SSH host is named "nowhere"/,
    );
    await assert.rejects(
      setup.run(['add', 'projects/Code', '--host', 'nowhere'], far.base),
      /SSH ホスト/,
    );

    // An existing folder there, from the host's home; adding it again only joins.
    const added = await setup.run(['add', '~/projects/Code', '--host', 'box'], far.base, context);
    assert.match(added, /^Registered the vault "Code" at ".*" on the SSH host "box"\./);
    assert.match(added, /Added it to this workspace/);
    const code = remote.list().find((vault) => vault.name === 'Code')!;
    assert.equal(code.root, far.code);
    assert.match(
      await setup.run(['add', far.code, '--host', 'box'], far.base, context),
      /^Already a vault "Code"[\s\S]*already in this workspace/,
    );

    // A new vault there: a Git repository on main with its first commit, in the host's home.
    const created = await setup.run(
      ['create', 'Lab', '--host', 'box', '--layers', 'schema,contents'],
      far.base,
      context,
    );
    assert.match(created, /^Registered the vault "Lab" at ".*" on the SSH host "box"\./);
    const lab = remote.list().find((vault) => vault.name === 'Lab')!;
    assert.equal(lab.root, path.join(far.home, 'Lab'));
    assert.deepEqual(lab.layers, ['contents']);
    assert.match(git(lab.root, 'log', '--format=%s'), /Lab/);
    assert.equal(git(lab.root, 'branch', '--show-current').trim(), 'main');
    await assert.rejects(
      setup.run(['create', 'Lab', '--host', 'box'], far.base, context),
      /already exists|同じ名前/,
    );

    // A clone there, into a folder under the home named by --parent.
    const cloned = await setup.run(
      ['clone', 'octo/kb', '--host', 'box', '--parent', 'projects', '--name', 'Team KB'],
      far.base,
      context,
    );
    assert.match(
      cloned,
      /^Registered the vault "Team KB" at ".*" on the SSH host "box" \(GitHub octo\/kb\)\./,
    );
    const kb = remote.list().find((vault) => vault.name === 'Team KB')!;
    assert.equal(kb.root, path.join(far.home, 'projects', 'kb'));
    assert.equal(await readFile(path.join(kb.root, 'README.md'), 'utf8'), '# KB\n');

    // All three are in the workspace, and the list and hosts name them with their host.
    assert.deepEqual((await workspaces.list())[0].scopeIds, [
      code.scopeId,
      lab.scopeId,
      kb.scopeId,
    ]);
    const list = await setup.run(['list'], far.base, context);
    assert.match(
      list,
      /Vaults on SSH hosts:\n- Code: folder ".*" on the SSH host "box", in this workspace/,
    );
    assert.match(list, /- Work: Code, Lab, Team KB/);
    assert.match(
      await setup.run(['hosts'], far.base),
      /- box: box, connected; vaults Code, Lab, Team KB/,
    );

    // A vault agent cannot make vaults, here or there.
    await assert.rejects(
      setup.run(['create', 'Other', '--host', 'box'], far.base, { vault: code.scopeId }),
      /irori agent's/,
    );
  },
);

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
  return { ...made, far, vault, notes, id, root, service, events, run, log };
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
      'Hand over.\nrun: irori call vault-code "run: touch began && sleep 2 && echo survived > survived.txt && echo finished-there"',
    );
    // The agent there has begun, and has two seconds of work left.
    const { existsSync } = await import('node:fs');
    await until(() => existsSync(path.join(far.code, 'began')));
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

test(
  'a report waits on the host for the device that handed the task, however long it is away (protocol fixture)',
  posixOnly,
  async (t) => {
    const { far, run, remote } = await handing(t);
    const alive = async () => {
      const pid = await readFile(path.join(far.home, '.irori-host/data/host.pid'), 'utf8').catch(
        () => '',
      );
      try {
        return !!pid && process.kill(Number(pid), 0);
      } catch {
        return false;
      }
    };
    const { done, mine } = await run(
      'Hand over.\nrun: irori call vault-code "run: touch began && sleep 1 && echo late-report"',
    );
    const { existsSync } = await import('node:fs');
    await until(() => existsSync(path.join(far.code, 'began')));
    // The host cannot be reached for well over the time a vault host stays idle
    // (1.5 s here); the run ends meanwhile, with nobody attached to hear it.
    far.network.down = true;
    for (const login of far.logins) login.kill('SIGKILL');
    await new Promise((resolve) => setTimeout(resolve, 5000));
    assert.equal(await alive(), true, 'the vault host stays while a report waits');
    far.network.down = false;
    await done;
    assert.equal(mine().at(-1)?.outcome, 'completed', JSON.stringify(mine()));
    assert.match(
      mine().find((event) => event.delegate?.state === 'reported')?.text ?? '',
      /late-report/,
    );
    // Collected, with nothing running and no device attached, it ends by itself.
    remote.close();
    const gone = await until(async () => !(await alive()), 15000).then(
      () => true,
      () => false,
    );
    assert.equal(gone || !(await alive()), true);
  },
);

test(
  'stopping the irori agent stops its hand-off on the host (protocol fixture)',
  posixOnly,
  async (t) => {
    const { far, service, run, id } = await handing(t);
    const { done, mine } = await run(
      'Hand over.\nrun: irori call vault-code "run: sleep 30 && echo late > late.txt"',
    );
    await until(() => mine().some((event) => event.delegate?.state === 'working'));
    await service.cancel(id);
    await done;
    assert.equal(mine().at(-1)?.outcome, 'cancelled');
    // The run there ended with it: nothing is left working, and the file never comes.
    const vaultHost = (
      await readFile(path.join(far.home, '.irori-host/data/host.pid'), 'utf8')
    ).trim();
    const { execFileSync } = await import('node:child_process');
    await until(() => {
      const left = execFileSync('sh', ['-c', 'pgrep -f "[s]leep 30" || true'], {
        encoding: 'utf8',
      });
      return !left.trim();
    });
    assert.ok(vaultHost);
    await assert.rejects(readFile(path.join(far.code, 'late.txt')));
  },
);

test(
  'what an agent on a host asks is answered on this device: its configuration, and a permission (protocol fixture)',
  posixOnly,
  async (t) => {
    const far = await farHost(t);
    const { remote, host, files, dataDir, asked } = await hub(t, far);
    // The stand-in `claude` plays the irori agent here and the vault's agent there.
    const bin = path.join(far.base, 'bin');
    await writeFile(
      path.join(bin, 'claude'),
      `#!/usr/bin/env node\nimport(${JSON.stringify(pathToFileURL(path.resolve('tests/fixtures/claude-your-ai.mjs')).href)}).then(m=>m.run());\n`,
      { mode: 0o700 },
    );
    // The far vault's own settings run a hook without asking: the person is asked first.
    await mkdir(path.join(far.code, '.claude'), { recursive: true });
    await writeFile(
      path.join(far.code, '.claude', 'settings.json'),
      JSON.stringify({
        hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'true' }] }] },
      }),
    );
    const vault = await remote.register(host.id, far.code, 'Code', 'team');
    const youHome = path.join(far.base, 'home');
    await mkdir(youHome);
    const you = new YourAiService(dataDir, youHome);
    const { id } = await you.create();
    const events: AgentEvent[] = [];
    let finished!: () => void;
    const done = new Promise<void>((resolve) => {
      finished = resolve;
    });
    const answered = new Set<string>();
    const service = new AgentService(
      files,
      (event) => {
        events.push(event);
        if (event.type === 'permission' && !answered.has(event.requestId!)) {
          answered.add(event.requestId!);
          setTimeout(() => void service.respond(event.requestId!, true), 0);
        }
        if (event.type === 'done' && event.scopeId === id) finished();
      },
      undefined,
      undefined,
      you,
    );
    service.remote = remote;
    t.after(() => service.cancel());
    await service.startAccepted({
      scopeId: id,
      agent: 'claude',
      prompt: 'Hand a note over.',
      brains: [vault.scopeId],
    });
    await done;
    assert.equal(events.at(-1)?.outcome, 'completed', JSON.stringify(events.slice(-6)));
    // The host asked this device before its CLI ran the vault's own hooks.
    assert.deepEqual(asked, ['approveConfig']);
    // The vault agent's request to write showed in the irori agent's conversation,
    // labelled with the vault, and the answer reached the run on the host.
    const request = events.find((event) => event.type === 'permission');
    assert.equal(request?.scopeId, id);
    assert.equal(request?.delegate?.scopeId, vault.scopeId);
    assert.ok(
      events.some((event) => event.type === 'status' && event.resolved === request?.requestId),
    );
    assert.equal(
      await readFile(path.join(far.code, 'Knowledge_Base', 'from-your-ai.md'), 'utf8'),
      '# From your AI\n',
    );
    const reported = events.find((event) => event.delegate?.state === 'reported');
    assert.match(reported?.text ?? '', /Wrote Knowledge_Base\/from-your-ai\.md/);
  },
);

test(
  'a vault host of another version gives way once nothing runs on it, and not before (protocol fixture)',
  posixOnly,
  async (t) => {
    const { far, remote, host, vault, run, dataDir } = await handing(t);
    const pidFile = path.join(far.home, '.irori-host/data/host.pid');
    const first = (await readFile(pidFile, 'utf8')).trim();
    // The same device after an update: its vault host is another file, so another version.
    const newer = Buffer.from(
      `// a later build\nrequire(${JSON.stringify(path.resolve('src/remote/vault-host.ts'))});\n`,
    );
    const updated = () =>
      new RemoteHosts({
        dataDir,
        launcher: () => far.launcher,
        payload: {
          ...far.payload,
          bundle: async () => ({
            version: createHash('sha256').update(newer).digest('hex').slice(0, 16),
            bytes: newer,
          }),
        },
        language: () => 'en',
        localScopes: () => [],
        emit: () => {},
        ask: async () => true,
      });
    // While an agent works there, the running vault host stays and the newer one waits.
    const { done, mine } = await run(
      'Hand over.\nrun: irori call vault-code "run: until [ -f go ]; do sleep 0.2; done; echo kept"',
    );
    await until(() => mine().some((event) => event.delegate?.state === 'working'));
    const early = updated();
    await early.init();
    t.after(() => early.close());
    await assert.rejects(early.connect(host.id), /別のバージョン/);
    assert.equal((await readFile(pidFile, 'utf8')).trim(), first);
    // The agent there is let finish only now, however long the attempt took.
    await writeFile(path.join(far.code, 'go'), '');
    // The refused attempt took the device's place; the hand-off's report is still collected.
    await done;
    assert.match(mine().find((event) => event.delegate?.state === 'reported')?.text ?? '', /kept/);
    // With nothing running, the older one ends and the newer one serves the same vaults.
    remote.close();
    const later = updated();
    await later.init();
    t.after(() => later.close());
    const before = far.logins.length;
    assert.equal((await later.connect(host.id)).state, 'connected');
    // The newer bundle was sent and the older vault host gave way within one login.
    assert.equal(far.logins.length - before, 1);
    assert.notEqual((await readFile(pidFile, 'utf8')).trim(), first);
    assert.match((await later.read(vault.scopeId, 'notes/train.md')).text, /zebrafinch-42/);
    assert.equal((await readdir(path.join(far.home, '.irori-host/bin'))).length, 2);
  },
);

// What `ssh` asks while it signs in, answered here (ADR 061, amended): the system's
// own `ssh` against a server of this test's that asks for a password and a
// verification code, as a host with two-step sign-in does. The commands of a login
// run in a shell of this machine with another home folder, as in `farHost`.
const haveSsh = spawnSync('ssh', ['-V']).status === 0;
const asksOnly = {
  skip:
    (process.platform === 'win32' && 'the stand-in for an SSH host is a POSIX shell') ||
    (!haveSsh && 'no ssh on this computer'),
  timeout: 120000,
};
async function asking(t: TestContext, asks: { prompt: string; answer: string }[]) {
  const { sshServer } = await import('./fixtures/ssh-server');
  const { SshAskpass } = await import('../src/host/ssh-askpass');
  const { sshLauncher } = await import('../src/host/remote-payload');
  const far = await farHost(t);
  const server = await sshServer({ asks, home: far.home });
  const dataDir = path.join(far.base, 'device');
  await mkdir(dataDir, { recursive: true });
  // This test's own configuration: the person's known hosts are neither read nor written.
  const config = path.join(far.base, 'ssh_config');
  await writeFile(
    config,
    `Host *\n  UserKnownHostsFile "${path.join(far.base, 'known_hosts')}"\n  GlobalKnownHostsFile /dev/null\n  StrictHostKeyChecking ask\n  IdentitiesOnly yes\n  IdentityFile /dev/null\n  PreferredAuthentications keyboard-interactive\n`,
  );
  const askpass = new SshAskpass({ dataDir, runtime: process.execPath });
  await askpass.init();
  const events: HostEvent[] = [];
  const hosts = (logins: boolean) =>
    new RemoteHosts({
      dataDir,
      launcher: (host, session) => sshLauncher(host, session, ['-F', config]),
      ...(logins && { logins: askpass }),
      payload: far.payload,
      language: () => 'en',
      localScopes: () => [],
      emit: (event) => events.push(event),
      ask: async () => true,
    });
  const remote = hosts(true);
  await remote.init();
  // In this order: a login still asking is ended by its hosts, before what it talks to goes.
  t.after(async () => {
    remote.close();
    await askpass.close();
    await server.close();
  });
  const host = await remote.saveHost({
    name: 'asks',
    destination: 'tester@127.0.0.1',
    port: server.port,
  });
  /** The next question `ssh` asks, once it shows. */
  const question = () => until(() => remote.hosts()[0].asking);
  return { far, server, remote, host, hosts, question, events };
}

test(
  "a host's key, a password and a verification code are asked here and answered once: one login",
  asksOnly,
  async (t) => {
    const { server, remote, host, question, far } = await asking(t, [
      { prompt: 'Password: ', answer: 'correct horse' },
      { prompt: 'Verification code: ', answer: '424242' },
    ]);
    const connecting = remote.connect(host.id);
    // A host never seen: ssh's own question, with the fingerprint, to say yes or no to.
    const key = await question();
    assert.equal(key.kind, 'confirm');
    assert.match(key.text, /fingerprint is:? SHA256:/);
    assert.match(key.text, /\(yes\/no\/\[fingerprint\]\)\?$/);
    assert.equal(remote.hosts()[0].state, 'connecting');
    remote.answer(host.id, key.id, 'yes');
    // A wrong password: ssh asks again in the same words, and the question says so.
    const first = await question();
    assert.deepEqual(
      [first.kind, first.text, first.again],
      ['secret', '(tester@127.0.0.1) Password:', undefined],
    );
    remote.answer(host.id, first.id, 'wrong');
    const second = await until(async () => {
      const next = remote.hosts()[0].asking;
      return next && next.id !== first.id && next;
    });
    assert.deepEqual([second.text, second.again], ['(tester@127.0.0.1) Password:', true]);
    remote.answer(host.id, second.id, 'correct horse');
    const code = await until(async () => {
      const next = remote.hosts()[0].asking;
      return next && next.id !== second.id && next;
    });
    assert.equal(code.text, '(tester@127.0.0.1) Verification code:');
    // An answer that is no longer waited for is refused, not kept for the next question.
    assert.throws(() => remote.answer(host.id, second.id, 'late'), /終わっています/);
    remote.answer(host.id, code.id, '424242');
    const connected = await connecting;
    assert.equal(connected.state, 'connected');
    assert.equal(connected.asking, undefined);
    assert.equal(connected.about?.home, far.home);
    // Everything was installed and started within the one login that asked.
    assert.equal(server.state.logins, 1);
    assert.equal(server.state.connections, 1);
    assert.deepEqual((await readdir(path.join(far.home, '.irori-host'))).sort(), [
      'bin',
      'data',
      'node',
    ]);
    assert.equal((await remote.folders(host.id, far.home)).path, far.home);
  },
);

test(
  'no answer ends the login, and nothing asks again until the person connects',
  asksOnly,
  async (t) => {
    const { server, remote, host, question, hosts } = await asking(t, [
      { prompt: 'Password: ', answer: 'correct horse' },
    ]);
    const { LoginCancelled } = await import('../src/host/remote-link');
    const connecting = remote.connect(host.id);
    connecting.catch(() => {});
    remote.answer(host.id, (await question()).id, 'yes');
    remote.answer(host.id, (await question()).id, null);
    await assert.rejects(connecting, LoginCancelled);
    assert.equal(remote.hosts()[0].state, 'error');
    assert.equal(remote.hosts()[0].asking, undefined);
    assert.equal(server.state.logins, 0);
    // What a window reads by itself is told why, and starts no login that would ask again.
    const seen = server.state.connections;
    await assert.rejects(remote.folders(host.id), LoginCancelled);
    assert.equal(server.state.connections, seen);
    // The person connecting is asked again; the host's key is known by now.
    const again = remote.connect(host.id);
    const password = await question();
    assert.equal(password.text, '(tester@127.0.0.1) Password:');
    remote.answer(host.id, password.id, 'correct horse');
    assert.equal((await again).state, 'connected');
    assert.equal(server.state.logins, 1);
    // Where nobody can be asked, a host that asks is not signed in to, and nothing waits.
    const silent = hosts(false);
    await silent.init();
    await assert.rejects(silent.connect(host.id), /Permission denied/);
    assert.equal(silent.hosts()[0].asking, undefined);
  },
);

// A real SSH host, when one is named: `IRORI_TEST_SSH=<destination> npm test` after
// `npm run build`. It must be a disposable Linux machine that `ssh <destination>`
// reaches without a prompt. The test leaves irori's own files (~/.irori-host) there
// and removes the one folder it makes.
const sshTarget = process.env.IRORI_TEST_SSH;
test(
  "a vault's own agent runs on its host: its conversations, events, requests and attached files are there (protocol fixture)",
  posixOnly,
  async (t) => {
    const far = await farHost(t);
    const { remote, host, events, dataDir } = await hub(t, far);
    // The stand-in `claude` asks to write, as Claude Code asks before a Write.
    await writeFile(
      path.join(far.base, 'bin', 'claude'),
      `#!/usr/bin/env node\nimport(${JSON.stringify(pathToFileURL(path.resolve('tests/fixtures/claude-your-ai.mjs')).href)}).then(m=>m.run());\n`,
      { mode: 0o700 },
    );
    const vault = await remote.register(host.id, far.code, 'Code', 'team');
    const of = (runId: string) =>
      events.flatMap((event) =>
        event.type === 'agent' && event.event.runId === runId ? [event.event] : [],
      );
    const finished = async (runId: string) => {
      await until(() => of(runId).some((event) => event.type === 'done'));
      return of(runId);
    };
    const id = await remote.agent<string>('createConversation', [vault.scopeId, 'pi']);
    assert.ok(remote.keeps(id));
    // A file attached on this device goes to the host first, under the same id.
    const store = new AttachmentStore(dataDir);
    const ref = await store.stage('brief.txt', new TextEncoder().encode('ibis-3\n'));
    await remote.attach(vault.scopeId, ref, new Uint8Array(await readFile(await store.path(ref))));
    const runId = await remote.agent<string>('start', [
      {
        scopeId: vault.scopeId,
        agent: 'pi',
        conversationId: id,
        prompt: 'run: echo made-by-its-own > own.txt',
        attachments: [ref],
      },
    ]);
    const ran = await finished(runId);
    assert.equal(ran.at(-1)?.outcome, 'completed', JSON.stringify(ran));
    // Its events reached the windows as a run of this vault's, in that conversation.
    assert.ok(ran.every((event) => event.scopeId === vault.scopeId && event.conversationId === id));
    assert.equal(
      (await readFile(path.join(far.code, 'own.txt'), 'utf8')).trim(),
      'made-by-its-own',
    );
    // The agent there was given the attached file where the host keeps it.
    const kept = path.join(far.home, '.irori-host/data/attachments', ref.id, 'brief.txt');
    assert.equal(await readFile(kept, 'utf8'), 'ibis-3\n');
    const requests = (await readFile(path.join(far.code, 'fixture-requests.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const prompt = requests.find((call) => call.type === 'prompt').message as string;
    assert.ok(prompt.includes(kept), prompt);
    // The conversation is kept on the host, and listed, read and renamed there.
    const rows = await remote.agent<ConversationSummary[]>('agentConversations', [vault.scopeId]);
    assert.deepEqual(
      rows.map((row) => row.id),
      [id],
    );
    const read = await remote.agent<Conversation>('agentConversation', [vault.scopeId, 'pi', id]);
    assert.ok(read.events.some((event) => event.role === 'user'));
    // As the window asks: no conversation named, and the workspace open, which a
    // vault's conversations are not kept by. Its latest with that CLI is on show.
    const shown = await remote.agent<Conversation>('agentConversation', [
      vault.scopeId,
      'pi',
      undefined,
      randomUUID(),
    ]);
    assert.equal(shown.id, id);
    assert.deepEqual(
      (
        await remote.agent<ConversationSummary[]>('agentConversations', [
          vault.scopeId,
          randomUUID(),
        ])
      ).map((row) => row.id),
      [id],
    );
    await remote.agent('renameConversation', [id, 'Far work']);
    assert.equal(
      (await remote.agent<ConversationSummary[]>('agentConversations', [vault.scopeId]))[0].title,
      'Far work',
    );
    assert.deepEqual(await readdir(path.join(dataDir, 'conversations')).catch(() => []), []);
    // An instruction waits in the conversation's queue there until the window starts it.
    await remote.agent('queueAgentMessage', [
      {
        scopeId: vault.scopeId,
        agent: 'pi',
        conversationId: id,
        prompt: 'run: echo queued-there > queued.txt',
      },
    ]);
    const next = await remote.agent<string>('startNextQueued', [vault.scopeId, id, randomUUID()]);
    assert.equal((await finished(next)).at(-1)?.outcome, 'completed');
    assert.equal(
      (await readFile(path.join(far.code, 'queued.txt'), 'utf8')).trim(),
      'queued-there',
    );
    // Copied from a message, and gone on from before one, there.
    const message = (
      await remote.agent<Conversation>('agentConversation', [vault.scopeId, 'pi', id])
    ).events.find((event) => event.role === 'user' && event.runId === runId)!;
    const copy = await remote.agent<string>('forkConversation', [vault.scopeId, id, message.id!]);
    assert.ok(remote.keeps(copy));
    assert.equal(
      (await remote.agent<ConversationSummary[]>('agentConversations', [vault.scopeId])).length,
      2,
    );
    const again = await remote.agent<{ prompt: string }>('rewindConversation', [
      vault.scopeId,
      id,
      message.id!,
    ]);
    assert.equal(again.prompt, 'run: echo made-by-its-own > own.txt');
    // Stopped from here, its run there stops.
    const long = await remote.agent<string>('start', [
      { scopeId: vault.scopeId, agent: 'pi', conversationId: copy, prompt: 'run: sleep 32' },
    ]);
    await until(() => of(long).length > 0);
    await remote.agent('cancel', [vault.scopeId, copy]);
    assert.equal((await finished(long)).at(-1)?.outcome, 'cancelled');
    // What its run asks is answered on this device, and the answer reaches the run there.
    const asking = await remote.agent<string>('start', [
      {
        scopeId: vault.scopeId,
        agent: 'claude',
        // The phrase the stand-in answers with a Write, which it asks for first.
        prompt: 'irori: the irori agent handed you this task.',
      },
    ]);
    const request = await until(() => of(asking).find((event) => event.type === 'permission'));
    assert.ok(remote.asks(request.requestId));
    await remote.respond(request.requestId!, true);
    const answered = await finished(asking);
    assert.equal(answered.at(-1)?.outcome, 'completed', JSON.stringify(answered));
    assert.ok(answered.some((event) => event.resolved === request.requestId));
    assert.equal(remote.asks(request.requestId), false);
    assert.equal(
      await readFile(path.join(far.code, 'Knowledge_Base', 'from-your-ai.md'), 'utf8'),
      '# From your AI\n',
    );
    // Deleted there, the conversation is gone, and nothing here names it any more.
    await remote.agent('deleteConversation', [id]);
    assert.equal(remote.keeps(id), false);
    await assert.rejects(
      remote.agent('renameConversation', [id, 'gone']),
      /conversation was not found|会話が見つかりません/,
    );
    // A vault agent is not handed other vaults, there as here.
    await assert.rejects(
      remote.agent('start', [
        { scopeId: vault.scopeId, agent: 'pi', prompt: 'hi', brains: [vault.scopeId] },
      ]),
      /Only the irori agent takes vaults/,
    );
  },
);

test(
  "a vault agent's run its host lost is ended in the window once the host answers again (protocol fixture)",
  posixOnly,
  async (t) => {
    const far = await farHost(t);
    const { remote, host, events } = await hub(t, far);
    const { existsSync } = await import('node:fs');
    const { execFileSync } = await import('node:child_process');
    t.after(() => {
      execFileSync('sh', ['-c', 'pkill -f "[s]leep 31" || true']);
    });
    const vault = await remote.register(host.id, far.code, 'Code', 'team');
    const runId = await remote.agent<string>('start', [
      { scopeId: vault.scopeId, agent: 'pi', prompt: 'run: touch began && sleep 31' },
    ]);
    await until(() => existsSync(path.join(far.code, 'began')));
    // The vault host goes, and its run with it, as a restarted machine leaves them.
    const pid = await readFile(path.join(far.home, '.irori-host/data/host.pid'), 'utf8');
    process.kill(Number(pid), 'SIGKILL');
    // This device comes back by itself for the run it shows, and closes it there.
    const of = () =>
      events.flatMap((event) =>
        event.type === 'agent' && event.event.runId === runId ? [event.event] : [],
      );
    const done = await until(() => of().find((event) => event.type === 'done'), 30000);
    assert.equal(done.outcome, 'failed');
    assert.equal(done.conversationId, of()[0].conversationId);
    assert.ok(of().some((event) => event.type === 'error' && /vault host/.test(event.text)));
    assert.equal(remote.hosts()[0].state, 'connected');
  },
);

test(
  'the terminal of a vault on a host is ssh -t into its folder there, in the login shell',
  posixOnly,
  async (t) => {
    const base = await mkdtemp(path.join(tmpdir(), 'irori terminal '));
    t.after(() => rm(base, { recursive: true, force: true }));
    // A folder a shell would misread: spaces, quotes, a dollar, a backslash, another script.
    const folder = path.join(base, `it's "a" $HOME \\ 研究`);
    await mkdir(folder);
    const args = sshTerminalArgs({ destination: 'box', port: 2222 }, folder);
    assert.deepEqual(args.slice(0, -2), [
      '-t',
      '-o',
      'ServerAliveInterval=15',
      '-o',
      'ServerAliveCountMax=4',
      '-p',
      '2222',
      '--',
    ]);
    assert.equal(args.at(-2), 'box');
    assert.equal(sshTerminalArgs({ destination: 'box' }, folder).includes('-p'), false);
    // sshd hands the command to the person's login shell, whichever it is; the shell
    // then started is theirs, as a login.
    const shell = path.join(base, 'their-shell');
    await writeFile(shell, '#!/bin/sh\nprintf "%s|%s" "$(pwd)" "$*"\n', { mode: 0o700 });
    let tried = 0;
    for (const login of ['sh', 'bash', 'zsh', 'fish', 'dash']) {
      const found = spawnSync('sh', ['-c', `command -v ${login}`], {
        encoding: 'utf8',
      }).stdout.trim();
      if (!found) continue;
      tried++;
      const ran = spawnSync(found, ['-c', args.at(-1)!], {
        encoding: 'utf8',
        env: { ...process.env, SHELL: shell },
      });
      assert.equal(ran.stdout, `${folder}|-l`, `${login}: ${ran.stderr}`);
    }
    assert.ok(tried > 0);
    // A folder that is gone is said so, and the terminal ends.
    const gone = spawnSync(
      'sh',
      ['-c', sshTerminalArgs({ destination: 'box' }, path.join(base, 'gone')).at(-1)!],
      {
        encoding: 'utf8',
        env: { ...process.env, SHELL: shell },
      },
    );
    assert.notEqual(gone.status, 0);
    assert.equal(gone.stdout, '');
  },
);

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
