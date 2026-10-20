import { $node, $remark } from '@milkdown/kit/utils';
import { preserveTree, readPiece } from './pieces';

/** Unsupported blocks stay visible and editable as literal text in the document. */
export const literalBlock = $node('irori_literal', () => ({
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,
  parseDOM: [{ tag: 'pre[data-irori-literal]', preserveWhitespace: 'full' }],
  toDOM: () => ['pre', { 'data-irori-literal': '', class: 'literal-block' }, ['code', {}, 0]],
  parseMarkdown: {
    match: (node) => node.type === 'iroriLiteral',
    runner: (state, node, type) => {
      state.openNode(type);
      if (node.value) state.addText(String(node.value));
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'irori_literal',
    runner: (state, node) => {
      state.addNode('html', undefined, node.textContent);
    },
  },
}));

export const pieceClass = {
  footnote: 'footnote-mark',
  wiki: 'wiki-link',
  embed: 'wiki-link wiki-embed',
  callout: 'callout-marker',
};
/** A footnote mark, wiki link or callout marker: one piece, written back as its text. */
export const inlinePiece = $node('irori_inline', () => ({
  group: 'inline',
  inline: true,
  atom: true,
  attrs: { value: { default: '' } },
  parseDOM: [
    {
      tag: 'span[data-irori-inline]',
      getAttrs: (dom) => ({ value: (dom as HTMLElement).dataset.iroriInline ?? '' }),
    },
  ],
  toDOM: (node) => {
    const value = String(node.attrs.value);
    const { kind, label } = readPiece(value);
    return ['span', { 'data-irori-inline': value, class: pieceClass[kind], title: value }, label];
  },
  parseMarkdown: {
    match: (node) => node.type === 'iroriInline',
    runner: (state, node, type) => {
      state.addNode(type, { value: String(node.value) });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'irori_inline',
    runner: (state, node) => {
      // HTML is written as it is, unescaped, wherever it stands.
      state.addNode('html', undefined, String(node.attrs.value));
    },
  },
}));

export const preserveBlocks = $remark(
  'irori-preservation',
  () => () => (tree, file) => preserveTree(tree, String(file)),
);
export function documentEncoding(text: string) {
  const bom = text.startsWith('\uFEFF') ? '\uFEFF' : '';
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  return {
    body: text.slice(bom.length).replace(/\r\n/g, '\n'),
    restore: (value: string) => bom + value.replace(/\r\n/g, '\n').replace(/\n/g, newline),
  };
}
