import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  closeColumn,
  closeTab,
  firstStage,
  focus,
  focused,
  follow,
  moved,
  place,
  split,
  stageColumnLimit,
  type StageSet,
} from '../src/domain/stage-columns';

const shape = (set: StageSet) => ({
  focus: set.focus,
  columns: set.columns.map((column) => `${column.id}:${column.tabs.join(',')}@${column.on ?? ''}`),
});

test('A file opens in the focused column, after the tab on show', () => {
  let set = place(firstStage, 'a.md');
  set = place(set, 'b.md');
  set = place(place(set, 'a.md'), 'c.md');
  assert.deepEqual(shape(set), { focus: '1', columns: ['1:a.md,c.md,b.md@c.md'] });
  // A file already open is brought on show, not opened twice.
  assert.deepEqual(shape(place(set, 'b.md')).columns, ['1:a.md,c.md,b.md@b.md']);
});

test('A new column shows the same file and takes the focus, up to the limit', () => {
  let set = split(place(firstStage, 'a.md'));
  assert.deepEqual(shape(set), { focus: '2', columns: ['1:a.md@a.md', '2:a.md@a.md'] });
  set = place(set, 'b.md');
  assert.deepEqual(shape(set).columns, ['1:a.md@a.md', '2:a.md,b.md@b.md']);
  // A column added from the first goes right after it.
  set = split(focus(set, '1'));
  assert.deepEqual(
    set.columns.map((column) => column.id),
    ['1', '3', '2'],
  );
  while (set.columns.length < stageColumnLimit) set = split(set);
  assert.equal(split(set), set);
  // A column added while nothing is on show starts empty.
  assert.deepEqual(shape(split(firstStage)).columns, ['1:@', '2:@']);
});

test('A file opened into a named column gives it the focus', () => {
  const set = place(split(place(firstStage, 'a.md')), 'c.md', '1');
  assert.deepEqual(shape(set), { focus: '1', columns: ['1:a.md,c.md@c.md', '2:a.md@a.md'] });
  // An unknown column is the focused one.
  assert.equal(place(firstStage, 'x.md', 'gone').focus, '1');
});

test('Closing the tab on show shows the next one, or the one before the last', () => {
  const set = ['a.md', 'b.md', 'c.md'].reduce((all, path) => place(all, path), firstStage);
  assert.equal(focused(closeTab(place(set, 'b.md'), '1', 'b.md')).on, 'c.md');
  assert.equal(focused(closeTab(set, '1', 'c.md')).on, 'b.md');
  assert.equal(focused(closeTab(set, '1', 'a.md')).on, 'c.md');
  assert.deepEqual(shape(closeTab(place(firstStage, 'a.md'), '1', 'a.md')).columns, ['1:@']);
});

test('Closing a column moves the focus beside it; the last column stays', () => {
  const set = split(split(place(firstStage, 'a.md')));
  assert.deepEqual(
    set.columns.map((column) => column.id),
    ['1', '2', '3'],
  );
  assert.equal(closeColumn(set, '3').focus, '2');
  assert.equal(closeColumn(focus(set, '1'), '1').focus, '2');
  assert.equal(closeColumn(set, '1').focus, '3');
  assert.equal(closeColumn(firstStage, '1'), firstStage);
});

test('Tabs follow a moved folder and leave with a deleted file', () => {
  let set = ['notes/a.md', 'notes/b.md', 'c.md'].reduce(
    (all, path) => place(all, path),
    firstStage,
  );
  set = split(place(set, 'notes/a.md'));
  const renamed = follow(set, moved('notes', 'wiki'));
  assert.deepEqual(shape(renamed).columns, [
    '1:wiki/a.md,wiki/b.md,c.md@wiki/a.md',
    '2:wiki/a.md@wiki/a.md',
  ]);
  // `notes2` is not inside `notes`.
  assert.deepEqual(follow(place(firstStage, 'notes2/x.md'), moved('notes')).columns[0].tabs, [
    'notes2/x.md',
  ]);
  const deleted = follow(set, moved('notes/a.md'));
  assert.deepEqual(shape(deleted).columns, ['1:notes/b.md,c.md@notes/b.md', '2:@']);
  // Two tabs that became one file stay one.
  assert.deepEqual(follow(set, () => 'one.md').columns[0].tabs, ['one.md']);
});
