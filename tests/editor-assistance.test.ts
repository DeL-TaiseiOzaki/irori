import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Compartment, EditorState } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { HighlightStyle, highlightingFor, syntaxTree } from '@codemirror/language';
import { historyField, undoDepth, undo, redo } from '@codemirror/commands';
import { tags } from '@lezer/highlight';
import { assistanceExtensions, editingCore, languageForFilename } from '../src/editor/assistance';

test('Assistance reconfiguration preserves text, selections, history, readonly and search', () => {
  const configuration = new Compartment();
  const readonly = new Compartment();
  const highlight = HighlightStyle.define([{ tag: tags.keyword, class: 'fixture-keyword' }]);
  let state = EditorState.create({
    doc: 'const value = 1;\n',
    extensions: [
      editingCore,
      readonly.of(EditorState.readOnly.of(true)),
      configuration.of(assistanceExtensions(true, highlight)),
    ],
  });
  state = state.update({
    changes: { from: 14, to: 15, insert: '2' },
    selection: { anchor: 6, head: 11 },
  }).state;
  const edited = state.doc.toString();
  const history = state.field(historyField);
  const selection = state.selection;
  for (const enabled of [false, true, false]) {
    const transaction = state.update({
      effects: configuration.reconfigure(assistanceExtensions(enabled, highlight)),
    });
    state = transaction.state;
    assert.equal(transaction.docChanged, false);
    assert.equal(transaction.selection, undefined);
    assert.equal(state.doc.toString(), edited);
    assert.ok(state.selection.eq(selection));
    assert.equal(state.field(historyField), history);
    assert.equal(undoDepth(state), 1);
    assert.equal(state.readOnly, true);
    assert.ok(
      state
        .facet(keymap)
        .flat()
        .some((binding) => binding.key === 'Mod-f'),
    );
    assert.equal(highlightingFor(state, [tags.keyword]), enabled ? 'fixture-keyword' : null);
  }
  // Readonly is a separate policy, so test undo after explicitly making this test state editable.
  state = state.update({ effects: readonly.reconfigure(EditorState.readOnly.of(false)) }).state;
  assert.ok(
    undo({
      state,
      dispatch: (transaction) => {
        state = transaction.state;
      },
    }),
  );
  assert.equal(state.doc.toString(), 'const value = 1;\n');
  assert.ok(
    redo({
      state,
      dispatch: (transaction) => {
        state = transaction.state;
      },
    }),
  );
  assert.equal(state.doc.toString(), edited);
});

test('Source filenames select real language parsers and unknown files remain plain text', async () => {
  const cases = [
    ['example.ts', 'const value: number = 1;', 'TypeAnnotation'],
    ['example.json', '{"value": 1}', 'Property'],
    ['note.md', '# Title\n', 'ATXHeading1'],
  ];
  for (const [filename, doc, node] of cases) {
    const state = EditorState.create({ doc, extensions: [await languageForFilename(filename)] });
    assert.ok(syntaxTree(state).toString().includes(node), `${filename} should parse ${node}`);
  }
  assert.deepEqual(await languageForFilename('unknown.irori-unknown'), []);
});
