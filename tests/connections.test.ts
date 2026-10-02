import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { promises } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { mountNameError } from '../src/domain/connections';
import { within } from '../src/domain/scopes';
import { WorkspaceService, inspectRepository, githubRepository } from '../src/host/workspaces';
import { FileService, readViewerBytes } from '../src/host/files';
import { CloudService } from '../src/cloud/service';
import {
  connectedFixture,
  connectionRoot,
  fixture,
  retiredDeclaration,
  syncedFolder,
  writeRetired,
} from './fixtures/cloud';

test('A lost link marks the connection, and an explicit reconnect restores it', async (t) => {
  const { cloud, space, connection, entry, target } = await connectedFixture(t);
  await unlink(entry);
  const [lost] = await cloud.connections(space.scopeId);
  assert.equal(lost.state, 'error');
  assert.match(lost.detail!, /接続が失われました/);
  assert.match((await cloud.rootEntries(space.scopeId, 'contents'))![0].blocked!, /接続が失われ/);
  await cloud.connect(space.scopeId, connection.mountId);
  assert.equal((await cloud.connections(space.scopeId))[0].state, 'mounted');
  assert.equal(await readlink(entry), target);
  assert.equal((await cloud.rootEntries(space.scopeId, 'contents'))![0].blocked, undefined);
});

test(
  'Paths inside a folder whose final path cannot be reported resolve, and links below it are refused',
  { skip: process.platform === 'win32' && 'POSIX symlink fixture' },
  async (t) => {
    const { base, files, space, cloud } = await fixture(t);
    const target = await syncedFolder(base);
    await mkdir(path.join(target, 'Folder'));
    await writeFile(path.join(target, 'Folder', 'note.md'), '# Remote\n');
    // A sync app's virtual drive may not report a final path for anything inside it.
    // Model exactly that: irori uses the chosen path and never needs realpath below it.
    const realpath = promises.realpath;
    promises.realpath = (async (value: string, ...rest: unknown[]) => {
      if (within(target, path.resolve(String(value))))
        throw Object.assign(Error(`UNKNOWN: unknown error, realpath '${value}'`), {
          code: 'UNKNOWN',
        });
      return (realpath as (...args: unknown[]) => Promise<string>)(value, ...rest);
    }) as typeof promises.realpath;
    t.after(() => {
      promises.realpath = realpath;
    });
    const { mountId } = await cloud.addLocal({
      scopeId: space.scopeId,
      path: target,
      contentsRoot: 'contents',
      name: 'Virtual',
    });
    await cloud.connect(space.scopeId, mountId);
    assert.deepEqual(
      (await files.entries(space.scopeId, 'contents/Virtual')).map((entry) => entry.name),
      ['Folder'],
    );
    assert.deepEqual(
      (await files.entries(space.scopeId, 'contents/Virtual/Folder')).map((entry) => entry.name),
      ['note.md'],
    );
    assert.equal(
      await files.resolve(space.scopeId, 'contents/Virtual/Folder/note.md'),
      path.join(target, 'Folder', 'note.md'),
    );
    await symlink(base, path.join(target, 'escape'), 'dir');
    for (const rel of ['escape', 'escape/KB'])
      await assert.rejects(
        files.resolve(space.scopeId, `contents/Virtual/${rel}`),
        /alias escapes/,
      );
  },
);

test('An editable file is written in place and keeps its draft until the file holds the text', async (t) => {
  const { files, space, target } = await connectedFixture(t, { writable: true });
  await writeFile(path.join(target, 'note.md'), '# Remote\n');
  const rel = `${connectionRoot}/note.md`;
  const opened = await files.read(space.scopeId, rel);
  assert.equal(opened.readOnly, false);
  assert.equal(opened.cloud, true);
  const inode = (await stat(path.join(target, 'note.md'))).ino;
  const saved = await files.save({ ...opened, text: '# Remote\n\nEdited in irori\n' });
  assert.equal(saved.text, '# Remote\n\nEdited in irori\n');
  // The same file with new bytes, so a sync app keeps it as a new version of that file.
  assert.equal((await stat(path.join(target, 'note.md'))).ino, inode);
  assert.deepEqual(await readdir(target), ['note.md']);
  await assert.rejects(files.save({ ...opened, text: 'Stale edit' }), /CONFLICT/);
  assert.equal((await files.read(space.scopeId, rel)).draft?.text, 'Stale edit');
  assert.equal(
    await readFile(path.join(target, 'note.md'), 'utf8'),
    '# Remote\n\nEdited in irori\n',
  );
});

