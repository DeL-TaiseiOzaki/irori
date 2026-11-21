import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { findConfig } from '../src/agents/config-approval';
import { writeDecision } from '../src/agents/delegation';
import { ruleTakes, SchemaHookRunner } from '../src/agents/schema-hooks';
import { readDropped, TooManyFiles } from '../src/app/dropped';
import { githubRepository, repositoryFolder } from '../src/domain/git';
import { parseIroriCommand } from '../src/domain/irori-command';
import { AgentSetup } from '../src/host/agent-setup';
import { FileService } from '../src/host/files';
import { ancestorWithin, resolveWithin, safeRelativeParts } from '../src/host/path-guard';
import { readSshConfigHosts } from '../src/host/ssh-config';
import { configEntries, gitConfigRuns } from '../src/git/config-approval';
import { editedText } from '../src/knowledge/authorship';
import { decode } from '../src/remote/wire';

const posix = { skip: process.platform === 'win32' && 'POSIX symlinks' };

test('git config approval catches protocol.ext.allow, config.worktree, continuations, and long values', async (t) => {
  const base = await mkdtemp(path.join(tmpdir(), 'irori sec git '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const repo = path.join(base, 'repo');
  await mkdir(repo);
  execFileSync('git', ['init', '--quiet', repo]);

  assert.deepEqual(configEntries('[core]\n\tsshCommand = foo \\\nbar\n'), [
    ['core.sshcommand', 'foo bar'],
  ]);

  await writeFile(path.join(repo, '.git', 'config'), '[protocol "ext"]\n\tallow = always\n', {
    flag: 'a',
  });
  const proto = await gitConfigRuns(repo);
  assert.ok(proto?.found.some((line) => line.startsWith('protocol.ext.allow =')));

  await writeFile(path.join(repo, '.git', 'config.worktree'), '[core]\n\thooksPath = evil-hooks\n');
  const wt = await gitConfigRuns(repo);
  assert.ok(wt?.found.some((line) => line.startsWith('core.hookspath = evil-hooks')));

  const pad = 'x'.repeat(220);
  await writeFile(path.join(repo, '.git', 'config.worktree'), `[core]\n\tsshCommand = ${pad}A\n`);
  const first = await gitConfigRuns(repo);
  await writeFile(path.join(repo, '.git', 'config.worktree'), `[core]\n\tsshCommand = ${pad}B\n`);
  const second = await gitConfigRuns(repo);
  assert.notEqual(first?.digest, second?.digest);
});

test(
  'agent config approval covers codex, antigravity, opencode tools, and symlink targets',
  posix,
  async (t) => {
    const base = await mkdtemp(path.join(tmpdir(), 'irori sec cfg '));
    t.after(() => rm(base, { recursive: true, force: true }));
    const vault = path.join(base, 'vault');
    await mkdir(path.join(vault, '.codex'), { recursive: true });
    await mkdir(path.join(vault, '.agents'), { recursive: true });
    await mkdir(path.join(vault, '.claude'), { recursive: true });
    await mkdir(path.join(vault, '.opencode', 'tools'), { recursive: true });

    await writeFile(path.join(vault, '.codex', 'config.toml'), 'model = "x"\n');
    assert.ok(await findConfig({ root: vault }, 'codex'));

    await writeFile(path.join(vault, '.agents', 'hooks.json'), '{}');
    assert.ok(await findConfig({ root: vault }, 'antigravity'));
    assert.ok(await findConfig({ root: vault, added: true }, 'antigravity'));

    await writeFile(path.join(vault, '.opencode', 'tools', 't.js'), 'export default {}');
    assert.ok(await findConfig({ root: vault }, 'opencode'));

    const target = path.join(base, 'payload.json');
    await writeFile(target, '{"v":1}');
    await symlink(target, path.join(vault, '.mcp.json'));
    const before = await findConfig({ root: vault }, 'claude');
    await writeFile(target, '{"v":2}');
    const after = await findConfig({ root: vault }, 'claude');
    assert.ok(before && after);
    assert.notEqual(before.digest, after.digest);
  },
);

test(
  'path-guard rejects traversal, backslashes, drive prefixes, and symlink escapes',
  posix,
  async (t) => {
    const base = await mkdtemp(path.join(tmpdir(), 'irori sec path '));
    t.after(() => rm(base, { recursive: true, force: true }));
    const root = path.join(base, 'root');
    const outside = path.join(base, 'outside');
    await mkdir(root);
    await mkdir(outside);
    await writeFile(path.join(outside, 'secret.txt'), 'secret');
    await symlink(outside, path.join(root, 'escape'));

    assert.throws(() => safeRelativeParts('..\\..\\Windows\\System32\\cmd.exe'));
    assert.throws(() => safeRelativeParts('C:/Windows/win.ini'));
    assert.throws(() => safeRelativeParts('a/\0b'));
    assert.throws(() => safeRelativeParts('../x'));
    await assert.rejects(resolveWithin(root, 'escape/secret.txt'));
    assert.equal(await ancestorWithin(root, path.join(root, 'escape', 'new-dir')), false);
  },
);

test('wire decode rejects null, primitives, arrays, and multi-key $bytes confusion', () => {
  assert.throws(() => decode('null'));
  assert.throws(() => decode('123'));
  assert.throws(() => decode('[]'));
  const obj = decode(JSON.stringify({ id: 1, ok: true, value: { $bytes: 'YQ==', extra: 1 } })) as {
    value: unknown;
  };
  assert.deepEqual(obj.value, { $bytes: 'YQ==', extra: 1 });
});

test('irori command parser, git domain, and authorship resist prototype/traversal/amplification attacks', () => {
  assert.throws(() => parseIroriCommand(['toString']), /Unknown command "toString"/);
  assert.equal(githubRepository('git@github.com:octo/..'), undefined);
  assert.equal(repositoryFolder('git@github.com:octo/..'), '');
  const huge = 'x'.repeat(20_000);
  const base = 'a'.repeat(500);
  assert.equal(
    editedText('edit', { old_string: 'a', new_string: huge, replace_all: true }, base),
    undefined,
  );
});

test(
  'schema hooks check all apply_patch files, follow symlinks, block metadata URLs, and hide IRORI_COMMAND',
  posix,
  async (t) => {
    const base = await mkdtemp(path.join(tmpdir(), 'irori sec hooks '));
    t.after(() => rm(base, { recursive: true, force: true }));
    const vault = path.join(base, 'vault');
    const you = path.join(base, 'you');
    await mkdir(path.join(vault, 'protected'), { recursive: true });
    await mkdir(you, { recursive: true });
    await writeFile(path.join(vault, 'protected', 'secret.md'), 'x');
    await symlink(path.join(vault, 'protected', 'secret.md'), path.join(you, 'link.md'));

    assert.equal(
      ruleTakes(
        'Edit(protected/**)',
        {
          name: 'apply_patch',
          also: ['Edit'],
          input: { file_path: 'safe.md', files: ['safe.md', 'protected/secret.md'] },
        },
        vault,
        base,
      ),
      true,
    );
    assert.equal(
      ruleTakes(
        'Edit(protected/**)',
        { name: 'Edit', input: { file_path: path.join(you, 'link.md') } },
        vault,
        base,
      ),
      true,
    );
    const decision = writeDecision(
      { you, brains: [{ scopeId: '1', name: 'V', agent: 'v', root: vault }] },
      path.join(you, 'link.md'),
    );
    assert.equal(decision.allow, false);

    const runner = new SchemaHookRunner(
      [
        {
          event: 'PostToolUse',
          type: 'http',
          command: '',
          url: 'http://169.254.169.254/latest/meta-data/',
          from: 'folder',
        },
      ],
      {
        cwd: vault,
        env: { IRORI_COMMAND: 'http://127.0.0.1:1/secret' },
        agent: 'pi',
        fields: () => ({}),
      },
    );
    const outcome = await runner.run('PostToolUse', {});
    assert.match(outcome.notices[0] ?? '', /metadata/);
  },
);

test('AgentSetup enforces handedScopes, confirms clone/create, and shows cwd for relative paths', async (t) => {
  const base = await mkdtemp(path.join(tmpdir(), 'irori sec setup '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const files = new FileService(path.join(base, 'data'));
  await files.init();
  const aRoot = path.join(base, 'A');
  const bRoot = path.join(base, 'B');
  await mkdir(aRoot);
  await mkdir(bRoot);
  const a = await files.register(aRoot, 'A', 'personal');
  await files.register(bRoot, 'B', 'personal');

  const asked: string[] = [];
  const setup = new AgentSetup({
    files,
    git: {} as never,
    workspaces: { list: async () => [], update: async () => ({}) as never },
    cloud: {} as never,
    defaultParent: async () => base,
    confirm: async (command) => {
      asked.push(command);
      return false;
    },
  });

  await assert.rejects(
    setup.run(['set', 'B', '--name', 'Pwned'], base, { handedScopes: [a.scopeId] }),
    /not handed/,
  );
  await assert.rejects(setup.run(['clone', 'octo/repo'], base), /did not allow "irori clone"/);
  await assert.rejects(setup.run(['create', 'NewVault'], base), /did not allow "irori create"/);
  await assert.rejects(
    setup.run(['connect', 'A', '.'], '/tmp/spoof-dir'),
    /did not allow "irori connect"/,
  );
  assert.equal(asked.at(-1), 'irori connect A . (in /tmp/spoof-dir)');
});

test('ssh-config wildcard matcher runs in linear time against adversarial patterns', async (t) => {
  const base = await mkdtemp(path.join(tmpdir(), 'irori sec ssh '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const sshDir = path.join(base, '.ssh');
  await mkdir(sshDir, { recursive: true });
  const config = path.join(sshDir, 'config');
  await writeFile(
    config,
    `Host ${'a'.repeat(40)}\n  User ok\nHost ${'*a'.repeat(20)}b\n  User evil\n`,
  );
  const started = Date.now();
  const hosts = await readSshConfigHosts({ home: base, system: null });
  assert.ok(Date.now() - started < 1000);
  assert.equal(hosts.length, 1);
  assert.equal(hosts[0].user, 'ok');
});

test('readDropped rejects excessive nesting depth', async () => {
  const makeDir = (
    depth: number,
  ): {
    name: string;
    isFile: boolean;
    isDirectory: boolean;
    createReader: () => { readEntries: (ok: (entries: unknown[]) => void) => void };
  } => {
    let read = false;
    return {
      name: `d${depth}`,
      isFile: false,
      isDirectory: true,
      createReader: () => ({
        readEntries: (ok) => {
          if (read) ok([]);
          else {
            read = true;
            ok(depth > 0 ? [makeDir(depth - 1)] : []);
          }
        },
      }),
    };
  };
  await assert.rejects(readDropped([makeDir(40) as never]), TooManyFiles);
});
