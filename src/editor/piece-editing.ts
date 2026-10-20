import { Plugin, PluginKey, TextSelection, type EditorState } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import type { Node } from '@milkdown/kit/prose/model';
import { $prose } from '@milkdown/kit/utils';
import { readPiece, typedPieces } from './pieces';

/*
 * Pieces (pieces.ts) are edited as Notion edits a mention: typed text becomes one
 * when it closes, a double click opens it as its text again, and a quote whose
 * first piece is a callout marker shows as a callout. Nothing here changes what
 * is saved; a piece is written back as the text it stands for.
 */

/** A paragraph's pieces as typed: text written as a piece becomes one, unless the cursor is inside it. */
function piecesTyped(state: EditorState, positions: number[]) {
  const type = state.schema.nodes.irori_inline;
  const { head } = state.selection;
  const found: Array<{ from: number; to: number; value: string }> = [];
  const seen = new Set<number>();
  for (const at of positions) {
    const $at = state.doc.resolve(Math.min(Math.max(at, 0), state.doc.content.size));
    const block = $at.parent;
    const start = $at.start();
    if (!block.isTextblock || block.type.spec.code || seen.has(start)) continue;
    seen.add(start);
    // A callout marker is a piece only where a callout opens: a quote's first text.
    const quote = $at.depth > 1 ? $at.node($at.depth - 1) : undefined;
    const opensQuote = quote?.type.name === 'blockquote' && quote.firstChild === block;
    block.forEach((child, offset) => {
      if (!child.isText || child.marks.some((mark) => mark.type.spec.code)) return;
      for (const match of child.text!.matchAll(typedPieces)) {
        if (match[0].startsWith('[!') && !(opensQuote && offset + match.index === 0)) continue;
        const from = start + offset + match.index;
        const to = from + match[0].length;
        if (head > from && head < to) continue;
        found.push({ from, to, value: match[0] });
      }
    });
  }
  if (!found.length) return null;
  const tr = state.tr;
  for (const { from, to, value } of found.sort((a, b) => b.from - a.from))
    tr.replaceWith(from, to, type.create({ value }));
  return tr;
}

const typingKey = new PluginKey('irori-piece-typing');
export const pieceTyping = $prose(
  () =>
    new Plugin({
      key: typingKey,
      appendTransaction: (transactions, before, state) => {
        if (!transactions.some((tr) => tr.docChanged || tr.selectionSet)) return null;
        // Undo and redo restore what was there; closing a piece again would undo the undo.
        if (transactions.some((tr) => tr.getMeta('history$'))) return null;
        // The paragraph the cursor was in and the one it is in now: one being left
        // has its pieces closed, one being typed in gains them as they close.
        let left = before.selection.head;
        for (const tr of transactions) left = tr.mapping.map(left);
        return piecesTyped(state, [left, state.selection.head]);
      },
      props: {
        handleDoubleClickOn: (view, _pos, node, nodePos, _event, direct) => {
          if (!direct || node.type.name !== 'irori_inline') return false;
          const value = String(node.attrs.value);
          const tr = view.state.tr.replaceWith(
            nodePos,
            nodePos + node.nodeSize,
            view.state.schema.text(value),
          );
          // The cursor stands inside the text, so it stays text while it is edited.
          tr.setSelection(TextSelection.create(tr.doc, nodePos + value.length - 1));
          view.dispatch(tr);
          return true;
        },
      },
    }),
);

/** A quote whose first piece is a callout marker shows as a callout, its first line as its title. */
function callouts(doc: Node) {
  const found: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'blockquote') return true;
    const paragraph = node.firstChild;
    const marker = paragraph?.firstChild;
    if (!paragraph || marker?.type.name !== 'irori_inline') return true;
    const piece = readPiece(String(marker.attrs.value));
    if (piece.kind !== 'callout') return true;
    found.push(
      Decoration.node(pos, pos + node.nodeSize, {
        class: `callout callout-${piece.label.toLowerCase()}`,
      }),
    );
    // The title runs from the marker to the first line break.
    const first = pos + 2;
    let end = first + paragraph.content.size;
    paragraph.forEach((child, offset) => {
      if (child.type.name !== 'hardbreak' || first + offset >= end) return;
      end = first + offset;
      found.push(Decoration.node(end, end + child.nodeSize, { class: 'callout-break' }));
    });
    if (end > first + marker.nodeSize)
      found.push(Decoration.inline(first + marker.nodeSize, end, { class: 'callout-title' }));
    return true;
  });
  return DecorationSet.create(doc, found);
}

const calloutKey = new PluginKey<DecorationSet>('irori-callouts');
export const calloutView = $prose(
  () =>
    new Plugin({
      key: calloutKey,
      state: {
        init: (_, state) => callouts(state.doc),
        apply: (tr, decorations) => (tr.docChanged ? callouts(tr.doc) : decorations),
      },
      props: { decorations: (state) => calloutKey.getState(state) },
    }),
);
