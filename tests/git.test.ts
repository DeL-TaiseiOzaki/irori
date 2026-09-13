import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  rename,
  symlink,
  readdir,
  chmod,
} from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { FileService } from '../src/host/files';
import { GitService } from '../src/git/service';

function git(root: string, ...args: string[]) {
  return execFileSync(
    'git',
    [
      '-c',
      'user.name=Git fixture',
      '-c',
      'user.email=fixture@example.invalid',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trimEnd();
}
async function fixture(t: any, initial = true) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori git 日本語 '));
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const root = path.join(base, 'KB');
  await mkdir(root);
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'Git fixture');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'config', 'commit.gpgsign', 'false');
  const space = await files.register(root, 'Personal', 'personal');
  await writeFile(path.join(root, '日本語 note.md'), '# Notes\n\nOriginal\n');
  await writeFile(path.join(root, 'other.md'), '# Other\n');
  if (initial) {
    git(root, 'add', '.');
    git(root, 'commit', '-m', 'Initial notes');
  }
  const service = new GitService(files);
  t.after(async () => {
    await service.close();
    await rm(base, { recursive: true, force: true });
  });
  return { base, root, files, space, service };
}
async function stage(service: GitService, id: string, p: string) {
  const diff = await service.diff(id, p, false);
  return service.stage(id, p, true, diff.version);
}
async function remoteFixture(t: any) {
  const f = await fixture(t);
  const remote = path.join(f.base, 'remote.git'),
    peer = path.join(f.base, 'peer');
  git(f.base, 'init', '--bare', '--initial-branch=main', remote);
  git(f.root, 'remote', 'add', 'origin', remote);
  git(f.root, 'push', '-u', 'origin', 'main');
  git(f.base, 'clone', remote, peer);
  return { ...f, remote, peer };
}

test('Git review preserves partial staging and commits only the displayed index in the owning repository', async (t) => {
  const { service, space, root, files, base } = await fixture(t);
  const team = path.join(base, 'Team');
  await mkdir(team);
  git(team, 'init', '-b', 'main');
  const other = await files.register(team, 'Team', 'team');
  await writeFile(path.join(team, 'other.md'), 'Team bytes');
  await writeFile(path.join(root, '日本語 note.md'), '# Notes\n\nStaged 日本語\n');
  await stage(service, space.scopeId, '日本語 note.md');
  await writeFile(path.join(root, '日本語 note.md'), '# Notes\n\nLater unstaged\n');
  await writeFile(path.join(root, 'other.md'), '# Other pending\n');
  const state = await service.status(space.scopeId);
  assert.equal(state.available, true);
  assert.equal(state.branch, 'main');
  assert.equal(state.remote, undefined);
  assert.equal(state.changes.find((c) => c.path === '日本語 note.md')?.index, 'M');
  assert.match((await service.diff(space.scopeId, '日本語 note.md', true)).patch, /Staged 日本語/);
  assert.match(
    (await service.diff(space.scopeId, '日本語 note.md', false)).patch,
    /Later unstaged/,
  );
  await service.commit(space.scopeId, '保存した日本語の変更', state.version);
  assert.match(git(root, 'show', 'HEAD:日本語 note.md'), /Staged 日本語/);
  assert.match(await readFile(path.join(root, '日本語 note.md'), 'utf8'), /Later unstaged/);
  assert.equal(git(root, 'show', 'HEAD:other.md'), '# Other');
  assert.equal((await service.status(other.scopeId)).head, undefined);
  const history = await service.history(space.scopeId);
  assert.equal(history.commits[0].subject, '保存した日本語の変更');
  assert.match(await service.commitDiff(space.scopeId, history.commits[0].oid), /Staged 日本語/);
});

