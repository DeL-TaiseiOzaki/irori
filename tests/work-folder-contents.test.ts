import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { WorkFolders } from '../src/host/work-folders';
import { YourAiService } from '../src/host/you';
import { AgentPaths } from '../src/host/agent-paths';
import { connectedFixture, connectionName } from './fixtures/cloud';

/**
 * A vault whose contents holds a connected folder, as the owner's mtd vault does,
 * with its agents' work folder shown beside it as `contents/work` (ADR 045).
 */
async function vault(t: any) {
  const value = await connectedFixture(t, { writable: true });
  const { base, files, space, cloud } = value;
  const work = new WorkFolders(files);
  cloud.workFolder = (scopeId) => work.folder(scopeId);
  const you = new YourAiService(files.dataDir, base);
  await you.load();
  const paths = new AgentPaths({ files, you, workspaces: async () => [] });
  const listed = async (rel = 'contents') =>
    Object.fromEntries((await files.entries(space.scopeId, rel)).map((e) => [e.name, e]));
  return { ...value, work, paths, listed };
}

test('the default work folder shows in contents beside its connections and opens there', async (t) => {
  const { files, space, cloud, work, paths, listed } = await vault(t);
  // Not shown until a run makes it.
  assert.equal((await listed()).work, undefined);
  const folder = await work.prepare(space.scopeId);
  assert.equal(folder, path.join(space.root, 'contents', 'work'));
  const shown = (await listed()).work;
  assert.equal(shown.blocked, undefined);
  assert.equal(shown.writable, true);
  assert.equal(shown.connection, true);
  assert.equal((await listed())[connectionName].blocked, undefined);
  // What an agent leaves there is read and changed in place.
  await mkdir(path.join(folder, '20261016_intro'));
  await writeFile(path.join(folder, '20261016_intro', 'outline.md'), '# Outline\n');
  await writeFile(path.join(folder, '20261016_intro', 'MTD紹介.pptx'), 'pptx');
  const inside = await listed('contents/work/20261016_intro');
  assert.equal(inside['outline.md'].blocked, undefined);
  assert.equal(inside['outline.md'].writable, true);
  const doc = await files.read(space.scopeId, 'contents/work/20261016_intro/outline.md');
  assert.equal(doc.readOnly, false);
  await files.save({ ...doc, text: '# Outline\n\nEdited\n' });
  assert.match(await readFile(path.join(folder, '20261016_intro', 'outline.md'), 'utf8'), /Edited/);
  await cloud.createEntry(space.scopeId, 'contents/work', { kind: 'folder', name: 'next' });
  assert.ok((await readdir(folder)).includes('next'));
  // The folder itself stays where irori keeps it.
  await assert.rejects(cloud.moveEntry(space.scopeId, 'contents/work', 'contents/work2'));
  // A link inside it leads nowhere.
  await symlink(path.join(space.root, '.irori'), path.join(folder, 'escape'));
  await assert.rejects(files.read(space.scopeId, 'contents/work/escape/scope.json'));
  // The path a reply gives opens, by its place in the vault or by name.
  const pptx = path.join(folder, '20261016_intro', 'MTD紹介.pptx');
  assert.deepEqual(await paths.locate({ path: pptx }), [
    { scopeId: space.scopeId, path: 'contents/work/20261016_intro/MTD紹介.pptx' },
  ]);
  assert.deepEqual(await paths.locate({ path: 'MTD紹介.pptx', from: space.scopeId }), [
    { scopeId: space.scopeId, path: 'contents/work/20261016_intro/MTD紹介.pptx' },
  ]);
});

test('a work folder chosen elsewhere shows as contents/work and its paths open there', async (t) => {
  const { base, files, space, work, paths, listed } = await vault(t);
  // What a run left in the default before the choice is shown by the chosen one.
  await work.prepare(space.scopeId);
  await writeFile(path.join(space.root, 'contents', 'work', 'old.md'), '# Old\n');
  const chosen = path.join(base, 'Documents', 'Lab work');
  await mkdir(path.join(chosen, 'slides'), { recursive: true });
  await writeFile(path.join(chosen, 'slides', 'TIG紹介.pptx'), 'pptx');
  await writeFile(path.join(chosen, 'notes.md'), '# Notes\n');
  await work.choose(space.scopeId, chosen);
  assert.equal((await listed()).work.blocked, undefined);
  assert.deepEqual(Object.keys(await listed('contents/work')).sort(), ['notes.md', 'slides']);
  const doc = await files.read(space.scopeId, 'contents/work/notes.md');
  assert.equal(doc.text, '# Notes\n');
  assert.equal(doc.readOnly, false);
  const target = { scopeId: space.scopeId, path: 'contents/work/slides/TIG紹介.pptx' };
  assert.deepEqual(await paths.locate({ path: path.join(chosen, 'slides', 'TIG紹介.pptx') }), [
    target,
  ]);
  assert.deepEqual(await paths.locate({ path: 'slides/TIG紹介.pptx', from: space.scopeId }), [
    target,
  ]);
  assert.ok(
    (await paths.roots()).some((root) => root.root === chosen && root.prefix === 'contents/work'),
  );
  // A folder chosen inside the vault already shows where it is.
  const inside = path.join(space.root, 'scratch');
  await mkdir(inside);
  await work.choose(space.scopeId, inside);
  assert.equal((await listed()).work.blocked, '登録されていないローカルデータです。');
});

test('a connection named work keeps its name; the work folder does not show over it', async (t) => {
  const { base, space, cloud, work, listed } = await vault(t);
  const chosen = path.join(base, 'Elsewhere');
  await mkdir(chosen);
  await work.choose(space.scopeId, chosen);
  const drive = path.join(base, 'Drive work');
  await mkdir(drive);
  await writeFile(path.join(drive, 'shared.md'), '# Shared\n');
  const connection = await cloud.addLocal({
    scopeId: space.scopeId,
    path: drive,
    contentsRoot: 'contents',
    name: 'work',
  });
  await cloud.connect(space.scopeId, connection.mountId);
  assert.deepEqual(Object.keys(await listed('contents/work')), ['shared.md']);
});