test('A read-only connection opens files read-only and refuses saves and new notes', async (t) => {
  const { files, space, target, cloud } = await connectedFixture(t);
  await writeFile(path.join(target, 'note.md'), '# Remote\n');
  const doc = await files.read(space.scopeId, `${connectionRoot}/note.md`);
  assert.equal(doc.readOnly, true);
  await assert.rejects(files.save({ ...doc, text: 'Changed' }), /読み取り専用/);
  await assert.rejects(cloud.createNote(space.scopeId, connectionRoot, 'Idea'), /読み取り専用/);
  assert.equal((await files.entries(space.scopeId, 'contents'))[0].writable, undefined);
  assert.equal(await readFile(path.join(target, 'note.md'), 'utf8'), '# Remote\n');
  assert.deepEqual(await readdir(target), ['note.md']);
});

test('Notes are added to an editable folder without replacing a file', async (t) => {
  const { files, space, target, cloud } = await connectedFixture(t, { writable: true });
  await mkdir(path.join(target, 'Folder'));
  const created = await cloud.createNote(space.scopeId, `${connectionRoot}/Folder`, 'アイデア');
  assert.equal(created.path, `${connectionRoot}/Folder/アイデア.md`);
  assert.equal(created.readOnly, false);
  assert.equal(
    await readFile(path.join(target, 'Folder', 'アイデア.md'), 'utf8'),
    '# アイデア\n\n',
  );
  await writeFile(path.join(target, 'Folder', 'アイデア.md'), 'Kept');
  await assert.rejects(cloud.createNote(space.scopeId, `${connectionRoot}/Folder`, 'アイデア'), {
    code: 'EEXIST',
  });
  assert.equal(await readFile(path.join(target, 'Folder', 'アイデア.md'), 'utf8'), 'Kept');
  await assert.rejects(
    cloud.createNote(space.scopeId, `${connectionRoot}/Folder/アイデア.md`, 'Inner'),
    /Choose a folder/,
  );
  assert.equal((await files.entries(space.scopeId, `${connectionRoot}/Folder`))[0].writable, true);
});

test('Access is changed per connection, kept in its record, and a connected folder is linked again', async (t) => {
  const { files, cloud, space, connection, entry, target } = await connectedFixture(t);
  const recorded = async () =>
    JSON.parse(await readFile(path.join(space.root, '.irori/local-folders.json'), 'utf8'))[0]
      .access;
  await cloud.setAccess(space.scopeId, connection.mountId, 'read-write');
  assert.equal(await recorded(), 'read-write');
  const [editable] = await cloud.connections(space.scopeId);
  assert.deepEqual([editable.state, editable.writable], ['mounted', true]);
  assert.equal(await readlink(entry), target);
  await writeFile(path.join(target, 'note.md'), '# Remote\n');
  assert.equal((await files.read(space.scopeId, `${connectionRoot}/note.md`)).readOnly, false);
  await cloud.disconnect(space.scopeId, connection.mountId);
  await cloud.setAccess(space.scopeId, connection.mountId, 'read-only');
  assert.equal(await recorded(), 'read-only');
  // A disconnected folder stays disconnected.
  assert.equal((await cloud.connections(space.scopeId))[0].state, 'disconnected');
  await assert.rejects(lstat(entry), { code: 'ENOENT' });
  await assert.rejects(
    cloud.setAccess(space.scopeId, randomUUID(), 'read-only'),
    /Unknown cloud connection/,
  );
  await cloud.connect(space.scopeId, connection.mountId);
  assert.equal((await files.entries(space.scopeId, 'contents'))[0].writable, undefined);
});

test('A Word file in a connected folder opens for a viewer, with its bytes through the link', async (t) => {
  const { files, cloud, space, target } = await connectedFixture(t, { writable: true });
  const word = await readFile('tests/fixtures/viewers/sample.docx');
  await writeFile(path.join(target, 'memo.docx'), word);
  const rel = `${connectionRoot}/memo.docx`;
  const memo = await files.read(space.scopeId, rel);
  assert.equal(memo.viewer, 'word');
  assert.equal(memo.text, '');
  assert.equal(memo.draft, undefined);
  assert.deepEqual(
    Buffer.from(await readViewerBytes(await cloud.resolve(space.scopeId, rel), rel)),
    word,
  );
});