test('literal Git paths, untracked files, initial commit, rename and deletion remain exact', async (t) => {
  const { service, space, root } = await fixture(t, false);
  for (const name of ['[set]*.md', '--flag.md', 'line\nbreak.md']) {
    await writeFile(path.join(root, name), 'Literal 日本語\n');
    await stage(service, space.scopeId, name);
  }
  let state = await service.status(space.scopeId);
  await service.commit(space.scopeId, 'Three exact paths', state.version);
  assert.deepEqual(
    git(root, 'ls-tree', '--name-only', '-z', 'HEAD').split('\0').filter(Boolean).sort(),
    ['[set]*.md', '--flag.md', 'line\nbreak.md'].sort(),
  );
  await rename(path.join(root, '[set]*.md'), path.join(root, 'renamed.md'));
  await stage(service, space.scopeId, '[set]*.md');
  await stage(service, space.scopeId, 'renamed.md');
  const unstage = await service.diff(space.scopeId, 'renamed.md', true);
  await service.stage(space.scopeId, 'renamed.md', false, unstage.version);
  assert.equal(await readFile(path.join(root, 'renamed.md'), 'utf8'), 'Literal 日本語\n');
  state = await service.status(space.scopeId);
  await service.commit(space.scopeId, 'Delete only original', state.version);
  assert.doesNotMatch(git(root, 'ls-tree', '--name-only', 'HEAD'), /renamed/);
});

test('stale diff and commit reviews are rejected; operations cannot overlap agents or saves', async (t) => {
  const { service, space, root, files } = await fixture(t);
  await writeFile(path.join(root, 'other.md'), 'First change\n');
  const diff = await service.diff(space.scopeId, 'other.md', false);
  await writeFile(path.join(root, 'other.md'), 'Second change\n');
  await assert.rejects(service.stage(space.scopeId, 'other.md', true, diff.version), /確認後/);
  await stage(service, space.scopeId, 'other.md');
  const state = await service.status(space.scopeId);
  await writeFile(path.join(root, '日本語 note.md'), 'Unexpected extra\n');
  git(root, 'add', '日本語 note.md');
  await assert.rejects(service.commit(space.scopeId, 'Stale review', state.version), /確認後/);
  const locked = new GitService(files, () => false);
  await assert.rejects(locked.commit(space.scopeId, 'Busy', state.version), /完了後/);
  assert.equal(git(root, 'log', '-1', '--format=%s'), 'Initial notes');
});

test('Git protects contents, nested scopes, aliases and pre-staged foreign files', async (t) => {
  const { service, space, root, files, base } = await fixture(t);
  await mkdir(path.join(root, 'contents'));
  await writeFile(path.join(root, 'contents/private.md'), 'Cloud bytes');
  git(root, 'add', '-f', 'contents/private.md');
  const nested = path.join(root, 'team');
  await mkdir(nested);
  git(nested, 'init', '-b', 'main');
  await files.register(nested, 'Nested', 'team');
  await writeFile(path.join(nested, 'team-only.md'), 'Team bytes');
  await symlink(path.join(base, 'device'), path.join(root, 'alias'));
  let status = await service.status(space.scopeId);
  assert.ok(status.changes.find((c) => c.path === 'contents/private.md')?.blocked);
  assert.ok(status.changes.find((c) => c.path === 'alias')?.blocked);
  assert.ok(!status.changes.some((c) => c.path.includes('team-only')));
  await assert.rejects(service.commit(space.scopeId, 'Wrong scope', status.version), /クラウド/);
  const diff = await service.diff(space.scopeId, 'contents/private.md', true);
  status = await service.stage(space.scopeId, 'contents/private.md', false, diff.version);
  assert.ok(!status.changes.some((c) => c.path.startsWith('contents/')));
  assert.equal(await readFile(path.join(root, 'contents/private.md'), 'utf8'), 'Cloud bytes');
  await assert.rejects(service.diff(space.scopeId, '../device/spaces.json', false));
});

