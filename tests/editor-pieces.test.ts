import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import remarkGfm from 'remark-gfm';
import {
  preserveTree,
  readPiece,
  typedPieces,
  writingStyle,
  type Mdast,
} from '../src/editor/pieces';

/** The editor's reading of a note: its top-level block types and its pieces. */
function read(source: string) {
  const processor = unified().use(remarkParse).use(remarkGfm);
  const tree = processor.runSync(processor.parse(source)) as unknown as { children: Mdast[] };
  preserveTree(tree, source);
  const pieces: string[] = [];
  const walk = (node: Mdast) => {
    if (node.type === 'iroriInline') pieces.push(node.value!);
    node.children?.forEach(walk);
  };
  tree.children.forEach(walk);
  return { tree, blocks: tree.children.map((node) => node.type), pieces };
}

/** What the editor writes back: pieces and literal blocks as the HTML they are saved as. */
function write(tree: { children: Mdast[] }) {
  const asHtml = (node: Mdast): Mdast =>
    node.type === 'iroriInline' || node.type === 'iroriLiteral'
      ? { type: 'html', value: node.value }
      : { ...node, children: node.children?.map(asHtml) };
  return unified()
    .use(remarkStringify, { bullet: '-' })
    .use(remarkGfm)
    .stringify({ type: 'root', children: tree.children.map(asHtml) } as never);
}

test('A list, a table and a paragraph with footnote marks and wiki links stay editable blocks', () => {
  const source = [
    '- 09-28 内部定例。[^internal-0928]',
    '- 10-01 キックオフ。[^kickoff-minutes]',
    '',
    '| 案 | 出典 |',
    '| --- | --- |',
    '| 1A | [^internal-0928] |',
    '| 1B | [[議事録/1001\\|議事録]] |',
    '',
    '詳細は [[議事録/1001|キックオフ議事録]] と ![[図表]] を参照。[^missing]',
    '',
    '[^internal-0928]: 2026-09-28 のメモ。[[メモ]]',
    '',
    '[^kickoff-minutes]: 議事録。',
    '',
  ].join('\n');
  const { tree, blocks, pieces } = read(source);
  assert.deepEqual(blocks, [
    'list',
    'table',
    'paragraph',
    'footnoteDefinition',
    'footnoteDefinition',
  ]);
  assert.deepEqual(pieces, [
    '[^internal-0928]',
    '[^kickoff-minutes]',
    '[^internal-0928]',
    '[[議事録/1001\\|議事録]]',
    '[[議事録/1001|キックオフ議事録]]',
    '![[図表]]',
    '[^missing]',
    '[[メモ]]',
  ]);
  // Written back, the note is the same text, a cell's `\|` included. (A table's column
  // padding is the serializer's, as for any table.)
  const unpadded = (text: string) => text.replace(/ +\|/g, ' |').replace(/-+/g, '-');
  assert.equal(unpadded(write(tree)), unpadded(source));
});

test('A callout is a quote whose marker is a piece; its title and text stay its own', () => {
  const source = '> [!note] 前提\n> 先方との合意事項として扱わない。\n';
  const { tree, blocks, pieces } = read(source);
  assert.deepEqual(blocks, ['blockquote']);
  assert.deepEqual(pieces, ['[!note]']);
  assert.equal(write(tree), source);
  // A marker past the quote's first line is not a callout's; that quote stays literal.
  assert.deepEqual(read('> 前提\n> [!note] 途中\n').blocks, ['iroriLiteral']);
});

test('What the editor cannot write back stays literal text', () => {
  for (const source of [
    '$$\nx^2\n$$\n',
    '<div>raw</div>\n',
    ':::note\ntext\n:::\n',
    '{{ template }} [^a]\n',
    // An escape inside a link's target would not survive as a piece.
    '[[a\\_b]]\n',
  ])
    assert.deepEqual(read(source).blocks, ['iroriLiteral'], source);
  // Code shows its text as written: a footnote mark there is code, not a piece.
  const code = read('`[^x]` と [^y]\n');
  assert.deepEqual(code.blocks, ['paragraph']);
  assert.deepEqual(code.pieces, ['[^y]']);
  assert.equal(write(code.tree), '`[^x]` と [^y]\n');
});

test('A piece shows its label; typed text is a piece once it closes', () => {
  assert.deepEqual(readPiece('[^kickoff]'), { kind: 'footnote', label: 'kickoff' });
  assert.deepEqual(readPiece('[[a/b|ラベル]]'), { kind: 'wiki', label: 'ラベル' });
  assert.deepEqual(readPiece('[[a/b#節]]'), { kind: 'wiki', label: 'a/b › 節' });
  assert.deepEqual(readPiece('![[図表]]'), { kind: 'embed', label: '図表' });
  assert.deepEqual(readPiece('[!warning]-'), { kind: 'callout', label: 'warning' });
  const typed = (text: string) => [...text.matchAll(typedPieces)].map((match) => match[0]);
  assert.deepEqual(typed('本文[[ページ]]と[^note]'), ['[[ページ]]', '[^note]']);
  assert.deepEqual(typed('[!tip] 本文[[ページ]'), ['[!tip]']);
});

test('An edit writes bullets and dividers as the note already does', () => {
  assert.deepEqual(writingStyle('---\ntitle: x\n---\n\n- one\n\n---\n'), {
    bullet: '-',
    rule: '-',
  });
  assert.deepEqual(writingStyle('* one\n\n***\n'), { bullet: '*', rule: '*' });
  // Code is not the note's own writing; a note without either keeps the default.
  assert.deepEqual(writingStyle('```\n- x\n---\n```\n\nText.\n'), { bullet: '*', rule: '*' });
});