test('Closing removes only the links irori made and keeps whatever replaced one', async (t) => {
  for (const replace of [false, true]) {
    const { cloud, space, connection, entry, target } = await connectedFixture(t);
    await writeFile(path.join(target, 'note.md'), 'Kept in the folder');
    if (replace) {
      await unlink(entry);
      await mkdir(entry);
      await writeFile(path.join(entry, 'keep.txt'), 'Preserve replacement local bytes');
    }
    await cloud.close();
    if (replace)
      assert.equal(
        await readFile(path.join(entry, 'keep.txt'), 'utf8'),
        'Preserve replacement local bytes',
      );
    else await assert.rejects(lstat(entry), { code: 'ENOENT' });
    assert.equal(await readFile(path.join(target, 'note.md'), 'utf8'), 'Kept in the folder');
    assert.deepEqual(cloud.localFolders(space.scopeId), []);
    await assert.rejects(cloud.connect(space.scopeId, connection.mountId), /終了中/);
  }
});

test('An in-flight refresh cannot undo an explicit disconnect', async (t) => {
  const { cloud, space, connection } = await connectedFixture(t);
  const check = cloud['assertLinked'].bind(cloud);
  let started!: () => void;
  let release!: () => void;
  const begun = new Promise<void>((resolve) => (started = resolve));
  const gate = new Promise<void>((resolve) => (release = resolve));
  cloud['assertLinked'] = async (mounted: Parameters<typeof check>[0]) => {
    started();
    await gate;
    return check(mounted);
  };
  const refresh = cloud.connections(space.scopeId);
  await begun;
  await cloud.disconnect(space.scopeId, connection.mountId);
  release();
  assert.equal((await refresh)[0].state, 'disconnected');
  assert.equal((await cloud.connections(space.scopeId))[0].state, 'disconnected');
});

test('Mount names support Japanese and spaces, and reject traversal and incompatible names', () => {
  for (const name of ['調査 資料', 'team-docs', 'équipe'])
    assert.equal(mountNameError(name), undefined);
  for (const name of [
    '',
    '.',
    '..',
    '../escape',
    'folder/sub',
    'a\\b',
    'name:',
    'NUL.txt',
    'COM¹',
    '資料.',
    ' leading',
    'a\0b',
    '資'.repeat(100),
  ])
    assert.ok(mountNameError(name), name);
});

test('Folder records keep their names across restart and hibachis, without device paths', async (t) => {
  const { base, files, space, cloud } = await fixture(t);
  const first = await cloud.addLocal({
    scopeId: space.scopeId,
    path: await syncedFolder(base, 'Research'),
    contentsRoot: 'contents',
    name: '調査 資料',
  });
  const second = await cloud.addLocal({
    scopeId: space.scopeId,
    path: await syncedFolder(base, 'Shared'),
    contentsRoot: 'contents',
    name: '共有資料',
    access: 'read-only',
  });
  const portable = await readFile(path.join(space.root, '.irori/local-folders.json'), 'utf8');
  assert.ok(!portable.includes(base));
  // Registering does not touch contents; only connecting places a link there.
  await assert.rejects(stat(path.join(space.root, 'contents')), { code: 'ENOENT' });
  const restarted = new CloudService(files);
  assert.deepEqual(
    (await restarted.connections(space.scopeId)).map((item) => [
      item.mountId,
      item.name,
      item.folderName,
      item.access,
      item.state,
    ]),
    [
      [first.mountId, '調査 資料', 'Research', 'read-write', 'disconnected'],
      [second.mountId, '共有資料', 'Shared', 'read-only', 'disconnected'],
    ],
  );
  const otherRoot = path.join(base, 'Other KB');
  await mkdir(otherRoot);
  const other = await files.register(otherRoot, 'Other', 'team');
  await cloud.addLocal({
    scopeId: other.scopeId,
    path: await syncedFolder(base, 'Research'),
    contentsRoot: 'contents',
    name: '調査 資料',
  });
  assert.equal((await cloud.connections(other.scopeId)).length, 1);
  assert.equal((await cloud.connections(space.scopeId)).length, 2);
});