test('fetch, fast-forward receive and exact-branch push use real local remotes', async (t) => {
  const { service, space, root, remote, peer } = await remoteFixture(t);
  await writeFile(path.join(peer, 'other.md'), 'Peer update\n');
  git(peer, 'add', 'other.md');
  git(peer, 'commit', '-m', 'Peer change');
  git(peer, 'push', 'origin', 'main');
  let status = await service.status(space.scopeId);
  status = await service.sync(space.scopeId, 'fetch', status.version);
  assert.equal(status.behind, 1);
  assert.ok(status.fetchedAt);
  assert.equal(await readFile(path.join(root, 'other.md'), 'utf8'), '# Other\n');
  status = await service.sync(space.scopeId, 'pull', status.version);
  assert.equal(await readFile(path.join(root, 'other.md'), 'utf8'), 'Peer update\n');
  await writeFile(path.join(root, '日本語 note.md'), 'Local change\n');
  await stage(service, space.scopeId, '日本語 note.md');
  status = await service.status(space.scopeId);
  status = await service.commit(space.scopeId, 'Local share', status.version);
  git(root, 'branch', 'private');
  git(root, 'tag', '-a', 'private-tag', '-m', 'Private annotated tag');
  git(root, 'config', 'remote.origin.push', 'refs/heads/private:refs/heads/private');
  git(root, 'config', 'push.followTags', 'true');
  status = await service.status(space.scopeId);
  await service.sync(space.scopeId, 'push', status.version);
  assert.equal(git(remote, 'rev-parse', 'main'), git(root, 'rev-parse', 'HEAD'));
  assert.equal(git(remote, 'for-each-ref', '--format=%(refname)'), 'refs/heads/main');
});

test('divergent edits survive rejected push and resolve through native merge with durable copies', async (t) => {
  const { service, space, root, peer, files, remote } = await remoteFixture(t);
  await writeFile(path.join(root, '日本語 note.md'), '# Local 日本語\n');
  await stage(service, space.scopeId, '日本語 note.md');
  await service.commit(space.scopeId, 'Local', (await service.status(space.scopeId)).version);
  await writeFile(path.join(peer, '日本語 note.md'), '# Peer 日本語\n');
  git(peer, 'add', '.');
  git(peer, 'commit', '-m', 'Peer');
  git(peer, 'push', 'origin', 'main');
  const localHead = git(root, 'rev-parse', 'HEAD');
  await assert.rejects(
    service.sync(space.scopeId, 'push', (await service.status(space.scopeId)).version),
    /受け付け|Git 操作/,
  );
  assert.equal(git(root, 'rev-parse', 'HEAD'), localHead);
  await assert.rejects(
    service.sync(space.scopeId, 'pull', (await service.status(space.scopeId)).version),
    /分岐/,
  );
  let status = await service.sync(
    space.scopeId,
    'merge',
    (await service.status(space.scopeId)).version,
  );
  assert.equal(status.operation, 'merge');
  assert.ok(status.changes.some((c) => c.conflict));
  const conflict = await service.conflict(space.scopeId, '日本語 note.md');
  assert.equal(conflict.ours, '# Local 日本語\n');
  assert.equal(conflict.theirs, '# Peer 日本語\n');
  assert.match(conflict.base!, /Original/);
  await assert.rejects(
    service.resolve(space.scopeId, conflict.path, conflict.working!, conflict.version),
    /マーカー/,
  );
  status = await service.resolve(
    space.scopeId,
    conflict.path,
    '# Combined\n\nLocal 日本語\nPeer 日本語\n',
    conflict.version,
  );
  const backups = await readdir(path.join(files.dataDir, 'git-recovery'));
  assert.equal(backups.length, 1);
  assert.match(
    await readFile(path.join(files.dataDir, 'git-recovery', backups[0]), 'utf8'),
    /Local 日本語/,
  );
  assert.ok(!status.changes.some((c) => c.conflict));
  status = await service.commit(space.scopeId, 'Combine both notes', status.version);
  assert.equal(status.operation, 'none');
  assert.equal(git(root, 'rev-list', '--parents', '-n', '1', 'HEAD').split(' ').length, 3);
  await service.sync(space.scopeId, 'push', status.version);
  assert.match(git(remote, 'show', 'main:日本語 note.md'), /Local 日本語\nPeer 日本語/);
});

test('receive refuses dirty work and incoming changes to cloud contents or scope identity', async (t) => {
  const { service, space, root, peer } = await remoteFixture(t);
  await writeFile(path.join(root, 'other.md'), 'Keep dirty bytes\n');
  await assert.rejects(
    service.sync(space.scopeId, 'pull', (await service.status(space.scopeId)).version),
    /commit/,
  );
  assert.equal(await readFile(path.join(root, 'other.md'), 'utf8'), 'Keep dirty bytes\n');
  git(root, 'add', 'other.md');
  git(root, 'commit', '-m', 'Keep dirty bytes');
  await mkdir(path.join(peer, 'contents'));
  await writeFile(path.join(peer, 'contents/injected.md'), 'Wrong layer');
  git(peer, 'add', '-f', 'contents/injected.md');
  git(peer, 'commit', '-m', 'Invalid cloud storage');
  git(peer, 'push');
  const before = git(root, 'rev-parse', 'HEAD');
  await assert.rejects(
    service.sync(space.scopeId, 'merge', (await service.status(space.scopeId)).version),
    /クラウド/,
  );
  assert.equal(git(root, 'rev-parse', 'HEAD'), before);
});

