import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileService } from '../src/host/files';
import { WorkFolders } from '../src/host/work-folders';

async function device(t: any) {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), 'irori work 作業 ')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const root = path.join(base, 'Lab');
  await mkdir(root);
  const lab = await files.register(root, 'Lab', 'personal');
  const otherRoot = path.join(base, 'Other');
  await mkdir(otherRoot);
  const other = await files.register(otherRoot, 'Other', 'personal');
  return { base, files, lab, other, work: new WorkFolders(files) };
}

test("A vault's agents work in .irori/work, which Git ignores, until another folder is chosen", async (t) => {
  const { base, files, lab, other, work } = await device(t);
  const fallback = path.join(lab.root, '.irori', 'work');
  assert.deepEqual(await work.folder(lab.scopeId), { path: fallback, chosen: false });
  // Nothing is made until a run or the person needs it.
  await assert.rejects(lstat(fallback), { code: 'ENOENT' });
  assert.equal(await work.prepare(lab.scopeId), fallback);
  assert.match(await readFile(path.join(fallback, '.gitignore'), 'utf8'), /^\*$/m);
  assert.equal(await work.prepare(lab.scopeId), fallback);
  // A folder elsewhere on this device, kept in irori's data rather than the vault.
  const chosen = path.join(base, 'Documents', 'Lab work');
  await mkdir(chosen, { recursive: true });
  assert.deepEqual(await work.choose(lab.scopeId, chosen), { path: chosen, chosen: true });
  assert.equal(await work.prepare(lab.scopeId), chosen);
  assert.ok(
    (await readFile(path.join(files.dataDir, 'work-folders.json'), 'utf8')).includes(chosen),
  );
  assert.doesNotMatch(
    await readFile(path.join(lab.root, '.irori', 'scope.json'), 'utf8'),
    /Lab work/,
  );
  // Another vault keeps its own.
  assert.equal((await work.folder(other.scopeId)).chosen, false);
  // A chosen folder not there now, such as on a drive not mounted yet, gives way to the default.
  await rm(chosen, { recursive: true });
  assert.deepEqual(await work.folder(lab.scopeId), {
    path: fallback,
    chosen: true,
    missing: chosen,
  });
  // A folder inside the vault itself is the person's to choose.
  const inside = path.join(lab.root, 'scratch');
  await mkdir(inside);
  assert.equal((await work.choose(lab.scopeId, inside)).path, inside);
  assert.deepEqual(await work.choose(lab.scopeId, null), { path: fallback, chosen: false });
});

test('A work folder overlapping a vault or irori data, or not there, is refused', async (t) => {
  const { base, files, lab, other, work } = await device(t);
  await assert.rejects(work.choose(lab.scopeId, lab.root), /重なる/);
  await assert.rejects(work.choose(lab.scopeId, base), /重なる/);
  await assert.rejects(work.choose(lab.scopeId, other.root), /重なる/);
  await mkdir(path.join(other.root, 'scratch'));
  await assert.rejects(work.choose(lab.scopeId, path.join(other.root, 'scratch')), /重なる/);
  await assert.rejects(work.choose(lab.scopeId, files.dataDir), /重なる/);
  await assert.rejects(work.choose(lab.scopeId, path.join(base, 'missing')), /見つかりません/);
  await assert.rejects(work.choose(lab.scopeId, 'relative'), /見つかりません/);
  // A link where the default goes is not followed out of the vault.
  const outside = path.join(base, 'Outside');
  await mkdir(outside);
  await symlink(outside, path.join(lab.root, '.irori', 'work'));
  await assert.rejects(work.prepare(lab.scopeId), /リンクやファイル/);
  await assert.rejects(lstat(path.join(outside, '.gitignore')), { code: 'ENOENT' });
});
