import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, mkdir, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RepositoryGit } from '../src/cloud/repositories';
import { GitProcess } from '../src/git/process';
import { fixture } from './fixtures/cloud';

const run = promisify(execFile);
const url = 'https://github.com/owner/project.git';

/**
 * A vault, and a repository standing for github.com/owner/project: Git reaches it
 * through a global `insteadOf`, while the vault records the GitHub URL.
 */
async function repositoryFixture(t: any) {
  const value = await fixture(t);
  const remotes = path.join(value.base, 'remotes');
  const remote = path.join(remotes, 'owner', 'project.git');
  const work = path.join(value.base, 'author');
  const git = (cwd: string, ...args: string[]) =>
    run('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd });
  await mkdir(remote, { recursive: true });
  await git(remote, 'init', '--bare', '--quiet', '--initial-branch=main');
  await mkdir(work);
  await git(work, 'init', '--quiet', '--initial-branch=main');
  await writeFile(path.join(work, 'README.md'), '# Project\n');
  await git(work, 'add', '.');
  await git(work, 'commit', '--quiet', '-m', 'First');
  await git(work, 'remote', 'add', 'origin', remote);
  await git(work, 'push', '--quiet', 'origin', 'main');
  const config = path.join(value.base, 'gitconfig');
  await writeFile(
    config,
    `[url "${pathToFileURL(remotes).href}/"]\n\tinsteadOf = https://github.com/\n` +
      '[protocol "file"]\n\tallow = always\n',
  );
  const before = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = config;
  t.after(() => {
    if (before === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = before;
  });
  value.cloud.repositories = new RepositoryGit(new GitProcess(), ['https', 'ssh', 'file']);
  const clones = path.join(value.base, 'Code');
  await mkdir(clones);
  /** Adds a commit to the repository, as someone else pushing would. */
  async function push(file: string, text: string) {
    await writeFile(path.join(work, file), text);
    await git(work, 'add', '.');
    await git(work, 'commit', '--quiet', '-m', `Change ${file}`);
    await git(work, 'push', '--quiet', 'origin', 'main');
  }
  return { ...value, clones, push, git };
}

test('A GitHub repository is cloned where the person chose and shown read-only in contents', async (t) => {
  const { files, space, cloud, clones } = await repositoryFixture(t);
  const connection = await cloud.addRepository({
    scopeId: space.scopeId,
    url,
    folder: clones,
    existing: false,
    contentsRoot: 'contents',
    name: 'project',
  });
  assert.equal(connection.provider, 'github');
  assert.equal(connection.access, 'read-only');
  const clone = path.join(clones, 'project');
  assert.equal(await readFile(path.join(clone, 'README.md'), 'utf8'), '# Project\n');
  // The vault records where it comes from, never this device's path.
  const record = await readFile(path.join(space.root, '.irori', 'repositories.json'), 'utf8');
  assert.match(record, /"url": "https:\/\/github.com\/owner\/project.git"/);
  assert(!record.includes(clones));
  await assert.rejects(lstat(path.join(space.root, '.irori', 'local-folders.json')), {
    code: 'ENOENT',
  });
  await cloud.connect(space.scopeId, connection.mountId);
  const entry = path.join(space.root, 'contents', 'project');
  assert.equal(await readlink(entry), clone);
  assert.deepEqual(cloud.localFolders(space.scopeId), [clone]);
  const [listed] = await files.entries(space.scopeId, 'contents');
  assert.equal(listed.repository, true);
  assert.equal(listed.local, true);
  const doc = await files.read(space.scopeId, 'contents/project/README.md');
  assert.equal(doc.readOnly, true);
  // A folder of the repository's name already there is not cloned over.
  await assert.rejects(
    cloud.addRepository({
      scopeId: space.scopeId,
      url,
      folder: clones,
      existing: false,
      contentsRoot: 'contents',
      name: 'again',
    }),
    /already exists|すでにあります/,
  );
});

test('最新にする moves the clone forward, and refuses when it has changes of its own', async (t) => {
  const { space, cloud, clones, push } = await repositoryFixture(t);
  const { mountId } = await cloud.addRepository({
    scopeId: space.scopeId,
    url,
    folder: clones,
    existing: false,
    contentsRoot: 'contents',
    name: 'project',
  });
  const clone = path.join(clones, 'project');
  assert.deepEqual(await cloud.updateRepository(space.scopeId, mountId), {
    branch: 'main',
    commits: 0,
  });
  await push('README.md', '# Project\n\nNews\n');
  await push('guide.md', '# Guide\n');
  assert.deepEqual(await cloud.updateRepository(space.scopeId, mountId), {
    branch: 'main',
    commits: 2,
  });
  assert.equal(await readFile(path.join(clone, 'guide.md'), 'utf8'), '# Guide\n');
  await push('guide.md', '# Guide\n\nMore\n');
  await writeFile(path.join(clone, 'README.md'), 'Edited here\n');
  await assert.rejects(
    cloud.updateRepository(space.scopeId, mountId),
    /uncommitted|コミットしていない/,
  );
  assert.equal(await readFile(path.join(clone, 'README.md'), 'utf8'), 'Edited here\n');
});

test('Another device clones the recorded repository, or uses its own clone of it', async (t) => {
  const { files, space, cloud, clones, git, base } = await repositoryFixture(t);
  const { mountId } = await cloud.addRepository({
    scopeId: space.scopeId,
    url,
    branch: 'main',
    folder: clones,
    existing: false,
    contentsRoot: 'contents',
    name: 'project',
  });
  // On a device without a clone, the record alone is there.
  await rm(path.join(files.dataDir, 'local-bindings', `${space.scopeId}-${mountId}.json`));
  let [connection] = await cloud.connections(space.scopeId);
  assert.equal(connection.state, 'unconfigured');
  const elsewhere = path.join(base, 'Elsewhere');
  await mkdir(elsewhere);
  await cloud.cloneRepository(space.scopeId, mountId, elsewhere);
  await cloud.connect(space.scopeId, mountId);
  [connection] = await cloud.connections(space.scopeId);
  assert.equal(connection.state, 'mounted');
  assert.equal(
    await readlink(path.join(space.root, 'contents', 'project')),
    path.join(elsewhere, 'project'),
  );
  await cloud.disconnect(space.scopeId, mountId);
  // A folder that is not a clone of it is refused; the person's own clone is taken.
  const other = path.join(base, 'Other');
  await mkdir(other);
  await git(other, 'init', '--quiet');
  await git(other, 'remote', 'add', 'origin', 'https://github.com/owner/other.git');
  await assert.rejects(
    cloud.bindLocal(space.scopeId, mountId, other),
    /not a clone of owner\/project|owner\/project のクローンではありません/,
  );
  await assert.rejects(
    cloud.bindLocal(space.scopeId, mountId, path.join(clones, 'project', '.git')),
    /not a clone|クローンではありません/,
  );
  await cloud.bindLocal(space.scopeId, mountId, path.join(clones, 'project'));
  await cloud.connect(space.scopeId, mountId);
  assert.equal(
    await readlink(path.join(space.root, 'contents', 'project')),
    path.join(clones, 'project'),
  );
});

test('An existing clone is registered without cloning, and a non-GitHub URL is refused', async (t) => {
  const { space, cloud, clones, base } = await repositoryFixture(t);
  const clone = path.join(base, 'Mine');
  await run('git', ['clone', '--quiet', url, clone]);
  const connection = await cloud.addRepository({
    scopeId: space.scopeId,
    url: 'git@github.com:owner/project.git',
    folder: clone,
    existing: true,
    contentsRoot: 'contents',
    name: 'mine',
    access: 'read-write',
  });
  assert.equal(connection.folderName, 'Mine');
  assert.equal(connection.access, 'read-write');
  await assert.rejects(
    cloud.addRepository({
      scopeId: space.scopeId,
      url: 'https://gitlab.com/owner/project.git',
      folder: clones,
      existing: false,
      contentsRoot: 'contents',
      name: 'gitlab',
    }),
    /GitHub/,
  );
  // A clone inside a vault is refused, as any connected folder is.
  await assert.rejects(
    cloud.addRepository({
      scopeId: space.scopeId,
      url,
      folder: space.root,
      existing: false,
      contentsRoot: 'contents',
      name: 'inside',
    }),
    /overlaps|重なる/,
  );
});
