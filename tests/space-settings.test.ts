import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { FileService } from '../src/host/files';
import { hostArguments } from '../src/domain/host-requests';

const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori brain settings '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const root = path.join(base, 'Product');
  await mkdir(root);
  const space = await files.register(root, 'Product', 'team');
  const meta = path.join(root, '.irori', 'scope.json');
  return { base, files, root, space, meta };
}

test('a brain’s name, category and look are written to scope.json and read back', async (t) => {
  const { base, files, space, meta } = await fixture(t);
  const next = await files.update(space.scopeId, {
    name: '  プロダクト  ',
    category: 'organization',
    appearance: { icon: { kind: 'glyph', glyph: 'rocket' }, color: 'ai' },
  });
  assert.equal(next.name, 'プロダクト');
  assert.deepEqual(next.appearance, { icon: { kind: 'glyph', glyph: 'rocket' }, color: 'ai' });
  const stored = JSON.parse(await readFile(meta, 'utf8'));
  assert.equal(stored.category, 'organization');
  assert.equal(stored.scopeId, space.scopeId);
  // Another launch reads the same brain from the KB itself.
  const again = new FileService(path.join(base, 'device'));
  await again.init();
  assert.deepEqual(again.get(space.scopeId).appearance, next.appearance);
  assert.equal(again.get(space.scopeId).name, 'プロダクト');
});

test('fields irori does not know survive, and null removes a category or a look', async (t) => {
  const { files, space, meta } = await fixture(t);
  const raw = JSON.parse(await readFile(meta, 'utf8'));
  await writeFile(meta, JSON.stringify({ ...raw, laterField: { kept: true } }, null, 2));
  await files.update(space.scopeId, { appearance: { color: 'koke' } });
  const cleared = await files.update(space.scopeId, { category: null, appearance: null });
  assert.equal(cleared.category, undefined);
  assert.equal(cleared.appearance, undefined);
  const stored = JSON.parse(await readFile(meta, 'utf8'));
  assert.deepEqual(stored.laterField, { kept: true });
  assert.equal('category' in stored, false);
  assert.equal('appearance' in stored, false);
});

test('a declaration written before brain looks existed still opens', async (t) => {
  const { base, space, meta } = await fixture(t);
  const raw = JSON.parse(await readFile(meta, 'utf8'));
  delete raw.appearance;
  await writeFile(meta, JSON.stringify(raw));
  const again = new FileService(path.join(base, 'device'));
  await again.init();
  assert.equal(again.get(space.scopeId).category, 'team');
  assert.equal(again.get(space.scopeId).appearance, undefined);
});

test('a look outside the offered set is refused and leaves the file as it was', async (t) => {
  const { files, space, meta } = await fixture(t);
  const before = await readFile(meta, 'utf8');
  const save = hostArguments.updateSpace;
  assert.equal(save.safeParse([space.scopeId, { appearance: { color: 'orange' } }]).success, false);
  assert.equal(
    save.safeParse([space.scopeId, { appearance: { icon: { kind: 'text', text: 'ABC' } } }])
      .success,
    false,
  );
  assert.equal(
    save.safeParse([space.scopeId, { appearance: { icon: { kind: 'text', text: '👩‍🔬研' } } }])
      .success,
    true,
  );
  assert.equal(save.safeParse([space.scopeId, { root: '/elsewhere' }]).success, false);
  await assert.rejects(
    files.update(space.scopeId, {
      appearance: { icon: { kind: 'image', path: '../outside.png' } },
    } as never),
  );
  assert.equal(await readFile(meta, 'utf8'), before);
});

test('an image icon is kept in .irori and only the named one stays', async (t) => {
  const { files, space, root } = await fixture(t);
  const first = await files.saveIcon(space.scopeId, png, 'png');
  assert.match(first, /^\.irori\/icon-[a-f0-9]{12}\.png$/);
  await files.update(space.scopeId, { appearance: { icon: { kind: 'image', path: first } } });
  const second = await files.saveIcon(space.scopeId, Uint8Array.from([...png, 1]), 'png');
  await files.update(space.scopeId, { appearance: { icon: { kind: 'image', path: second } } });
  const icons = (await readdir(path.join(root, '.irori'))).filter((name) =>
    name.startsWith('icon-'),
  );
  assert.deepEqual(icons, [path.basename(second)]);
  await files.update(space.scopeId, { appearance: { icon: { kind: 'text', text: 'P' } } });
  assert.deepEqual(
    (await readdir(path.join(root, '.irori'))).filter((name) => name.startsWith('icon-')),
    [],
  );
});

test('a scope.json that is a link out of the KB is not written through', async (t) => {
  const { base, files, space, meta } = await fixture(t);
  const outside = path.join(base, 'outside.json');
  await writeFile(outside, await readFile(meta, 'utf8'));
  await rm(meta);
  await symlink(outside, meta);
  await assert.rejects(files.update(space.scopeId, { name: 'Elsewhere' }));
  assert.equal(JSON.parse(await readFile(outside, 'utf8')).name, 'Product');
});
