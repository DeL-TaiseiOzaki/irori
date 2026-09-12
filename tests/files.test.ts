import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm, rename } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { FileService } from '../src/host/files';
import { classify, owner } from '../src/domain/scopes';
import type { Space } from '../src/domain/types';
async function fixture(t: any) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori test 日本語 '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  return { base, files };
}
async function add(
  base: string,
  files: FileService,
  name: string,
  category: Space['category'] = 'team',
) {
  const root = path.join(base, name);
  await mkdir(root, { recursive: true });
  return files.register(root, name, category);
}
test('Five spaces keep identical paths independent, explicit categories and persistent IDs', async (t) => {
  const { base, files } = await fixture(t);
  const spaces = [];
  for (let i = 0; i < 5; i++) {
    const s = await add(
      base,
      files,
      `KB ${i}`,
      i === 0 ? 'personal' : i === 4 ? 'organization' : 'team',
    );
    spaces.push(s);
    const d = await files.createNote(s.scopeId, '同じ名前');
    await files.save({ ...d, text: `# 空間 ${i}\n` });
  }
  assert.equal(new Set(spaces.map((s) => s.scopeId)).size, 5);
  for (let i = 0; i < 5; i++)
    assert.equal(
      (await files.read(spaces[i].scopeId, 'Knowledge_Base/Notes/同じ名前.md')).text,
      `# 空間 ${i}\n`,
    );
  const reopened = new FileService(files.dataDir);
  await reopened.init();
  assert.deepEqual(reopened.list(), spaces);
  const portable = JSON.parse(
    await readFile(path.join(spaces[0].root, '.irori/scope.json'), 'utf8'),
  );
  assert(!('root' in portable));
  const moved = path.join(base, 'moved');
  await rename(spaces[0].root, moved);
  const other = new FileService(path.join(base, 'other-device'));
  await other.init();
  assert.equal((await other.register(moved, 'ignored', 'team')).scopeId, spaces[0].scopeId);
});
test('Ownership precedes classification; nested declared scope and contents aliases are excluded', async (t) => {
  const { base, files } = await fixture(t);
  const parent = await add(base, files, 'personal', 'personal');
  const nested = await add(parent.root, files, 'team');
  assert.equal(owner(files.list(), path.join(nested.root, 'AGENTS.md'))?.scopeId, nested.scopeId);
  assert(!(await files.entries(parent.scopeId, '')).some((e) => e.path === 'team'));
  await assert.rejects(files.resolve(parent.scopeId, 'team'), /another space/);
  assert.equal(classify(parent, 'AGENTS.md'), 'schema');
  for (const p of [
    'contents/drive/AGENTS.md',
    'contents/drive/notes.md',
    'contents/drive/table.csv',
  ])
    assert.equal(classify(parent, p), 'contents');
  const cloud = path.join(base, 'selected folder');
  await mkdir(cloud);
  await mkdir(path.join(parent.root, 'contents'));
  await symlink(cloud, path.join(parent.root, 'contents', 'drive'), 'dir');
  await assert.rejects(files.register(cloud, 'Cloud', 'team'), /contents/);
  await mkdir(path.join(cloud, 'nested'));
  await assert.rejects(
    files.register(path.join(cloud, 'nested'), 'Cloud nested', 'organization'),
    /contents/,
  );
  const alias = path.join(base, 'alias');
  await symlink(path.join(parent.root, 'contents'), alias, 'dir');
  await assert.rejects(files.register(alias, 'Alias', 'team'), /contents/);
  await assert.rejects(files.resolve(parent.scopeId, '../selected folder'), /Path|Invalid/);
});
test('Registering an ancestor cannot retroactively place a registered space under contents', async (t) => {
  const { base, files } = await fixture(t);
  const root = path.join(base, 'parent');
  await mkdir(path.join(root, 'contents'), { recursive: true });
  await add(path.join(root, 'contents'), files, 'child');
  await assert.rejects(files.register(root, 'Parent', 'personal'), /contents/);
});
test('No-op preserves BOM, CRLF, Japanese, frontmatter and unknown syntax; dirty conflict preserves both versions', async (t) => {
  const { base, files } = await fixture(t);
  const s = await add(base, files, 'my KB');
  let d = await files.createNote(s.scopeId, '日本語 note');
  const original =
    '\ufeff---\r\n# YAML comment\r\nunknown: "kept"\r\n---\r\n# 日本語\r\n\r\n![[埋め込み]]\r\n';
  await writeFile(path.join(s.root, d.path), original);
  d = await files.read(s.scopeId, d.path);
  await files.save(d);
  assert.equal(await readFile(path.join(s.root, d.path), 'utf8'), original);
  await writeFile(path.join(s.root, d.path), '# Agent edited 日本語\n');
  await assert.rejects(files.save({ ...d, text: '# My dirty draft\n' }), /CONFLICT/);
  const current = await files.read(s.scopeId, d.path);
  assert.equal(current.text, '# Agent edited 日本語\n');
  assert.equal(current.draft?.text, '# My dirty draft\n');
  const restart = new FileService(files.dataDir);
  await restart.init();
  assert.equal((await restart.read(s.scopeId, d.path)).draft?.text, '# My dirty draft\n');
  const merged = await files.save({ ...current, text: current.text + '\nMy merged draft\n' });
  assert.equal(merged.draft, undefined);
});
test('Save rejects a replaced symlink, and note creation does not follow an escaping directory', async (t) => {
  const { base, files } = await fixture(t);
  const s = await add(base, files, 'KB');
  const d = await files.createNote(s.scopeId, 'safe');
  const outside = path.join(base, 'outside.md');
  await writeFile(outside, 'outside');
  await rm(path.join(s.root, d.path));
  await symlink(outside, path.join(s.root, d.path));
  await assert.rejects(files.save({ ...d, text: 'changed' }), /alias/);
  assert.equal(await readFile(outside, 'utf8'), 'outside');
  const other = await add(base, files, 'other');
  await symlink(base, path.join(other.root, 'Knowledge_Base'), 'dir');
  await assert.rejects(files.createNote(other.scopeId, 'escape'), /alias/);
});

test('Queued recovery writes cannot replace the final shutdown snapshot with an older draft', async (t) => {
  const { base, files } = await fixture(t);
  const space = await add(base, files, 'draft KB');
  const note = await files.createNote(space.scopeId, 'draft');
  await Promise.all([
    files.draft({ ...note, text: 'older draft' }),
    files.draft({ ...note, text: 'latest shutdown snapshot' }),
  ]);
  assert.equal(
    (await files.read(space.scopeId, note.path)).draft?.text,
    'latest shutdown snapshot',
  );
  await files.save({ ...note, text: 'saved snapshot' });
  assert.equal((await files.read(space.scopeId, note.path)).draft, undefined);
});