test('Registration rejects duplicate names, occupied paths and linked contents', async (t) => {
  const { base, files, space, cloud } = await fixture(t);
  const folder = await syncedFolder(base);
  const input = { scopeId: space.scopeId, path: folder, contentsRoot: 'contents', name: 'Équipe' };
  await cloud.addLocal(input);
  await assert.rejects(cloud.addLocal({ ...input, name: 'éQUIPE' }), /同じ名前/);
  await mkdir(path.join(space.root, 'contents'));
  await writeFile(path.join(space.root, 'contents/occupied'), 'Keep local bytes');
  await assert.rejects(cloud.addLocal({ ...input, name: 'occupied' }), /同じ名前/);
  assert.equal(
    await readFile(path.join(space.root, 'contents/occupied'), 'utf8'),
    'Keep local bytes',
  );
  await assert.rejects(cloud.addLocal({ ...input, contentsRoot: 'elsewhere' }), /contents/);
  assert.equal((await cloud.connections(space.scopeId)).length, 1);
  const entries = await files.entries(space.scopeId, 'contents');
  assert.ok(entries.find((item) => item.name === 'occupied')?.blocked?.includes('ローカルデータ'));
  const otherRoot = path.join(base, 'Alias KB');
  await mkdir(otherRoot);
  const other = await files.register(otherRoot, 'Alias', 'personal');
  await symlink(path.join(space.root, 'contents'), path.join(otherRoot, 'contents'), 'dir');
  await assert.rejects(
    cloud.addLocal({ ...input, scopeId: other.scopeId, name: 'safe' }),
    /リンク/,
  );
  assert.deepEqual(await cloud.connections(other.scopeId), []);
});

test('Rename and removal keep the identity, other connections and local bytes', async (t) => {
  const { base, files, space, cloud } = await fixture(t);
  const folder = await syncedFolder(base);
  await writeFile(path.join(folder, 'note.md'), 'In the folder');
  const input = { scopeId: space.scopeId, path: folder, contentsRoot: 'contents', name: 'Before' };
  const first = await cloud.addLocal(input);
  const second = await cloud.addLocal({ ...input, name: 'Reserved' });
  await assert.rejects(cloud.edit(space.scopeId, first.mountId, '../unsafe'), /フォルダ/);
  await assert.rejects(cloud.edit(space.scopeId, first.mountId, 'reserved'), /同じ名前/);
  await mkdir(path.join(space.root, 'contents/Occupied'), { recursive: true });
  await writeFile(path.join(space.root, 'contents/Occupied/keep.md'), 'Keep');
  await assert.rejects(cloud.edit(space.scopeId, first.mountId, 'Occupied'), /同じ名前/);
  // A connected folder is disconnected before it is renamed or unregistered.
  await cloud.connect(space.scopeId, first.mountId);
  await assert.rejects(cloud.edit(space.scopeId, first.mountId, 'Later'), /接続を解除/);
  await cloud.disconnect(space.scopeId, first.mountId);
  await cloud.edit(space.scopeId, first.mountId, '新しい 資料');
  const restarted = new CloudService(files);
  files.cloud = restarted;
  const renamed = (await restarted.connections(space.scopeId))[0];
  assert.deepEqual(
    [renamed.name, renamed.mountId, renamed.folderName, renamed.state],
    ['新しい 資料', first.mountId, 'Shared folder', 'disconnected'],
  );
  // Something the person put where the connection would appear is theirs.
  await mkdir(path.join(space.root, 'contents/新しい 資料'));
  await writeFile(path.join(space.root, 'contents/新しい 資料/local.md'), 'User bytes');
  await restarted.edit(space.scopeId, first.mountId);
  assert.deepEqual(
    (await restarted.localDeclarations(space.scopeId)).map((item) => item.mountId),
    [second.mountId],
  );
  assert.equal(
    await readFile(path.join(space.root, 'contents/新しい 資料/local.md'), 'utf8'),
    'User bytes',
  );
  assert.equal(await readFile(path.join(space.root, 'contents/Occupied/keep.md'), 'utf8'), 'Keep');
  assert.equal(await readFile(path.join(folder, 'note.md'), 'utf8'), 'In the folder');
  await assert.rejects(
    stat(path.join(files.dataDir, 'local-bindings', `${space.scopeId}-${first.mountId}.json`)),
    { code: 'ENOENT' },
  );
  await stat(path.join(files.dataDir, 'local-bindings', `${space.scopeId}-${second.mountId}.json`));
});

test('Connection limit rejects additions before writing an unreadable record', async (t) => {
  const { base, space, cloud } = await fixture(t);
  const folder = await syncedFolder(base);
  const input = { scopeId: space.scopeId, path: folder, contentsRoot: 'contents', name: 'First' };
  const {
    state: _state,
    writable: _writable,
    detail: _detail,
    ...record
  } = await cloud.addLocal(input);
  await writeFile(
    path.join(space.root, '.irori/local-folders.json'),
    JSON.stringify(
      Array.from({ length: 100 }, (_, i) => ({
        ...record,
        mountId: randomUUID(),
        name: `Folder-${i}`,
      })),
    ),
  );
  await assert.rejects(cloud.addLocal({ ...input, name: 'Overflow' }), /100件/);
  assert.equal((await cloud.localDeclarations(space.scopeId)).length, 100);
});

