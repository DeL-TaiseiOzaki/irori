import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findAll, FindTurns, foldForFind } from '../src/domain/find';

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

test('a search overtaken before it shows hands on bringing its occurrence into view', () => {
  const turns = new FindTurns();
  // A new word is looked for, scrolling to the first occurrence from the top.
  const typed = turns.begin(true, undefined);
  // A redraw searches again before that answer is back; it would keep the old place, unscrolled.
  const redraw = turns.begin(false, 3);
  assert.deepEqual(redraw, { turn: redraw.turn, scroll: true, keep: undefined });
  assert.equal(turns.current(typed.turn), false);
  assert.equal(turns.current(redraw.turn), true);
  // Once one has been shown, a redraw's search stays where the person is.
  assert.deepEqual(turns.begin(false, 0), { turn: redraw.turn + 1, scroll: false, keep: 0 });
  // A closed bar shows no answer still on its way, and owes nothing.
  const late = turns.begin(true, undefined);
  turns.drop();
  assert.equal(turns.current(late.turn), false);
  assert.equal(turns.begin(false, 2).scroll, false);
});
