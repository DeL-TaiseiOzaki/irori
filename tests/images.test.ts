import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { FileService } from '../src/host/files';
import { ImageService, imagePath } from '../src/host/images';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6VEQAAAAASUVORK5CYII=',
  'base64',
);
test('Note images persist beside the note, deduplicate, reopen, and reject unsafe references', async (t) => {
  const base = await mkdtemp(path.join(tmpdir(), 'irori-images-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const root = path.join(base, 'KB');
  await mkdir(root);
  const space = await files.register(root, 'Images', 'personal');
  const note = await files.createNote(space.scopeId, '画像');
  const images = new ImageService(files);
  const urls = await Promise.all(
    Array.from({ length: 3 }, () => images.save(space.scopeId, note.path, png)),
  );
  const url = urls[0];
  assert.ok(urls.every((item) => item === url));
  assert.match(url, /^_assets\/image-[a-f0-9]{64}\.png$/);
  assert.equal(await images.save(space.scopeId, note.path, png), url);
  assert.deepEqual(await readFile(path.join(root, imagePath(note.path, url))), png);
  await files.save({ ...note, text: `${note.text}![画像](${url})\n` });
  assert.equal(
    await new ImageService(files).read(space.scopeId, note.path, url),
    `data:image/png;base64,${png.toString('base64')}`,
  );
  assert.equal((await readdir(path.join(root, 'Knowledge_Base/Notes/_assets'))).length, 1);
  for (const unsafe of [
    'file:///etc/passwd',
    'https://example.invalid/a.png',
    '//host/image.png',
    '%2fetc/passwd',
    '../../../outside.png',
  ])
    await assert.rejects(images.read(space.scopeId, note.path, unsafe));
  await assert.rejects(
    images.save(space.scopeId, note.path, Buffer.from('<svg onload="alert(1)"/>')),
  );
  await assert.rejects(images.save(space.scopeId, 'contents/remote/note.md', png));
  if (process.platform !== 'win32') {
    const outside = path.join(base, 'outside');
    await mkdir(outside);
    await writeFile(path.join(root, 'other.md'), '# Other');
    await symlink(outside, path.join(root, '_assets'), 'dir');
    await assert.rejects(images.save(space.scopeId, 'other.md', png));
    assert.deepEqual(await readdir(outside), []);
  }
});
