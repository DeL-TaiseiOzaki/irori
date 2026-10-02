import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ImageService } from '../src/host/images';
import { connectedFixture } from './fixtures/cloud';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6VEQAAAAASUVORK5CYII=',
  'base64',
);

test('An editable connected note accepts pasted images, dedupes identical bytes, and rejects a mismatched file at the same name', async (t) => {
  const { files, cloud, space, connection, target } = await connectedFixture(t, {
    writable: true,
  });
  const notePath = `contents/${connection.name}/note.md`;
  await writeFile(path.join(target, 'note.md'), '# Note\n');
  // Wired the way src/host/main.ts wires it: files.cloud and ImageService share one CloudService.
  const images = new ImageService(files, cloud);
  const url = await images.save(space.scopeId, notePath, png);
  assert.match(url, /^_assets\/image-[a-f0-9]{64}\.png$/);
  // Written into the connected folder itself, beside the note.
  assert.deepEqual(await readFile(path.join(target, url)), png);
  assert.equal((await readdir(path.join(target, '_assets'))).length, 1);
  // Saving the identical bytes again reuses the same file.
  assert.equal(await images.save(space.scopeId, notePath, png), url);
  // Reading it back through the host gives a data URL of the same bytes.
  assert.equal(
    await images.read(space.scopeId, notePath, url),
    `data:image/png;base64,${png.toString('base64')}`,
  );
  // A different file already at the name these bytes would take is refused, untouched.
  const collision = path.join(target, url);
  const different = Buffer.from('not the same bytes');
  await writeFile(collision, different);
  await assert.rejects(images.save(space.scopeId, notePath, png), /変更されています/);
  assert.deepEqual(await readFile(collision), different);
});

test(
  'A symlinked _assets folder in a connected folder is refused',
  { skip: process.platform === 'win32' && 'POSIX symlink fixture' },
  async (t) => {
    const { files, cloud, space, connection, target, base } = await connectedFixture(t, {
      writable: true,
    });
    const notePath = `contents/${connection.name}/note.md`;
    await writeFile(path.join(target, 'note.md'), '# Note\n');
    const outside = path.join(base, 'outside');
    await mkdir(outside);
    await symlink(outside, path.join(target, '_assets'), 'dir');
    const images = new ImageService(files, cloud);
    await assert.rejects(images.save(space.scopeId, notePath, png), /escapes its mount/);
    assert.deepEqual(await readdir(outside), []);
  },
);

test('A read-only connection refuses a pasted image', async (t) => {
  const { files, cloud, space, connection, target } = await connectedFixture(t);
  const notePath = `contents/${connection.name}/note.md`;
  await writeFile(path.join(target, 'note.md'), '# Note\n');
  const images = new ImageService(files, cloud);
  await assert.rejects(images.save(space.scopeId, notePath, png), /読み取り専用/);
  // Refused before any write: no _assets folder was created.
  assert.deepEqual(await readdir(target), ['note.md']);
});

test('A disconnected folder takes no pasted image and gets no folder in its place', async (t) => {
  const { files, cloud, space, connection, target, entry } = await connectedFixture(t, {
    writable: true,
  });
  const notePath = `contents/${connection.name}/note.md`;
  await writeFile(path.join(target, 'note.md'), '# Note\n');
  await cloud.disconnect(space.scopeId, connection.mountId);
  const images = new ImageService(files, cloud);
  await assert.rejects(images.save(space.scopeId, notePath, png), /未接続/);
  assert.deepEqual(await readdir(target), ['note.md']);
  await assert.rejects(readdir(entry), { code: 'ENOENT' });
});
