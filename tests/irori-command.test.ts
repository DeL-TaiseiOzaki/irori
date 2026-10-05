import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { githubRepositoryURL, parseIroriCommand } from '../src/domain/irori-command';
import { iroriBridge } from '../src/agents/irori-bridge';
import { iroriAgentSkills, iroriCommandPreamble } from '../prompts';
import { parseSkill } from '../src/host/skills';
import { FileService } from '../src/host/files';
import { WorkspaceService } from '../src/host/workspaces';
import { YourAiService } from '../src/host/you';
import { AgentSetup } from '../src/host/agent-setup';
import { AgentService } from '../src/agents/service';
import { CloudService } from '../src/cloud/service';
import { GitService } from '../src/git/service';
import { GitProcess } from '../src/git/process';
import type { AgentEvent, WorkspaceProfile } from '../src/domain/types';

const posixOnly = {
  skip: process.platform === 'win32' && 'POSIX launcher and executable fixtures',
  timeout: 60000,
};

async function temp(t: TestContext) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori command 日本語 '));
  t.after(() => rm(base, { recursive: true, force: true }));
  return base;
}

test('the command reads its forms, options and owner/name shorthand', () => {
  assert.deepEqual(parseIroriCommand([]), { kind: 'help' });
  assert.deepEqual(parseIroriCommand(['--help']), { kind: 'help' });
  assert.deepEqual(parseIroriCommand(['list']), { kind: 'list' });
  assert.deepEqual(parseIroriCommand(['clone', 'octo/notes', '--name', 'Notes', '--folder=n']), {
    kind: 'clone',
    url: 'https://github.com/octo/notes.git',
    name: 'Notes',
    folder: 'n',
  });
  assert.equal(githubRepositoryURL('octo/kb.git'), 'https://github.com/octo/kb.git');
  assert.equal(
    githubRepositoryURL('git@github.com:octo/kb.git'),
    'git@github.com:octo/kb.git',
    'a URL is passed on as written',
  );
  assert.deepEqual(parseIroriCommand(['create', 'Thesis', '--category', 'team']), {
    kind: 'create',
    folder: 'Thesis',
    category: 'team',
  });
  assert.deepEqual(parseIroriCommand(['connect', 'Notes', '~/Drive', '--read-only']), {
    kind: 'connect',
    hibachi: 'Notes',
    folder: '~/Drive',
    readOnly: true,
  });
  assert.throws(() => parseIroriCommand(['remove', 'x']), /Unknown command "remove"/);
  assert.throws(() => parseIroriCommand(['add', 'a', '--parent', 'b']), /has no --parent/);
  assert.throws(() => parseIroriCommand(['clone', 'octo/a', '--name']), /--name needs a value/);
  assert.throws(
    () => parseIroriCommand(['clone', 'octo/a', '--name', '--folder', 'x']),
    /needs a value/,
  );
  assert.throws(() => parseIroriCommand(['add', 'a', 'b']), /takes one folder/);
  assert.throws(() => parseIroriCommand(['connect', 'a']), /a hibachi and a folder/);
  assert.throws(() => parseIroriCommand(['connect', 'a', 'b', '--read-only=yes']), /no value/);
  assert.throws(
    () => parseIroriCommand(['add', 'a', '--category', 'club']),
    /--category is one of/,
  );
  assert.throws(() => parseIroriCommand(['add', 'a', '--name', 'x', '--name', 'y']), /twice/);
  assert.throws(() => parseIroriCommand('list'), /could not be read/);
  assert.throws(() => parseIroriCommand(['list', 'x'.repeat(5000)]), /could not be read/);
});

test('every standard skill is a valid package whose name is its folder', () => {
  assert.deepEqual(Object.keys(iroriAgentSkills).sort(), [
    'add-hibachis',
    'connect-folder',
    'irori-setup',
    'new-hibachi',
  ]);
  for (const [name, text] of Object.entries(iroriAgentSkills)) {
    const skill = parseSkill(name, text);
    assert.equal(skill.name, name);
    assert.ok(skill.description.length > 20 && skill.description.length <= 400);
    assert.match(skill.instructions, /irori (clone|create|add|connect|list)/);
  }
  assert.match(iroriCommandPreamble, /`irori help`/);
});

