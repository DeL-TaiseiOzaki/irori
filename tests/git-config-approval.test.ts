import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  approveGitConfig,
  configEntries,
  GitConfigApprovals,
  gitConfigRuns,
} from '../src/git/config-approval';
import { GitProcess } from '../src/git/process';

async function repository(t: test.TestContext) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori git config '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'repo');
  await mkdir(root);
  execFileSync('git', ['init', '--quiet', root]);
  return { base, root };
}

test('config entries are read with the keys Git compares', () => {
  assert.deepEqual(
    configEntries(
      '[core]\n\thooksPath = .h\n[filter "LFS"]\n  clean = x %f\n[includeIf "gitdir:~/"]\npath = a\n[credential] helper\n',
    ),
    [
      ['core.hookspath', '.h'],
      ['filter.LFS.clean', 'x %f'],
      ['includeif.gitdir:~/.path', 'a'],
      ['credential.helper', 'true'],
    ],
  );
});

test('a plain repository needs no leave; programs in its configuration and hooks do', async (t) => {
  const { root } = await repository(t);
  assert.equal(await gitConfigRuns(root), undefined);
  await writeFile(path.join(root, '.git', 'config'), '[filter "x"]\n\tclean = run-me\n', {
    flag: 'a',
  });
  await writeFile(path.join(root, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\n');
  const runs = await gitConfigRuns(path.join(root));
  assert.deepEqual(runs?.found, ['filter.x.clean = run-me', 'hooks/pre-commit']);
});

test('Git does not run where the person refused, and asks once when they allow', async (t) => {
  const { base, root } = await repository(t);
  await writeFile(path.join(root, '.git', 'config'), '[core]\n\tsshCommand = run-me\n', {
    flag: 'a',
  });
  const asked: string[][] = [];
  let answer = false;
  approveGitConfig(
    new GitConfigApprovals(path.join(base, 'data', 'git.json'), async (_folder, found) => {
      asked.push(found);
      return answer;
    }),
  );
  t.after(() => approveGitConfig(undefined));
  const git = new GitProcess();
  t.after(() => git.close());
  await assert.rejects(git.run(root, ['status', '--porcelain']), /許可されていない|not allowed/);
  // A refusal is remembered for the session: automatic reads do not ask again.
  await assert.rejects(git.run(root, ['status', '--porcelain']), /許可されていない|not allowed/);
  assert.equal(asked.length, 1);
  approveGitConfig(
    new GitConfigApprovals(path.join(base, 'data', 'git.json'), async (_folder, found) => {
      asked.push(found);
      return (answer = true);
    }),
  );
  assert.equal(await git.run(root, ['status', '--porcelain']), '');
  assert.equal(await git.run(root, ['status', '--porcelain']), '');
  assert.equal(asked.length, 2);
});
