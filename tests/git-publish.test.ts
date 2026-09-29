import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod, readdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { FileService } from '../src/host/files';
import { GitService } from '../src/git/service';
import { GitHubCli } from '../src/git/github';
import { GitProcess } from '../src/git/process';
import { suggestRepositoryName, validRepositoryName } from '../src/domain/git';

function git(root: string, ...args: string[]) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trimEnd();
}

/**
 * A stand-in for gh that answers as GitHub does for the account `octo`, and on
 * `repo create` makes a bare repository that the fixture's Git configuration
 * substitutes for the new github.com URL.
 */
async function fakeGh(base: string, { exists = false, bare = true } = {}) {
  const log = path.join(base, 'gh.log');
  const gh = path.join(base, 'gh');
  await writeFile(
    gh,
    `#!/bin/sh
printf '%s|%s\\n' "$GH_HOST" "$*" >> '${log}'
case "$*" in
  "api user --jq .login") echo octo ;;
  "api user/orgs --paginate --jq .[].login") printf 'team-b\\nocto\\nteam-a\\n' ;;
  "config get git_protocol --host github.com") echo https ;;
  "repo create "*)
    ${exists ? `echo 'GraphQL: Name already exists on this account (createRepository)' >&2; exit 1` : bare ? `git init --quiet --bare '${path.join(base, 'remote.git')}'` : 'true'}
    echo "https://github.com/$3" ;;
  *) echo "unknown command $*" >&2; exit 1 ;;
esac
`,
  );
  await chmod(gh, 0o755);
  const calls = async () =>
    (await readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean);
  return { gh, calls };
}

async function fixture(t: any, options: Parameters<typeof fakeGh>[1] = {}) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori publish 日本語 '));
  const globalConfig = path.join(base, 'gitconfig');
  await writeFile(
    globalConfig,
    `[user]\n\tname = Git fixture\n\temail = fixture@example.invalid\n[commit]\n\tgpgsign = false\n` +
      `[url "${path.join(base, 'remote.git')}"]\n\tinsteadOf = https://github.com/octo/kb.git\n`,
  );
  const previous = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = globalConfig;
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const { gh, calls } = await fakeGh(base, options);
  const service = new GitService(
    files,
    () => true,
    undefined,
    new GitProcess('git', async () => undefined),
    new GitHubCli(async () => gh),
  );
  t.after(async () => {
    await service.close();
    if (previous === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previous;
    await rm(base, { recursive: true, force: true });
  });
  return { base, files, service, calls };
}

/** What the host's createSpace does: a new repository, registered, with its first commit. */
async function createHibachi(f: Awaited<ReturnType<typeof fixture>>, folder = 'New KB') {
  const root = await f.service.create({ parent: f.base, folder });
  const space = await f.files.register(root, '新しい hibachi', 'personal');
  return { root, space, notice: await f.service.firstCommit(space.scopeId) };
}

test('a new hibachi is a repository on main whose first commit holds only what irori wrote', async (t) => {
  const f = await fixture(t);
  const { root, space, notice } = await createHibachi(f);
  assert.equal(notice, undefined);
  assert.equal(git(root, 'symbolic-ref', '--short', 'HEAD'), 'main');
  assert.deepEqual(git(root, 'ls-tree', '-r', '--name-only', 'HEAD').split('\n').sort(), [
    '.gitignore',
    '.irori/scope.json',
  ]);
  assert.match(git(root, 'log', '-1', '--format=%s'), /新しい hibachi/);
  assert.equal(await readFile(path.join(root, '.gitignore'), 'utf8'), '/contents/\n');
  const status = await f.service.status(space.scopeId);
  assert.equal(status.available, true);
  assert.equal(status.remote, undefined);
  assert.deepEqual(status.changes, []);

  // An existing folder is never reused, and nothing is made inside a registered hibachi.
  await assert.rejects(
    f.service.create({ parent: f.base, folder: 'New KB' }),
    /already exists|同じ名前のフォルダ/,
  );
  await assert.rejects(
    f.service.create({ parent: root, folder: 'nested' }),
    /inside a registered space|登録済みスペースの内側/,
  );
  await assert.rejects(
    f.service.create({ parent: f.base, folder: '../escape' }),
    /name|フォルダ名/,
  );
  await assert.rejects(f.service.create({ parent: f.base, folder: '.hidden' }), /name|フォルダ名/);
});