test('a new irori agent folder has the standard skills; an older one gets the missing ones only when asked', async (t) => {
  const base = await temp(t);
  const you = new YourAiService(path.join(base, 'device'), base);
  const created = await you.create();
  assert.deepEqual(created.missingSkills, []);
  const agents = await readFile(path.join(created.root, 'AGENTS.md'), 'utf8');
  assert.match(agents, /`irori` command/);
  const setupSkill = path.join(created.root, '.agents/skills/irori-setup/SKILL.md');
  assert.equal(await readFile(setupSkill, 'utf8'), iroriAgentSkills['irori-setup']);
  // The person edits one and deletes another: the edit stays, the deleted one is listed.
  await writeFile(setupSkill, 'edited');
  await rm(path.join(created.root, '.agents/skills/new-hibachi'), { recursive: true });
  const before = await you.status();
  assert.deepEqual(before.missingSkills, ['new-hibachi']);
  const after = await you.addStandardSkills();
  assert.deepEqual(after.missingSkills, []);
  assert.equal(await readFile(setupSkill, 'utf8'), 'edited');
  // A link in place of the skills folder is not followed out of the folder.
  const other = new YourAiService(path.join(base, 'other-device'), path.join(base, 'other'));
  const ready = await other.create();
  await rm(path.join(ready.root, '.agents'), { recursive: true });
  const outside = path.join(base, 'outside');
  await mkdir(outside);
  await symlink(outside, path.join(ready.root, '.agents'));
  await assert.rejects(other.addStandardSkills(), /is not a folder inside/);
  await assert.rejects(lstat(path.join(outside, 'skills')));
  // A folder not set up has nothing to add to.
  const fresh = new YourAiService(path.join(base, 'fresh-device'), path.join(base, 'fresh'));
  await assert.rejects(
    fresh.addStandardSkills(),
    /irori agent を用意してください|Set up the irori agent first/,
  );
});

/** A device with a bare repository that `https://github.com/octo/kb.git` clones from. */
async function device(t: TestContext) {
  // Removed last, after the connections that link into it are closed.
  const base = await mkdtemp(path.join(tmpdir(), 'irori command 日本語 '));
  const remote = path.join(base, 'remote.git');
  const seed = path.join(base, 'seed');
  const global = path.join(base, 'gitconfig');
  await writeFile(
    global,
    `[user]\n\tname = Git fixture\n\temail = fixture@example.invalid\n[commit]\n\tgpgsign = false\n` +
      `[init]\n\tdefaultBranch = main\n` +
      `[url "${remote}"]\n\tinsteadOf = https://github.com/octo/kb.git\n`,
  );
  const previous = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = global;
  t.after(() => {
    if (previous === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previous;
  });
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd });
  await mkdir(seed);
  git(seed, 'init', '-q');
  await writeFile(path.join(seed, 'README.md'), '# KB\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '-qm', 'seed');
  git(base, 'clone', '-q', '--bare', seed, remote);
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const cloud = new CloudService(files, async () => {});
  files.cloud = cloud;
  // Git refuses everything else while a run is in progress, as the host's gate does.
  const service = new GitService(
    files,
    () => false,
    undefined,
    new GitProcess('git', async () => undefined),
  );
  const workspaces = new WorkspaceService(files);
  const announced: { workspace?: WorkspaceProfile; scopeId?: string }[] = [];
  const parent = path.join(base, 'home', 'irori');
  const deps: ConstructorParameters<typeof AgentSetup>[0] = {
    files,
    git: service,
    workspaces,
    cloud,
    defaultParent: async () => parent,
    announce: (change) => announced.push(change),
    home: path.join(base, 'home'),
  };
  const setup = new AgentSetup(deps);
  t.after(async () => {
    await cloud.close();
    await service.close();
    await rm(base, { recursive: true, force: true });
  });
  return { base, files, workspaces, setup, deps, announced, parent };
}

