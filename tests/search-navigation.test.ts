import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState } from '@codemirror/state';
import { richMatch, sourceMatch, type SourceNode } from '../src/editor/search-navigation';

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'text*', group: 'block' },
    text: { group: 'inline' },
  },
  marks: { strong: {} },
});
const p = (text: string) => schema.node('paragraph', null, schema.text(text));
const ast = (source: string, spans: string[]): SourceNode => {
  let cursor = 0;
  return {
    type: 'root',
    children: spans.map((value) => {
      const start = source.indexOf(value, cursor);
      assert.ok(start >= 0);
      cursor = start + value.length;
      return {
        type: 'text',
        value,
        position: { start: { offset: start }, end: { offset: cursor } },
      };
    }),
  };
};
test('search navigation identifies repeated later matches without changing source', () => {
  const source = '# Title\r\n\r\nneedle first\r\n\r\nneedle second\r\n';
  const target = { query: 'NEEDLE', line: 5, preview: 'needle second' };
  const match = sourceMatch(source, target)!;
  assert.equal(source.slice(match.from, match.to), 'needle');
  const doc = schema.node('doc', null, [p('Title'), p('needle first'), p('needle second')]);
  const rich = richMatch(
    doc,
    source,
    target,
    ast(source, ['Title', 'needle first', 'needle second']),
  )!;
  assert.equal(doc.textBetween(rich.from, rich.to), 'needle');
  assert.equal(rich.from, 22);
});
test('search navigation spans inline formatting and rejects hidden or stale matches', () => {
  const doc = schema.node(
    'doc',
    null,
    schema.node('paragraph', null, [
      schema.text('a '),
      schema.text('needle', [schema.mark('strong')]),
    ]),
  );
  const source = 'a **needle**';
  const target = { query: 'needle', line: 1, preview: source };
  assert.deepEqual(richMatch(doc, source, target, ast(source, ['a ', 'needle'])), {
    from: 3,
    to: 9,
  });
  assert.equal(
    richMatch(
      doc,
      source,
      { query: '**', line: 1, preview: source },
      ast(source, ['a ', 'needle']),
    ),
    null,
  );
  assert.equal(sourceMatch('needle replaced', target), null);
  assert.equal(sourceMatch(source, { ...target, line: 10 }), null);
});
test('Unicode case folding does not shift source or editor offsets', () => {
  const text = 'İ needle';
  const target = { query: 'needle', line: 1, preview: text };
  assert.deepEqual(sourceMatch(text, target), { from: 2, to: 8 });
  assert.deepEqual(richMatch(schema.node('doc', null, p(text)), text, target, ast(text, [text])), {
    from: 3,
    to: 9,
  });
});
test('equal occurrence counts cannot turn a hidden destination match into unrelated displayed text', () => {
  const source = '**nee**dle [other](needle)';
  const target = { query: 'needle', line: 1, preview: source };
  assert.equal(
    richMatch(
      schema.node('doc', null, p('needle other')),
      source,
      target,
      ast(source, ['nee', 'dle ', 'other']),
    ),
    null,
  );
  const linked = '[needle](needle)';
  assert.deepEqual(
    richMatch(
      schema.node('doc', null, p('needle')),
      linked,
      { query: 'needle', line: 1, preview: linked },
      ast(linked, ['needle']),
    ),
    { from: 1, to: 7 },
  );
});
test('a column picks the link over earlier same text, and the first stands in when it is gone', () => {
  const source = 'note before [note](note.md)';
  const target = { query: 'note', line: 1, preview: source };
  assert.deepEqual(sourceMatch(source, { ...target, column: 13 }), { from: 13, to: 17 });
  assert.deepEqual(sourceMatch(source, target), { from: 0, to: 4 });
  assert.deepEqual(sourceMatch(source, { ...target, column: 5 }), { from: 0, to: 4 });
  assert.deepEqual(
    richMatch(
      schema.node('doc', null, p('note before note')),
      source,
      { ...target, column: 13 },
      ast(source, ['note before ', 'note']),
    ),
    { from: 13, to: 17 },
  );
});
test('CRLF source navigation uses CodeMirror offsets without rewriting file encoding', () => {
  const source = 'first\r\n\r\nneedle\r\n';
  const state = EditorState.create({
    doc: source,
    extensions: [EditorState.lineSeparator.of('\r\n')],
  });
  const match = sourceMatch(state.doc.toString(), { query: 'needle', line: 3, preview: 'needle' })!;
  assert.equal(state.doc.sliceString(match.from, match.to), 'needle');
  assert.equal(state.sliceDoc(), source);
});
