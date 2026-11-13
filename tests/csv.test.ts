import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../src/domain/csv';

const table =
  '﻿id,label,note,parentId,group,unknown\r\nroot,ナレッジ,notes/概念.md,,基礎,"keep, this"\r\nresearch,調査,notes/調査.md,root,調査,"two\r\nlines"\r\n';

test('The CSV table retains quoted unknown fields, BOM/CRLF values and string identities', () => {
  const parsed = parseCsv(table);
  assert.equal(parsed.columns.at(-1), 'unknown');
  assert.equal(parsed.rows[0].at(-1), 'keep, this');
  assert.equal(parsed.rows[1].at(-1), 'two\r\nlines');
  assert.deepEqual(parseCsv('id,value\n001,=formula\n').rows, [['001', '=formula']]);
  for (const text of ['id,id\nx,y', 'id,label\nx,y,z', 'id,label\nx,"unclosed'])
    assert.throws(() => parseCsv(text));
  assert.throws(() => parseCsv('id\n' + 'x\n'.repeat(20001)), /20,000/);
});