test('clone, create and add register hibachis and join the request’s workspace, while runs go on', async (t) => {
  const { base, files, workspaces, setup, announced, parent } = await device(t);
  const work = await workspaces.save('Work', []);
  const context = { workspaceId: work.id };
  const cloned = await setup.run(['clone', 'octo/kb', '--name', 'Team KB'], base, context);
  assert.match(cloned, /^Registered the hibachi "Team KB" at .*\(GitHub octo\/kb\)\./);
  assert.match(cloned, /Added it to this workspace/);
  const kb = files.list().find((space) => space.name === 'Team KB')!;
  assert.equal(kb.root, path.join(parent, 'kb'));
  assert.equal(await readFile(path.join(kb.root, 'README.md'), 'utf8'), '# KB\n');
  assert.deepEqual((await workspaces.list())[0].scopeIds, [kb.scopeId]);
  assert.deepEqual(announced.at(-1)?.workspace?.scopeIds, [kb.scopeId]);
  // The same repository again: no second clone; it is in the workspace already.
  const again = await setup.run(['clone', 'https://github.com/octo/kb.git'], base, context);
  assert.match(again, /^Already a hibachi "Team KB"/);
  assert.match(again, /already in this workspace/);
  // From another workspace it joins that one.
  const thesis = await workspaces.save('Thesis', []);
  assert.match(
    await setup.run(['clone', 'octo/kb'], base, { workspaceId: thesis.id }),
    /Added it to this workspace/,
  );
  // A new hibachi, relative to the agent's working folder, with its first commit.
  const created = await setup.run(['create', 'Notes', '--parent', 'mine'], base, context);
  assert.match(created, /^Registered the hibachi "Notes" at /);
  const notes = files.list().find((space) => space.name === 'Notes')!;
  assert.equal(notes.root, path.join(base, 'mine', 'Notes'));
  assert.match(
    execFileSync('git', ['log', '--format=%s'], { cwd: notes.root, encoding: 'utf8' }),
    /Notes/,
  );
  // A folder already here, with ~ for the home folder; adding it twice only joins.
  const plain = path.join(base, 'home', 'Plain');
  await mkdir(plain, { recursive: true });
  assert.match(await setup.run(['add', '~/Plain'], base), /^Registered the hibachi "Plain"/);
  assert.match(await setup.run(['add', '~/Plain'], base), /joined none/);
  assert.match(
    await setup.run(['add', plain], base, context),
    /^Already a hibachi "Plain"[\s\S]*Added it/,
  );
  assert.deepEqual((await workspaces.list()).find((item) => item.id === work.id)?.scopeIds, [
    kb.scopeId,
    notes.scopeId,
    files.list().find((space) => space.name === 'Plain')!.scopeId,
  ]);
  // A folder taken by something else is not cloned over.
  await mkdir(path.join(parent, 'taken'));
  await rm(kb.root, { recursive: true });
  await assert.rejects(
    setup.run(['clone', 'octo/kb', '--folder', 'taken'], base, context),
    /already exists/,
  );
  await assert.rejects(setup.run(['clone', 'https://gitlab.com/a/b.git'], base), /not a GitHub/);
  const list = await setup.run(['list'], base, context);
  assert.match(list, /^Hibachis on this computer:/);
  assert.match(list, /- Notes: folder .*, in this workspace/);
  assert.match(list, /This request came from the workspace "Work"\./);
  assert.match(
    await setup.run(['help'], base),
    new RegExp(`go in ${JSON.stringify(JSON.stringify(parent)).slice(1, -1)}`),
  );
});

test('connect links a folder into the named hibachi’s contents', async (t) => {
  const { base, files, setup, deps, announced } = await device(t);
  const root = path.join(base, 'Notes');
  await mkdir(root);
  const notes = await files.register(root, 'Notes', 'personal');
  const drive = path.join(base, 'Drive', 'My Drive');
  await mkdir(drive, { recursive: true });
  const report = await setup.run(
    ['connect', 'hibachi-notes', drive, '--name', 'drive', '--read-only'],
    base,
  );
  assert.match(report, /as contents\/drive, read-only/);
  const link = path.join(root, 'contents', 'drive');
  assert.ok((await lstat(link)).isSymbolicLink());
  assert.equal(path.resolve(path.dirname(link), await readlink(link)), drive);
  assert.equal(announced.at(-1)?.scopeId, notes.scopeId);
  await assert.rejects(setup.run(['connect', 'Research', drive], base), /No hibachi is named/);
  const busy = new AgentSetup({ ...deps, running: () => true });
  await assert.rejects(busy.run(['connect', 'Notes', drive], base), /own agent running/);
});

/** Runs the `irori` command as a CLI's shell would: by name, from the run's PATH. */
function irori(env: NodeJS.ProcessEnv, args: string[], cwd: string) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile('irori', args, { env, cwd }, (error, stdout, stderr) =>
      resolve({ code: error ? Number(error.code) : 0, stdout, stderr }),
    );
  });
}