test('a first commit a hook refuses leaves the hibachi created and says why', async (t) => {
  const f = await fixture(t);
  const root = await f.service.create({ parent: f.base, folder: 'Hooked' });
  await writeFile(path.join(root, '.git/hooks/pre-commit'), '#!/bin/sh\necho no >&2\nexit 1\n');
  await chmod(path.join(root, '.git/hooks/pre-commit'), 0o755);
  const space = await f.files.register(root, 'Hooked', 'team');
  const notice = await f.service.firstCommit(space.scopeId);
  assert.match(notice!, /hibachi was created|hibachi は作成しました/);
  assert.equal((await f.service.status(space.scopeId)).head, undefined);
});

test('an unregistered new folder is removed only while it holds what irori wrote', async (t) => {
  const f = await fixture(t);
  const empty = await f.service.create({ parent: f.base, folder: 'Unused' });
  await f.service.abandon(empty);
  await assert.rejects(readdir(empty), { code: 'ENOENT' });
  const kept = await f.service.create({ parent: f.base, folder: 'Kept' });
  await writeFile(path.join(kept, 'note.md'), '# Mine\n');
  await f.service.abandon(kept);
  assert.deepEqual((await readdir(kept)).sort(), ['.git', 'note.md']);
});

test('Start Git makes only an ordinary registered folder a repository', async (t) => {
  const f = await fixture(t);
  const plain = path.join(f.base, 'Plain');
  await mkdir(plain);
  await writeFile(path.join(plain, 'note.md'), '# Note\n');
  const space = await f.files.register(plain, 'Plain', 'personal');
  const before = await f.service.status(space.scopeId);
  assert.equal(before.available, false);
  assert.equal(before.initializable, true);
  const after = await f.service.init(space.scopeId);
  assert.equal(after.available, true);
  assert.equal(after.branch, 'main');
  assert.ok(after.changes.some((change) => change.path === 'note.md'));
  await assert.rejects(f.service.init(space.scopeId), /already a Git repository|すでに/);

  // A folder inside someone else's working tree is not offered a nested repository.
  const outer = path.join(f.base, 'Outer');
  await mkdir(path.join(outer, 'inner'), { recursive: true });
  git(outer, 'init', '--quiet');
  const inner = await f.files.register(path.join(outer, 'inner'), 'Inner', 'personal');
  const status = await f.service.status(inner.scopeId);
  assert.equal(status.available, false);
  assert.notEqual(status.initializable, true);
  await assert.rejects(f.service.init(inner.scopeId));
});

test('publishing creates the GitHub repository with gh, sets origin and pushes the branch', async (t) => {
  const f = await fixture(t);
  const { root, space } = await createHibachi(f);
  const account = await f.service.githubAccount();
  assert.deepEqual(account, { login: 'octo', organizations: ['team-a', 'team-b'] });
  const status = await f.service.status(space.scopeId);
  const published = await f.service.publish(
    space.scopeId,
    { owner: 'octo', name: 'kb', visibility: 'private', description: 'My notes' },
    status.version,
  );
  // The fixture's insteadOf rewrites what `remote get-url` shows; the configured URL is GitHub's.
  assert.equal(published.remote?.name, 'origin');
  assert.equal(published.remote?.branch, 'main');
  assert.equal(published.ahead, 0);
  assert.equal(published.behind, 0);
  assert.equal(git(root, 'config', 'remote.origin.url'), 'https://github.com/octo/kb.git');
  assert.equal(git(root, 'config', 'branch.main.remote'), 'origin');
  assert.equal(git(root, 'config', 'branch.main.merge'), 'refs/heads/main');
  assert.equal(git(path.join(f.base, 'remote.git'), 'rev-parse', 'main'), status.head);
  const calls = await f.calls();
  assert.ok(calls.includes('github.com|repo create octo/kb --private --description My notes'));
  assert.ok(
    calls.every((call) => call.startsWith('github.com|')),
    'gh always targets github.com',
  );

  // A hibachi that already has a remote is sent with Push, not published again.
  await assert.rejects(
    f.service.publish(
      space.scopeId,
      { owner: 'octo', name: 'kb2', visibility: 'private' },
      published.version,
    ),
    /already has a remote|すでにリモート/,
  );
});

