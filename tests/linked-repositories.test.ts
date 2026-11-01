import { test } from 'node:test';
import assert from 'node:assert/strict';
import { githubPage, linkedRepositories } from '../src/domain/git';

test('githubPage opens a repository at its branch, keeping the slashes of a branch name', () => {
  assert.equal(githubPage('acme/notes'), 'https://github.com/acme/notes');
  assert.equal(githubPage('acme/notes', 'main'), 'https://github.com/acme/notes/tree/main');
  assert.equal(
    githubPage('acme/notes', 'feat/a#b'),
    'https://github.com/acme/notes/tree/feat/a%23b',
  );
});

test('linkedRepositories lists the vault, its submodules and its GitHub connections', () => {
  const list = linkedRepositories(
    {
      available: true,
      branch: 'main',
      remote: {
        name: 'origin',
        label: 'acme/notes',
        fetchLabel: 'acme/notes',
        repository: 'acme/notes',
        branch: 'main',
      },
    },
    [
      {
        path: 'wiki/tools',
        name: 'tools',
        repository: 'acme/tools',
        initialized: true,
        branch: 'dev',
      },
      { path: 'wiki/api', name: 'api', repository: 'acme/api', initialized: false },
    ],
    [
      { provider: 'local', contentsRoot: 'contents', name: 'drive', state: 'mounted' },
      {
        provider: 'github',
        url: 'git@github.com:acme/app.git',
        branch: 'release',
        contentsRoot: 'contents',
        name: 'app',
        state: 'unconfigured',
      },
    ],
  );
  assert.deepEqual(list, [
    { kind: 'vault', place: '', repository: 'acme/notes', branch: 'main', remote: undefined },
    {
      kind: 'submodule',
      place: 'wiki/api',
      repository: 'acme/api',
      branch: undefined,
      absent: true,
    },
    {
      kind: 'submodule',
      place: 'wiki/tools',
      repository: 'acme/tools',
      branch: 'dev',
      absent: false,
    },
    {
      kind: 'contents',
      place: 'contents/app',
      repository: 'acme/app',
      branch: 'release',
      absent: true,
    },
  ]);
});

test('linkedRepositories names a remote that is not on GitHub and skips a folder without Git', () => {
  const remote = { name: 'origin', label: 'origin', fetchLabel: 'origin', branch: 'main' };
  assert.deepEqual(linkedRepositories({ available: true, branch: 'main', remote }, [], []), [
    { kind: 'vault', place: '', repository: undefined, branch: 'main', remote: 'origin' },
  ]);
  assert.deepEqual(linkedRepositories({ available: false }, [], []), []);
});