test(
  'the irori launcher passes its arguments and folder and prints the answer',
  posixOnly,
  async (t) => {
    const base = await temp(t);
    const asked: { argv: string[]; cwd: string }[] = [];
    const bridge = await iroriBridge(
      path.join(base, 'data'),
      async (request) => {
        asked.push(request);
        if (request.argv[0] === 'fail') throw Error('No such thing.');
        return 'done';
      },
      { PATH: process.env.PATH },
      process.execPath,
    );
    t.after(() => bridge.close());
    assert.ok(bridge.env.PATH!.startsWith(bridge.bin + path.delimiter));
    const ok = await irori(bridge.env, ['list', 'two words'], base);
    assert.deepEqual(ok, { code: 0, stdout: 'done\n', stderr: '' });
    assert.deepEqual(asked[0], { argv: ['list', 'two words'], cwd: await realpathOf(base) });
    const failed = await irori(bridge.env, ['fail'], base);
    assert.equal(failed.code, 1);
    assert.equal(failed.stderr, 'irori: No such thing.\n');
    const outside = await irori({ PATH: bridge.env.PATH }, ['list'], base);
    assert.match(outside.stderr, /only an irori agent run/);
    assert.notEqual(outside.code, 0);
  },
);

async function realpathOf(folder: string) {
  return (await import('node:fs/promises')).realpath(folder);
}

test(
  'the irori agent on Pi registers a folder with the irori command into its workspace (protocol fixture)',
  posixOnly,
  async (t) => {
    const base = await temp(t);
    const home = path.join(base, 'home');
    await mkdir(home);
    const bin = path.join(base, 'bin');
    await mkdir(bin);
    await writeFile(
      path.join(bin, 'pi'),
      `#!/usr/bin/env node\nimport(${JSON.stringify(pathToFileURL(path.resolve('tests/fixtures/harnesses.mjs')).href)}).then(m=>m.run('pi'));\n`,
      { mode: 0o700 },
    );
    const previous = process.env.PATH;
    process.env.PATH = bin + path.delimiter + previous;
    t.after(() => {
      process.env.PATH = previous;
    });
    const files = new FileService(path.join(base, 'device'));
    await files.init();
    const you = new YourAiService(path.join(base, 'device'), home);
    const { id, root } = await you.create();
    const workspaces = new WorkspaceService(files);
    const work = await workspaces.save('Work', []);
    const announced: (WorkspaceProfile | undefined)[] = [];
    const setup = new AgentSetup({
      files,
      git: new GitService(files),
      workspaces,
      cloud: new CloudService(files, async () => {}),
      defaultParent: async () => path.dirname(root),
      announce: ({ workspace }) => announced.push(workspace),
    });
    const events: AgentEvent[] = [];
    let finished!: () => void;
    const done = new Promise<void>((resolve) => (finished = resolve));
    const service = new AgentService(
      files,
      (event) => {
        events.push(event);
        if (event.type === 'done') finished();
      },
      undefined,
      undefined,
      you,
    );
    service.setup = (argv, cwd, context) => setup.run(argv, cwd, context);
    t.after(() => service.cancel());
    const folder = path.join(base, 'Research');
    await mkdir(folder);
    const runId = await service.startAccepted({
      scopeId: id,
      agent: 'pi',
      prompt: `Register it.\nrun: irori add ${JSON.stringify(folder)} --name Research`,
      workspace: work.id,
    });
    await done;
    const mine = events.filter((event) => event.runId === runId);
    assert.equal(mine.at(-1)?.outcome, 'completed', JSON.stringify(mine));
    const calls = (await readFile(path.join(root, 'fixture-requests.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const prompt = calls.find((call) => call.type === 'prompt').message;
    assert.ok(prompt.startsWith(iroriCommandPreamble), prompt);
    const command = calls.find((call) => call.type === 'command');
    assert.equal(command.code, 0, command.stderr);
    assert.match(command.stdout, /^Registered the hibachi "Research"/);
    const research = files.list().find((space) => space.name === 'Research')!;
    assert.deepEqual((await workspaces.list())[0].scopeIds, [research.scopeId]);
    assert.deepEqual(announced.at(-1)?.scopeIds, [research.scopeId]);
    // Nothing for the command was written in the irori agent's folder.
    await assert.rejects(stat(path.join(root, 'irori')));
    // A hibachi's own agent gets neither the command nor a workspace.
    await assert.rejects(
      service.startAccepted({
        scopeId: research.scopeId,
        agent: 'pi',
        prompt: 'x',
        workspace: work.id,
      }),
      /Only the irori agent/,
    );
  },
);
