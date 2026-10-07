import test from 'node:test';
import assert from 'node:assert/strict';
import { baseName, parentPath } from '../src/domain/paths';

const samples = ['', 'note.md', 'a/b/note.md', 'a/b/', '/top', 'a//b', 'Knowledge_Base/日本語.md'];

test('a name and its folder read as the slash-split copies they replace', () => {
  for (const path of samples) {
    assert.equal(baseName(path), path.split('/').at(-1)!, path);
    assert.equal(parentPath(path), path.split('/').slice(0, -1).join('/'), path);
  }
  assert.equal(baseName('a/b/note.md'), 'note.md');
  assert.equal(parentPath('a/b/note.md'), 'a/b');
  assert.equal(parentPath('note.md'), '');
});
