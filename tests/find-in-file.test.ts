import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findAll, foldForFind } from '../src/domain/find';

test('finding in a file ignores case and full-width ASCII, as written otherwise', () => {
  assert.deepEqual(findAll('Irori, IRORI and irori', 'irori'), [0, 7, 17]);
  assert.deepEqual(findAll('ＡＢＣ と abc', 'abc'), [0, 6]);
  assert.deepEqual(findAll('abc', 'ＡＢＣ'), [0]);
  assert.deepEqual(findAll('議事録\u3000メモ', '議事録 メモ'), [0]);
  // Kana and kanji are matched as written.
  assert.deepEqual(findAll('カタカナ かたかな', 'かたかな'), [5]);
});

test('finding in a file counts occurrences without overlaps, in order', () => {
  assert.deepEqual(findAll('aaaa', 'aa'), [0, 2]);
  assert.deepEqual(findAll('a.b a*b', '.'), [1]);
  assert.deepEqual(findAll('text', ''), []);
  assert.deepEqual(findAll('', 'text'), []);
  assert.deepEqual(findAll('no match', 'irori'), []);
});

test('folding keeps every offset where it was in the text on show', () => {
  for (const text of ['İstanbul İ', 'ＦＵＬＬ\u3000ｗｉｄｔｈ', 'Ωmega ß', '😀 Emoji Ａ'])
    assert.equal(foldForFind(text).length, text.length, text);
  // A character that lower-cases to two keeps its place; the rest still fold.
  assert.deepEqual(findAll('İSTANBUL', 'stan'), [1]);
  assert.deepEqual(findAll('😀 Emoji', 'emoji'), [3]);
});