test('clone validates URLs, reserved destinations and credentials without network side effects', async (t) => {
  const { service, base, root } = await fixture(t);
  for (const url of [
    'https://token@github.com/org/repo.git',
    'https://github.com/org/repo.git?token=secret',
    '--upload-pack=touch',
    'file:///private/repo',
    'https://example.com/org/repo.git',
  ]) {
    await assert.rejects(service.clone({ url, parent: base, name: 'new' }), /URL/);
  }
  await assert.rejects(
    service.clone({ url: 'https://github.com/org/repo.git', parent: base, name: 'KB' }),
    /同じ名前/,
  );
  await assert.rejects(
    service.clone({ url: 'https://github.com/org/repo.git', parent: root, name: 'nested' }),
    /スペースの外/,
  );
  assert.equal(git(root, 'log', '-1', '--format=%s'), 'Initial notes');
});

test('duplicate commits serialize, native hook rejection preserves the index, and diagnostics omit credentials', async (t) => {
  const { service, space, root } = await fixture(t);
  await writeFile(path.join(root, 'other.md'), 'Reviewed bytes\n');
  await stage(service, space.scopeId, 'other.md');
  const hook = path.join(root, '.git/hooks/pre-commit');
  await writeFile(
    hook,
    '#!/bin/sh\nprintf "https://synthetic-secret@github.com/fixture/private\\n" >&2\nexit 1\n',
  );
  await chmod(hook, 0o700);
  const before = git(root, 'write-tree');
  await assert.rejects(
    service.commit(
      space.scopeId,
      'Blocked by native hook',
      (await service.status(space.scopeId)).version,
    ),
    (error: Error) => {
      assert.doesNotMatch(error.message, /synthetic-secret/);
      return true;
    },
  );
  assert.equal(git(root, 'write-tree'), before);
  assert.equal(git(root, 'log', '-1', '--format=%s'), 'Initial notes');
  await rm(hook);
  const state = await service.status(space.scopeId);
  const results = await Promise.allSettled([
    service.commit(space.scopeId, 'Reviewed once', state.version),
    service.commit(space.scopeId, 'Duplicate click', state.version),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    ['fulfilled', 'rejected'],
  );
  assert.equal(git(root, 'rev-list', '--count', 'HEAD'), '2');
  assert.equal(service.busy, false);
});

test('an initial staged file can be unselected after further editing without deleting work', async (t) => {
  const { service, space, root } = await fixture(t, false);
  await stage(service, space.scopeId, 'other.md');
  await writeFile(path.join(root, 'other.md'), 'Keep latest work\n');
  const diff = await service.diff(space.scopeId, 'other.md', true);
  await service.stage(space.scopeId, 'other.md', false, diff.version);
  assert.equal(git(root, 'ls-files', '--', 'other.md'), '');
  assert.equal(await readFile(path.join(root, 'other.md'), 'utf8'), 'Keep latest work\n');
});

test('delete/modify conflict preserves the deleted version in recovery and completes a native merge', async (t) => {
  const { service, space, root, peer, files } = await remoteFixture(t);
  await writeFile(path.join(root, 'other.md'), 'Keep in recovery 日本語\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'Local edit');
  git(peer, 'rm', 'other.md');
  git(peer, 'commit', '-m', 'Peer deletion');
  git(peer, 'push');
  await service.sync(space.scopeId, 'merge', (await service.status(space.scopeId)).version);
  const conflict = await service.conflict(space.scopeId, 'other.md');
  assert.equal(conflict.theirs, undefined);
  assert.equal(conflict.editable, true);
  const status = await service.resolve(space.scopeId, 'other.md', null, conflict.version);
  await assert.rejects(readFile(path.join(root, 'other.md')), { code: 'ENOENT' });
  const [backup] = await readdir(path.join(files.dataDir, 'git-recovery'));
  assert.match(
    await readFile(path.join(files.dataDir, 'git-recovery', backup), 'utf8'),
    /Keep in recovery 日本語/,
  );
  await service.commit(space.scopeId, 'Accept reviewed deletion', status.version);
  assert.equal((await service.status(space.scopeId)).operation, 'none');
});

test('remote retargeting invalidates a share review and multiple destinations cannot broaden a push', async (t) => {
  const { service, space, root, base } = await remoteFixture(t);
  const second = path.join(base, 'other-remote.git');
  git(base, 'init', '--bare', second);
  const status = await service.status(space.scopeId);
  git(root, 'remote', 'set-url', '--push', 'origin', second);
  await assert.rejects(service.sync(space.scopeId, 'push', status.version), /確認後/);
  git(root, 'remote', 'set-url', '--add', '--push', 'origin', second + '-unavailable');
  await assert.rejects(
    service.sync(space.scopeId, 'push', (await service.status(space.scopeId)).version),
    /複数/,
  );
  assert.equal(git(second, 'for-each-ref', '--format=%(refname)'), '');
});

test('linked worktrees keep their own index and operation markers', async (t) => {
  const { root, base, service: original, space: originalSpace } = await fixture(t);
  const linked = path.join(base, 'Linked 日本語');
  git(root, 'worktree', 'add', '-b', 'linked', linked);
  // A separate device registration can open the same portable KB identity in a worktree.
  const files = new FileService(path.join(base, 'linked-device'));
  await files.init();
  const space = await files.register(linked, 'Linked', 'personal');
  const service = new GitService(files);
  t.after(() => service.close());
  await writeFile(path.join(linked, 'other.md'), 'Linked change 日本語\n');
  await stage(service, space.scopeId, 'other.md');
  assert.equal(git(linked, 'show', ':other.md'), 'Linked change 日本語');
  assert.equal(git(root, 'show', ':other.md'), '# Other');
  const directory = git(linked, 'rev-parse', '--absolute-git-dir');
  for (const marker of [
    'rebase-merge',
    'rebase-apply',
    'CHERRY_PICK_HEAD',
    'REVERT_HEAD',
    'sequencer',
    'MERGE_HEAD',
  ]) {
    await writeFile(path.join(directory, marker), git(linked, 'rev-parse', 'HEAD') + '\n');
    assert.equal(
      (await service.status(space.scopeId)).operation,
      marker === 'MERGE_HEAD' ? 'merge' : 'other',
    );
    assert.equal((await original.status(originalSpace.scopeId)).operation, 'none');
    await rm(path.join(directory, marker));
  }
  const review = await service.diff(space.scopeId, 'other.md', true);
  await service.stage(space.scopeId, 'other.md', false, review.version);
  assert.equal(await readFile(path.join(linked, 'other.md'), 'utf8'), 'Linked change 日本語\n');
  assert.equal((await original.status(originalSpace.scopeId)).changes.length, 0);
});

test('Bulk staging uses exact path lists, preserves unselected partial staging, and unstages without changing bytes', async (t) => {
  const { service, space, root } = await fixture(t);
  const id = space.scopeId;
  await writeFile(path.join(root, 'other.md'), 'staged');
  await stage(service, id, 'other.md');
  await writeFile(path.join(root, 'other.md'), 'unstaged');
  const names = ['--日本語.md', 'image.png', '日本語 note.md'];
  for (const name of names)
    await writeFile(
      path.join(root, name),
      name === 'image.png' ? Buffer.from([0, 1, 2]) : 'changed',
    );
  const before = await service.status(id);
  const added = await service.stageMany(id, names, true, before.version);
  assert.equal(git(root, 'show', ':other.md'), 'staged');
  assert.equal(added.changes.filter((c) => c.index !== ' ').length, 4);
  await assert.rejects(service.stageMany(id, names, false, before.version), /確認後/);
  const unstaged = await service.stageMany(id, names, false, added.version);
  assert.equal(unstaged.changes.find((c) => c.path === 'other.md')?.index, 'M');
  assert.deepEqual(await readFile(path.join(root, 'image.png')), Buffer.from([0, 1, 2]));
  await assert.rejects(service.stageMany(id, ['contents/private.md'], true, unstaged.version));
});