test('publishing refuses a hibachi without a commit, and reports what GitHub refused', async (t) => {
  const f = await fixture(t, { exists: true });
  const plain = path.join(f.base, 'Empty');
  await mkdir(plain);
  const space = await f.files.register(plain, 'Empty', 'personal');
  const initialized = await f.service.init(space.scopeId);
  const input = { owner: 'octo', name: 'kb', visibility: 'private' } as const;
  await assert.rejects(
    f.service.publish(space.scopeId, input, initialized.version),
    /no commit|commit がありません/,
  );
  assert.equal((await f.calls()).length, 0, 'gh is not asked before the checks pass');

  const { space: made } = await createHibachi(f);
  const status = await f.service.status(made.scopeId);
  await assert.rejects(
    f.service.publish(made.scopeId, input, status.version),
    /already exists on GitHub|すでにあります/,
  );
  assert.equal((await f.service.status(made.scopeId)).remote, undefined, 'no remote is left');
  await assert.rejects(
    f.service.publish(made.scopeId, { ...input, name: 'bad name' }, status.version),
    /repository name|リポジトリ名/,
  );
});

test('a push that fails after the repository was created keeps origin for a later Push', async (t) => {
  const f = await fixture(t, { bare: false });
  const { root, space } = await createHibachi(f);
  const status = await f.service.status(space.scopeId);
  await assert.rejects(
    f.service.publish(
      space.scopeId,
      { owner: 'octo', name: 'kb', visibility: 'public' },
      status.version,
    ),
    /octo\/kb/,
  );
  assert.equal(git(root, 'config', 'remote.origin.url'), 'https://github.com/octo/kb.git');
  const after = await f.service.status(space.scopeId);
  assert.equal(after.remote?.name, 'origin');
  assert.equal(after.ahead, undefined, 'nothing is recorded as sent');
});

test('gh missing or signed out gives the next step, never the token', async (t) => {
  const base = await mkdtemp(path.join(tmpdir(), 'irori gh account '));
  t.after(() => rm(base, { recursive: true, force: true }));
  await assert.rejects(new GitHubCli(async () => undefined).account(), /gh auth login/);
  const gh = path.join(base, 'gh');
  await writeFile(
    gh,
    `#!/bin/sh\necho 'To get started with GitHub CLI, please run:  gh auth login' >&2\necho 'token ghp_0123456789abcdefghij0123' >&2\nexit 4\n`,
  );
  await chmod(gh, 0o755);
  await assert.rejects(new GitHubCli(async () => gh).account(), (error: Error) => {
    assert.match(error.message, /`gh auth login`/);
    assert.doesNotMatch(error.message, /ghp_/);
    return true;
  });
});

test('repository names follow GitHub and are suggested from a folder name', () => {
  for (const name of ['kb', 'my-notes', 'a.b_c', 'X'.repeat(100)])
    assert.ok(validRepositoryName(name));
  for (const name of ['', '.', '..', 'a b', 'kb.git', 'ノート', 'X'.repeat(101)])
    assert.ok(!validRepositoryName(name), name);
  assert.equal(suggestRepositoryName('My KB'), 'My-KB');
  assert.equal(suggestRepositoryName('研究ノート 2026'), '2026');
  assert.equal(suggestRepositoryName('ノート'), '');
  assert.equal(suggestRepositoryName('notes.git'), 'notes');
  assert.equal(suggestRepositoryName('Ｋｂ'), 'Kb');
});
