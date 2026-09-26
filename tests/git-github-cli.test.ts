import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { FileService } from '../src/host/files';
import { GitService } from '../src/git/service';
import { GitProcess, findGitHubCli, gitDetail, githubCredentialConfig } from '../src/git/process';

const refused =
  "fatal: could not read Username for 'https://github.com': terminal prompts disabled";

async function base(t: any) {
  const dir = await mkdtemp(path.join(tmpdir(), 'irori gh 日本語 '));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function executable(file: string, body: string) {
  await writeFile(file, `#!/bin/sh\n${body}`);
  await chmod(file, 0o755);
  return file;
}

/**
 * A stand-in for git that records each invocation and answers the way GitHub answers:
 * refused without gh's credential helper, `withGh` once that helper is configured.
 */
async function fakeGit(
  dir: string,
  withGh: { code: number; stderr?: string },
  first = { code: 128, stderr: refused },
) {
  const log = path.join(dir, 'git.log');
  const answer = (a: { code: number; stderr?: string }) =>
    `${a.stderr ? `printf '%s\\n' '${a.stderr.replace(/'/g, `'\\''`)}' >&2; ` : ''}exit ${a.code}`;
  const git = await executable(
    path.join(dir, 'git'),
    `printf '%s\\n' "$*" >> '${log}'\n` +
      `case "$*" in\n  *"credential.https://github.com.helper=!"*) ${answer(withGh)} ;;\n` +
      `  *) ${answer(first)} ;;\nesac\n`,
  );
  const calls = async () =>
    (await readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean);
  return { git, calls };
}

test('a refused HTTPS GitHub operation retries once with the GitHub CLI and succeeds', async (t) => {
  const dir = await base(t);
  const { git, calls } = await fakeGit(dir, { code: 0 });
  const gh = path.join(dir, 'bin dir', 'gh');
  const process = new GitProcess(git, async () => gh);
  t.after(() => process.close());
  await process.run(dir, ['fetch', 'origin'], { network: true });
  const [firstCall, retry, ...rest] = await calls();
  assert.doesNotMatch(firstCall, /credential/);
  assert.match(retry, /credential\.https:\/\/github\.com\.helper= -c/);
  assert.ok(retry.includes(`credential.https://github.com.helper=!'${gh}' auth git-credential`));
  assert.match(retry, /fetch origin$/);
  assert.deepEqual(rest, []);
});

test('the GitHub CLI fallback explains itself when gh is missing or cannot access the repository', async (t) => {
  const dir = await base(t);
  const missing = await fakeGit(dir, { code: 0 });
  const withoutGh = new GitProcess(missing.git, async () => undefined);
  await assert.rejects(
    withoutGh.run(dir, ['fetch', 'origin'], { network: true }),
    (error: Error) => {
      assert.match(error.message, /gh auth login/);
      assert.match(error.message, /\n\nfatal: could not read Username/);
      return true;
    },
  );
  assert.equal((await missing.calls()).length, 1, 'no retry without gh');

  const other = path.join(dir, 'denied');
  await mkdir(other);
  const denied = await fakeGit(other, {
    code: 128,
    stderr:
      "remote: Repository not found.\nfatal: repository 'https://github.com/org/private.git/' not found",
  });
  const tried = new GitProcess(denied.git, async () => '/opt/gh');
  await assert.rejects(tried.run(dir, ['fetch', 'origin'], { network: true }), /gh auth status/);
  assert.equal((await denied.calls()).length, 2);
});

test('only network operations against HTTPS GitHub are retried', async (t) => {
  const dir = await base(t);
  for (const [first, options] of [
    [{ code: 128, stderr: refused }, {}],
    [
      {
        code: 128,
        stderr:
          "fatal: could not read Username for 'https://gitlab.com': terminal prompts disabled",
      },
      { network: true },
    ],
    [{ code: 128, stderr: 'git@github.com: Permission denied (publickey).' }, { network: true }],
    [{ code: 1, stderr: 'error: failed to push some refs (non-fast-forward)' }, { network: true }],
  ] as const) {
    const run = path.join(dir, String(Math.random()).slice(2));
    await mkdir(run);
    const { git, calls } = await fakeGit(run, { code: 0 }, first);
    let asked = false;
    const process = new GitProcess(git, async () => {
      asked = true;
      return '/opt/gh';
    });
    await assert.rejects(process.run(run, ['fetch', 'origin'], options));
    assert.equal((await calls()).length, 1, first.stderr);
    assert.equal(asked, false);
  }
});

