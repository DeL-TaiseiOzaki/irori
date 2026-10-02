import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { FileService } from '../src/host/files';
import { GitService } from '../src/git/service';
import type { GitTarget } from '../src/domain/git';

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
      '-c',
      'protocol.file.allow=always',
      ...args,
    ],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trimEnd();
}
function identity(root: string) {
  git(root, 'config', 'user.name', 'Git fixture');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'config', 'commit.gpgsign', 'false');
}

/** Bare repositories directly in `base` stand in for GitHub, fetched over `file`. */
async function device(t: any, base: string, name: string) {
  const files = new FileService(path.join(base, name));
  await files.init();
  const service = new GitService(files, undefined, undefined, undefined, undefined, {
    accepts: (url: string) => path.dirname(url) === base && url.endsWith('.git'),
    protocols: ['file'],
  });
  t.after(() => service.close());
  return { files, service };
}

async function fixture(t: any) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori submodule 日本語 '));
  t.after(() => rm(base, { recursive: true, force: true }));
  // The repository that becomes a submodule, with one note on `main`.
  const library = path.join(base, 'library.git'),
    seed = path.join(base, 'seed');
  git(base, 'init', '--bare', '--initial-branch=main', library);
  git(base, 'clone', library, seed);
  identity(seed);
  await writeFile(path.join(seed, 'doc.md'), '# Library\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '-m', 'Library note');
  git(seed, 'push', 'origin', 'HEAD:main');
  // The hibachi, with a remote of its own.
  const hibachi = path.join(base, 'hibachi.git'),
    root = path.join(base, 'KB');
  git(base, 'init', '--bare', '--initial-branch=main', hibachi);
  await mkdir(root);
  git(root, 'init', '-b', 'main');
  identity(root);
  const a = await device(t, base, 'device-a');
  const space = await a.files.register(root, 'Main', 'personal');
  await writeFile(path.join(root, 'index.md'), '# Main\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'Main hibachi');
  git(root, 'remote', 'add', 'origin', hibachi);
  git(root, 'push', '-u', 'origin', 'main');
  return { base, library, hibachi, root, space, ...a };
}

/** Device B: a plain clone of the hibachi, registered on a device of its own. */
async function peer(t: any, f: Awaited<ReturnType<typeof fixture>>) {
  const root = path.join(f.base, 'peer');
  git(f.base, 'clone', f.hibachi, root);
  identity(root);
  const b = await device(t, f.base, 'device-b');
  await b.files.register(root, 'Main', 'personal');
  return { root, ...b };
}

async function commitAll(service: GitService, target: GitTarget, message: string) {
  let state = await service.status(target);
  const paths = state.changes.filter((c) => c.worktree !== ' ').map((c) => c.path);
  if (paths.length) state = await service.stageMany(target, paths, true, state.version);
  return service.commit(target, message, state.version);
}
async function push(service: GitService, target: GitTarget) {
  return service.sync(target, 'push', (await service.status(target)).version);
}

test('a submodule is cloned into the hibachi, edited, committed and pushed in its own repository', async (t) => {
  const { service, space, root, library, base } = await fixture(t);
  const id = space.scopeId;
  const added = await service.addSubmodule(id, { url: library, path: 'projects/library' });
  assert.deepEqual(
    added.submodules.map(({ path, initialized, branch, changed }) => ({
      path,
      initialized,
      branch,
      changed,
    })),
    [{ path: 'projects/library', initialized: true, branch: 'main', changed: false }],
  );
  // The hibachi stages the submodule and its declaration, ready to commit.
  let main = await service.status(id);
  assert.deepEqual(main.changes.map((c) => [c.path, c.index, c.blocked]).sort(), [
    ['.gitmodules', 'A', undefined],
    ['projects/library', 'A', undefined],
  ]);
  await service.commit(id, 'Add the library', main.version);
  const sub = { scopeId: id, repository: 'projects/library' };
  await writeFile(path.join(root, 'projects/library/doc.md'), '# Library\n\nEdited here\n');
  // The edit is the submodule's; the hibachi does not list the file.
  assert.deepEqual((await service.status(id)).changes, []);
  let state = await service.status(sub);
  assert.equal(state.branch, 'main');
  assert.deepEqual(
    state.changes.map((c) => c.path),
    ['doc.md'],
  );
  assert.match((await service.diff(sub, 'doc.md', false)).patch, /Edited here/);
  await commitAll(service, sub, 'Edit the library');
  state = await push(service, sub);
  assert.equal(state.ahead, 0);
  assert.equal(
    git(base, `--git-dir=${library}`, 'log', '-1', '--format=%s', 'main'),
    'Edit the library',
  );
  // The hibachi now records a newer commit of the submodule, which it commits and pushes.
  main = await service.status(id);
  assert.deepEqual(
    main.changes.map((c) => [c.path, c.worktree, c.blocked]),
    [['projects/library', 'M', undefined]],
  );
  assert.match((await service.diff(id, 'projects/library', false)).patch, /Edit the library/);
  await commitAll(service, id, 'Move the library');
  main = await push(service, id);
  assert.equal(main.ahead, 0);
  assert.deepEqual(main.changes, []);
  // History is the submodule's own.
  assert.deepEqual(
    (await service.history(sub)).commits.map((c) => c.subject),
    ['Edit the library', 'Library note'],
  );
});

test('another device fetches the submodule on its branch and a pull moves it along', async (t) => {
  const f = await fixture(t);
  const id = f.space.scopeId;
  await f.service.addSubmodule(id, { url: f.library, path: 'library' });
  await commitAll(f.service, id, 'Add the library');
  await push(f.service, id);
  const b = await peer(t, f);
  let listed = await b.service.submodules(id);
  assert.deepEqual(
    listed.submodules.map((m) => [m.path, m.initialized]),
    [['library', false]],
  );
  assert.equal((await b.service.status({ scopeId: id, repository: 'library' })).available, false);
  listed = await b.service.initSubmodules(id, 'library');
  assert.equal(listed.notice, undefined);
  assert.deepEqual(
    listed.submodules.map((m) => [m.path, m.initialized, m.branch]),
    [['library', true, 'main']],
  );
  assert.equal(await readFile(path.join(b.root, 'library/doc.md'), 'utf8'), '# Library\n');
  assert.deepEqual((await b.service.status(id)).changes, []);
  // Device A moves the submodule and records that in the hibachi.
  const subA = { scopeId: id, repository: 'library' };
  await writeFile(path.join(f.root, 'library/doc.md'), '# Library\n\nFrom device A\n');
  await commitAll(f.service, subA, 'From device A');
  await push(f.service, subA);
  await commitAll(f.service, id, 'Record the library');
  await push(f.service, id);
  // Device B's pull of the hibachi fetches the submodule's commit and moves it there.
  const main = await b.service.sync(id, 'pull', (await b.service.status(id)).version);
  assert.equal(main.notice, undefined);
  assert.deepEqual(main.changes, []);
  assert.match(await readFile(path.join(b.root, 'library/doc.md'), 'utf8'), /From device A/);
  const state = await b.service.status({ scopeId: id, repository: 'library' });
  assert.equal(state.branch, 'main');
  assert.deepEqual(state.changes, []);
});

test('a pull leaves a submodule with its own uncommitted edit where it is, and says so', async (t) => {
  const f = await fixture(t);
  const id = f.space.scopeId;
  await f.service.addSubmodule(id, { url: f.library, path: 'library' });
  await commitAll(f.service, id, 'Add the library');
  await push(f.service, id);
  const b = await peer(t, f);
  await b.service.initSubmodules(id);
  await writeFile(path.join(b.root, 'library/doc.md'), '# Library\n\nUnfinished on B\n');
  const subA = { scopeId: id, repository: 'library' };
  await writeFile(path.join(f.root, 'library/doc.md'), '# Library\n\nFrom device A\n');
  await commitAll(f.service, subA, 'From device A');
  await push(f.service, subA);
  await commitAll(f.service, id, 'Record the library');
  await push(f.service, id);
  const main = await b.service.sync(id, 'pull', (await b.service.status(id)).version);
  assert.match(main.notice ?? '', /library/);
  assert.match(await readFile(path.join(b.root, 'library/doc.md'), 'utf8'), /Unfinished on B/);
  // The hibachi shows that its submodule is not on the recorded commit.
  assert.deepEqual(
    main.changes.map((c) => c.path),
    ['library'],
  );
});

test('submodules come only from allowed remotes and never into contents, Schema or a file', async (t) => {
  const f = await fixture(t);
  const id = f.space.scopeId;
  await assert.rejects(
    f.service.addSubmodule(id, { url: 'https://example.com/library.git', path: 'library' }),
    /GitHub/,
  );
  await assert.rejects(
    f.service.addSubmodule(id, { url: f.library, path: 'contents/library' }),
    /Cloud materials|クラウド/,
  );
  await assert.rejects(
    f.service.addSubmodule(id, { url: f.library, path: '.agents/library' }),
    /Knowledge/,
  );
  await assert.rejects(
    f.service.addSubmodule(id, { url: f.library, path: 'index.md' }),
    /already exists|同じ名前/,
  );
  const unknown = await f.service.status({ scopeId: id, repository: 'index.md' });
  assert.equal(unknown.available, false);
  assert.match(unknown.detail ?? '', /not a submodule|submodule ではありません/);
  // A submodule declared with a remote that is not allowed is left unfetched.
  const elsewhere = path.join(f.base, 'elsewhere');
  await mkdir(elsewhere);
  git(elsewhere, 'clone', '--bare', f.library, 'library.git');
  git(f.root, 'submodule', 'add', '--', path.join(elsewhere, 'library.git'), 'library');
  git(f.root, 'commit', '-m', 'Library from elsewhere');
  git(f.root, 'push', 'origin', 'main');
  const b = await peer(t, f);
  const fetched = await b.service.initSubmodules(id);
  assert.match(fetched.notice ?? '', /library/);
  assert.deepEqual(
    fetched.submodules.map((m) => [m.path, m.initialized]),
    [['library', false]],
  );
  await assert.rejects(b.service.initSubmodules(id, 'library'), /library/);
});
