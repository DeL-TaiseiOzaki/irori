import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isAppDocument } from '../src/host/trust';

test('renderer trust resolves the exact entry file and permits in-document navigation only', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'irori renderer 日本語 '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const filename = path.join(root, 'index.html');
  await writeFile(filename, '<h1>Fixture</h1>');
  await writeFile(path.join(root, 'other.html'), '<h1>Other file</h1>');
  const canonical = await realpath(filename);
  const url = pathToFileURL(filename).href;
  assert(await isAppDocument(url, canonical));
  assert(await isAppDocument(url + '#editor-main', canonical));
  assert(await isAppDocument(url.replaceAll('%E6', '%e6'), canonical));
  for (const other of [
    pathToFileURL(path.join(root, 'other.html')).href,
    'https://example.invalid/index.html',
    'data:text/html,fixture',
    'file://server/share/index.html',
    'about:blank',
    'invalid',
  ])
    assert.equal(await isAppDocument(other, canonical), false);
});
