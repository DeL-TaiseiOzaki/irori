import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import { findAll } from '../domain/find';

/**
 * The find bar's marks in a CodeMirror view: the source view, or a code block in
 * the rich view. `current` is where the current occurrence starts, if it is here.
 */
export const setFind = StateEffect.define<{ query: string; current?: number }>();

const hit = Decoration.mark({ class: 'find-hit' });
const currentHit = Decoration.mark({ class: 'find-hit current' });

function marks(text: string, query: string, current?: number): DecorationSet {
  if (!query) return Decoration.none;
  return Decoration.set(
    findAll(text, query).map((at) =>
      (at === current ? currentHit : hit).range(at, at + query.length),
    ),
  );
}

export const findMarks = StateField.define<{
  query: string;
  current?: number;
  decorations: DecorationSet;
}>({
  create: () => ({ query: '', decorations: Decoration.none }),
  update(value, transaction) {
    let next: { query: string; current?: number } = { query: value.query, current: value.current };
    for (const effect of transaction.effects) if (effect.is(setFind)) next = effect.value;
    if (next.query === value.query && next.current === value.current && !transaction.docChanged)
      return value;
    // An edit keeps the current occurrence where its text went, until the bar searches again.
    const current =
      transaction.docChanged && next.current !== undefined && next.current === value.current
        ? transaction.changes.mapPos(next.current, 1)
        : next.current;
    return {
      query: next.query,
      current,
      decorations: marks(transaction.state.doc.toString(), next.query, current),
    };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});