test('Unreadable connection records are reported in words a person can act on', async (t) => {
  const { space, cloud } = await fixture(t);
  for (const [file, pattern] of [
    ['cloud-mounts.json', /「Personal」の Drive 接続の記録（\.irori\/cloud-mounts\.json）/],
    ['local-folders.json', /「Personal」のフォルダ接続の記録（\.irori\/local-folders\.json）/],
  ] as const) {
    const filename = path.join(space.root, '.irori', file);
    for (const text of ['{ malformed', JSON.stringify([{ name: 'missing fields' }])]) {
      await writeFile(filename, text);
      await assert.rejects(cloud.connections(space.scopeId), (error: Error) => {
        assert.match(error.message, pattern);
        assert.doesNotMatch(error.message, /SyntaxError|position|expected/i);
        return true;
      });
    }
    await rm(filename);
  }
  // A record of another hibachi is refused rather than shown here.
  await writeRetired(space, retiredDeclaration({ scopeId: randomUUID() }));
  await assert.rejects(cloud.connections(space.scopeId), /重複・不一致/);
});

test('Workspace profiles persist independent scopes and Git inspection preserves dirty checkouts and redacts credentials', async (t) => {
  const { base, files, space } = await fixture(t);
  const otherRoot = path.join(base, 'Team');
  await mkdir(otherRoot);
  const other = await files.register(otherRoot, 'Team', 'team');
  const service = new WorkspaceService(files);
  const profile = await service.save('Work', [space.scopeId, other.scopeId, space.scopeId]);
  assert.deepEqual((await new WorkspaceService(files).list())[0].scopeIds, [
    space.scopeId,
    other.scopeId,
  ]);
  await assert.rejects(service.save('Invalid', [randomUUID()]), /Unknown space/);
  await assert.rejects(service.save('Work', [space.scopeId]), /同じ名前/);
  assert.equal((await service.save('Renamed', [other.scopeId], profile.id)).id, profile.id);
  assert.equal(
    githubRepository('https://user:secret@github.com/example/notes.git?token=secret'),
    'example/notes',
  );
  const git = (...args: string[]) => execFileSync('git', args, { cwd: space.root, stdio: 'pipe' });
  git('init');
  git('remote', 'add', 'origin', 'https://user:secret@github.com/example/notes.git');
  await writeFile(path.join(space.root, 'draft.md'), 'User draft');
  const info = await inspectRepository(space.root);
  assert.equal(info.kind, 'github');
  assert.equal(info.repository, 'example/notes');
  assert.equal(info.changed, true);
  assert.ok(!JSON.stringify(info).includes('secret'));
  assert.equal(await readFile(path.join(space.root, 'draft.md'), 'utf8'), 'User draft');
  await mkdir(path.join(space.root, 'nested'));
  assert.equal((await inspectRepository(path.join(space.root, 'nested'))).kind, 'unavailable');
  await Promise.all([service.remove(profile.id), service.save('Another', [space.scopeId])]);
  assert.deepEqual(
    (await new WorkspaceService(files).list()).map((item) => item.name),
    ['Another'],
  );
  await assert.rejects(service.remove(profile.id), /Unknown workspace/);
  assert.equal(await readFile(path.join(space.root, 'draft.md'), 'utf8'), 'User draft');
  assert.equal(files.list().length, 2);
});

test('Workspace edits preserve offline scopes while rejecting newly invented scope IDs', async (t) => {
  const { files, space } = await fixture(t);
  const service = new WorkspaceService(files);
  const profile = await service.save('Before', [space.scopeId]);
  // Simulate a disconnected checkout; only device metadata is available after restart.
  await rm(space.root, { recursive: true });
  const restartedFiles = new FileService(files.dataDir);
  await restartedFiles.init();
  assert.equal(restartedFiles.list().length, 0);
  const restarted = new WorkspaceService(restartedFiles);
  const updated = await restarted.save('After', profile.scopeIds, profile.id);
  assert.deepEqual(updated.scopeIds, profile.scopeIds);
  await assert.rejects(restarted.save('Invalid', [randomUUID()], profile.id), /Unknown space/);
  await restarted.remove(profile.id);
  assert.deepEqual(await restarted.list(), []);
});
