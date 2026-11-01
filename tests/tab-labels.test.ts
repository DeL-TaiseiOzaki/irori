import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tabLabels } from '../src/domain/tab-labels';

const shown = (paths: string[]) =>
  [...tabLabels(paths)].map(([path, label]) => [path, label.folder ?? null]);

test('a unique name shows no folder', () => {
  assert.deepEqual(shown(['notes/a.md', 'notes/b.md']), [
    ['notes/a.md', null],
    ['notes/b.md', null],
  ]);
});

test('a repeated name shows the nearest folder that tells it apart', () => {
  assert.deepEqual(shown(['team/index.md', 'notes/index.md', 'notes/b.md']), [
    ['team/index.md', 'team'],
    ['notes/index.md', 'notes'],
    ['notes/b.md', null],
  ]);
});

test('folders with the same last name show one more level', () => {
  assert.deepEqual(shown(['a/x/index.md', 'b/x/index.md']), [
    ['a/x/index.md', 'a/x'],
    ['b/x/index.md', 'b/x'],
  ]);
});

test('a file at the top is marked with a slash beside one in a folder', () => {
  assert.deepEqual(shown(['index.md', 'notes/index.md']), [
    ['index.md', '/'],
    ['notes/index.md', 'notes'],
  ]);
});

test('a path open twice is labelled once, with no folder', () => {
  assert.deepEqual(shown(['notes/a.md', 'notes/a.md']), [['notes/a.md', null]]);
});

test('an empty list has no labels', () => {
  assert.equal(tabLabels([]).size, 0);
});