test("gh's helper replaces a stale helper for github.com only, in real Git", async (t) => {
  const dir = await base(t);
  const gh = await executable(
    path.join(dir, "gh's bin"),
    "cat >/dev/null\nprintf 'username=x-access-token\\npassword=from-gh\\n'\n",
  );
  const global = path.join(dir, 'gitconfig');
  await writeFile(
    global,
    '[credential]\n\thelper = "!f() { cat >/dev/null; echo username=stale; echo password=stale; }; f"\n',
  );
  const fill = (host: string) =>
    execFileSync('git', [...githubCredentialConfig(gh), 'credential', 'fill'], {
      cwd: dir,
      input: `protocol=https\nhost=${host}\n\n`,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: global,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_TERMINAL_PROMPT: '0',
      },
    });
  assert.match(fill('github.com'), /^password=from-gh$/m);
  assert.match(fill('example.com'), /^password=stale$/m);
});

test('Git output shown to a person has credentials and the home directory removed', () => {
  const detail = gitDetail(
    [
      "Cloning into '/home/person/KB'...",
      'progress\rremote: Counting objects',
      'fatal: unable to access https://person:hunter2@github.com/org/kb.git/',
      'helper said token=abc123 and ghp_0123456789abcdefghijklmnop',
      'github_pat_0123456789abcdefghij_klmn',
      'error: /home/person/KB/.git/config is locked',
    ].join('\n'),
    '/home/person',
  );
  assert.doesNotMatch(detail, /hunter2|abc123|ghp_0123|github_pat_0123|\/home\/person|Cloning/);
  assert.match(detail, /https:\/\/\*\*\*@github\.com\/org\/kb\.git/);
  assert.match(detail, /~\/KB\/\.git\/config/);
  assert.equal(detail.split('\n').length, 4);
});

test('the GitHub CLI is found only as an executable file on the PATH', async (t) => {
  const dir = await base(t);
  const empty = path.join(dir, 'empty'),
    notExecutable = path.join(dir, 'plain'),
    installed = path.join(dir, 'installed');
  await Promise.all([empty, notExecutable, installed].map((d) => mkdir(d)));
  await mkdir(path.join(empty, 'gh'));
  await writeFile(path.join(notExecutable, 'gh'), '');
  await executable(path.join(installed, 'gh'), 'exit 0\n');
  const PATH = ['relative', empty, notExecutable, installed].join(path.delimiter);
  assert.equal(await findGitHubCli({ PATH }, 'linux'), path.join(installed, 'gh'));
  assert.equal(await findGitHubCli({ PATH: empty }, 'linux'), undefined);
});

test('a failed clone removes the empty folder it made, and a gh retry completes the clone', async (t) => {
  const dir = await base(t);
  const files = new FileService(path.join(dir, 'device'));
  await files.init();
  const parent = path.join(dir, 'parent');
  await mkdir(parent);

  const withoutGh = await fakeGit(dir, { code: 0 });
  const failing = new GitService(
    files,
    () => true,
    undefined,
    new GitProcess(withoutGh.git, async () => undefined),
  );
  t.after(() => failing.close());
  await assert.rejects(
    failing.clone({ url: 'https://github.com/org/private.git', parent, name: 'KB' }),
    (error: Error) => {
      assert.match(error.message, /gh auth login/);
      assert.doesNotMatch(error.message, /保持|kept/);
      return true;
    },
  );
  await assert.rejects(stat(path.join(parent, 'KB')), { code: 'ENOENT' });

  const other = path.join(dir, 'with gh');
  await mkdir(other);
  const withGh = await fakeGit(other, { code: 0 });
  const cloning = new GitService(
    files,
    () => true,
    undefined,
    new GitProcess(withGh.git, async () => '/opt/gh'),
  );
  t.after(() => cloning.close());
  const result = await cloning.clone({
    url: 'https://github.com/org/private.git',
    parent,
    name: 'KB',
  });
  assert.equal(result.path, path.join(await realpath(parent), 'KB'));
  const calls = await withGh.calls();
  assert.match(calls[0], /clone .* https:\/\/github\.com\/org\/private\.git /);
  assert.doesNotMatch(calls[0], /credential/);
  assert.match(calls[1], /credential\.https:\/\/github\.com\.helper=!'\/opt\/gh'.* clone /);
});

test('a clone that leaves files behind keeps them and says so', async (t) => {
  const dir = await base(t);
  const files = new FileService(path.join(dir, 'device'));
  await files.init();
  const parent = path.join(dir, 'parent');
  await mkdir(parent);
  const git = await executable(
    path.join(dir, 'git'),
    `for last; do :; done\ntouch "$last/partial"\nprintf '%s\\n' 'fatal: early EOF' >&2\nexit 128\n`,
  );
  const service = new GitService(
    files,
    () => true,
    undefined,
    new GitProcess(git, async () => undefined),
  );
  t.after(() => service.close());
  await assert.rejects(
    service.clone({ url: 'https://github.com/org/kb.git', parent, name: 'KB' }),
    (error: Error) => {
      const [advice, detail] = error.message.split('\n\n');
      assert.match(advice, /保持|kept/);
      assert.match(detail, /early EOF/);
      return true;
    },
  );
  assert.ok((await stat(path.join(parent, 'KB', 'partial'))).isFile());
});
