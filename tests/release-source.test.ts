import test from 'node:test';
import assert from 'node:assert/strict';
import {
  builtCommit,
  findPullRequestRun,
  resolveRun,
  type Api,
  type Git,
} from '../scripts/release-source';

const repo = 'owner/irori';
const head = 'a'.repeat(40);
const testMerge = 'b'.repeat(40);
const merged = 'c'.repeat(40);
const pushed = 'd'.repeat(40);

const artifacts = (sha: string) => ({
  artifacts: ['linux-x64', 'win32-x64', 'darwin-arm64'].map((platform) => ({
    name: `unsigned-irori-${platform}-${sha}`,
    expired: false,
  })),
});

function fixture(changes: { run?: object; builtTree?: string; onMain?: boolean } = {}) {
  const runs: Record<string, any> = {
    '1': {
      status: 'completed',
      conclusion: 'success',
      path: '.github/workflows/app.yml',
      event: 'pull_request',
      head_sha: head,
      head_repository: { full_name: repo },
      ...changes.run,
    },
    '2': {
      status: 'completed',
      conclusion: 'success',
      path: '.github/workflows/app.yml',
      event: 'push',
      head_sha: pushed,
      head_repository: { full_name: repo },
    },
  };
  const api: Api = (path) => {
    const run = /^repos\/owner\/irori\/actions\/runs\/(\d+)(\/artifacts.*)?$/.exec(path);
    if (run) return run[2] ? artifacts(run[1] === '1' ? testMerge : pushed) : runs[run[1]];
    if (path === `repos/${repo}/commits/${head}/pulls`)
      return [
        {
          number: 7,
          merged_at: '2026-10-12T00:00:00Z',
          base: { ref: 'main' },
          head: { sha: head },
          merge_commit_sha: merged,
        },
      ];
    if (path === `repos/${repo}/git/commits/${testMerge}`)
      return { tree: { sha: changes.builtTree ?? 'tree-of-merge' } };
    throw new Error(`Unexpected ${path}`);
  };
  const git: Git = (...args) => {
    if (args[0] === 'merge-base') {
      if (changes.onMain === false) throw new Error('not an ancestor');
      return '';
    }
    if (args[0] === 'rev-parse') return args[1] === `${merged}^{tree}` ? 'tree-of-merge' : 'other';
    throw new Error(`Unexpected git ${args.join(' ')}`);
  };
  return { api, git };
}

test('The package artifacts name the one commit a run built', () => {
  assert.equal(builtCommit(artifacts(testMerge).artifacts.map((item) => item.name)), testMerge);
  assert.throws(() => builtCommit([]), /found 0/);
  assert.throws(
    () => builtCommit([`unsigned-irori-linux-x64-${head}`, `unsigned-irori-win32-x64-${pushed}`]),
    /found 2/,
  );
});

test("A pull request's run publishes main's merge when it packaged the same tree", () => {
  const { api, git } = fixture();
  assert.deepEqual(resolveRun(repo, '1', api, git), {
    commit: merged,
    built: testMerge,
    tree: 'tree-of-merge',
    pullRequest: 7,
  });
});

test("A pull request's run is refused once main moved before the merge", () => {
  const { api, git } = fixture({ builtTree: 'tree-before-main-moved' });
  assert.throws(() => resolveRun(repo, '1', api, git), /main changed after the run/);
});

test('An earlier head of a merged pull request is not what main received', () => {
  const { api, git } = fixture({ run: { head_sha: 'e'.repeat(40) } });
  const lookups: Api = (path) =>
    path.endsWith(`/commits/${'e'.repeat(40)}/pulls`)
      ? [{ number: 7, merged_at: 'x', base: { ref: 'main' }, head: { sha: head } }]
      : api(path);
  assert.throws(() => resolveRun(repo, '1', lookups, git), /no pull request merged into main/);
});

test('Failed, foreign and off-main runs are refused', () => {
  for (const [changes, message] of [
    [{ run: { conclusion: 'failure' } }, /did not succeed/],
    [{ run: { status: 'in_progress' } }, /not completed/],
    [{ run: { path: '.github/workflows/website.yml' } }, /not a verify and package run/],
    [{ run: { head_repository: { full_name: 'fork/irori' } } }, /outside owner\/irori/],
    [{ onMain: false }, /is not on main/],
  ] as const) {
    const { api, git } = fixture(changes);
    assert.throws(() => resolveRun(repo, '1', api, git), message);
  }
});

test("main's own run publishes the commit it packaged", () => {
  const { api } = fixture();
  const git: Git = (...args) => (args[0] === 'rev-parse' ? 'tree-of-push' : '');
  assert.deepEqual(resolveRun(repo, '2', api, git), {
    commit: pushed,
    built: pushed,
    tree: 'tree-of-push',
    pullRequest: undefined,
  });
});

test('A merge commit leads to its pull request run, and a direct push to none', () => {
  const api: Api = (path) => {
    if (path === `repos/${repo}/commits/${merged}/pulls`)
      return [{ merge_commit_sha: merged, base: { ref: 'main' }, head: { sha: head } }];
    if (path === `repos/${repo}/commits/${pushed}/pulls`) return [];
    if (path.includes(`head_sha=${head}`)) return { workflow_runs: [{ id: 41 }] };
    throw new Error(`Unexpected ${path}`);
  };
  assert.equal(findPullRequestRun(repo, merged, api), '41');
  assert.equal(findPullRequestRun(repo, pushed, api), undefined);
});
