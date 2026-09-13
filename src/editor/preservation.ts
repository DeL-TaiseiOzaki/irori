import { $node, $remark } from '@milkdown/kit/utils';

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
export const preserveBlocks = $remark('irori-preservation', () => () => (tree, file) => {
  const source = String(file);
  const frontmatter = /^(?:---\n[\s\S]*?\n---|\+\+\+\n[\s\S]*?\n\+\+\+)(?:\n|$)/.exec(source)?.[0];
  const children = tree.children as Array<{
    type: string;
    value?: string;
    position?: { start: { offset?: number }; end: { offset?: number } };
  }>;
  tree.children = children.flatMap((node) => {
    const start = node.position?.start.offset ?? 0;
    const end = node.position?.end.offset ?? start;
    if (frontmatter && start < frontmatter.length)
      return start === 0 ? [{ type: 'iroriLiteral', value: frontmatter.trimEnd() }] : [];
    const raw = source.slice(start, end);
    // Crepe serializes empty paragraphs as HTML breaks; display document spacing.
    if (/^<br\s*\/?>(?:\s*)$/i.test(raw.trim()))
      return [{ type: 'paragraph', children: [] }];
    if (node.type !== 'code' && /\[\[|^>\s*\[!|^\s*<|^\s*:::|\$\$|\{[%{]|\[\^[^\]]+\]/m.test(raw))
      return [{ type: 'iroriLiteral', value: raw }];
    return [node];
  }) as typeof tree.children;
});
export function documentEncoding(text: string) {
  const bom = text.startsWith('\uFEFF') ? '\uFEFF' : '';
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  return {
    body: text.slice(bom.length).replace(/\r\n/g, '\n'),
    restore: (value: string) => bom + value.replace(/\r\n/g, '\n').replace(/\n/g, newline),
  };
}
