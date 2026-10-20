/*
 * A footnote mark, a wiki link or a callout's marker is one piece of a paragraph,
 * a list item or a table cell, kept as its exact text. The block around it is
 * edited as any other, as Notion edits a mention, instead of turning into source.
 * Only what the editor cannot carry through unchanged stays literal text.
 */

export const footnoteMark = /\[\^([^\]\s]+)\]/;
/** `[[target]]`, `[[target|label]]` and `![[embed]]`; a table cell writes `\|`. */
export const wikiLink = /(!?)\[\[([^\]|#\\]*)(?:#([^\]|\\]*))?(?:\\?\|([^\]]*))?\]\]/;
/** `[!note]`, `[!tip]-`: what opens a callout, at the start of a quote. */
const calloutMarker = /\[![\w-]+\][+-]?/;
const inlinePieces = new RegExp(`${wikiLink.source}|${footnoteMark.source}`, 'g');
/** Pieces as the source writes them: a callout marker only at a quote's start. */
const writtenPieces = new RegExp(
  `${inlinePieces.source}|(?<=^[ \\t]*(?:>[ \\t]?)+)${calloutMarker.source}`,
  'gm',
);
/** What only literal text carries through unchanged. */
const literalSyntax = /\[\[|^>\s*\[!|^\s*<|^\s*:::|\$\$|\{[%{]|\[\^[^\]]+\]/m;

export type PieceKind = 'footnote' | 'wiki' | 'embed' | 'callout';
/** What a piece shows: its kind, and the label a reader sees. */
export function readPiece(value: string): { kind: PieceKind; label: string } {
  const callout = /^\[!([\w-]+)\]/.exec(value);
  if (callout) return { kind: 'callout', label: callout[1] };
  const footnote = new RegExp(`^${footnoteMark.source}$`).exec(value);
  if (footnote) return { kind: 'footnote', label: footnote[1] };
  const [, embed, target, heading, label] = new RegExp(`^${wikiLink.source}$`).exec(value) ?? [];
  return {
    kind: embed ? 'embed' : 'wiki',
    label: label || [target, heading].filter(Boolean).join(' › ') || value,
  };
}

/** Pieces typed into a paragraph; a callout marker counts only where a callout opens. */
export const typedPieces = new RegExp(`${inlinePieces.source}|${calloutMarker.source}`, 'g');

export type Mdast = {
  type: string;
  value?: string;
  label?: string;
  children?: Mdast[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};

/** Splits a text into the pieces it writes and the text around them. */
function splitText(value: string): Mdast[] {
  const out: Mdast[] = [];
  let last = 0;
  for (const match of value.matchAll(inlinePieces)) {
    if (match.index > last) out.push({ type: 'text', value: value.slice(last, match.index) });
    out.push({ type: 'iroriInline', value: match[0] });
    last = match.index + match[0].length;
  }
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) });
  return out;
}

/**
 * Turns a block's footnote marks, wiki links and callout marker into pieces.
 * False, and the block stays literal, unless the parsed block accounts for every
 * piece the source writes, in order: an escape inside a link, or a marker past a
 * quote's first line, is not one the editor can write back.
 */
function toPieces(node: Mdast, written: string[]): boolean {
  const visit = (parent: Mdast) => {
    if (!parent.children) return;
    const first = parent.children[0]?.children?.[0];
    const marker =
      parent.type === 'blockquote' && first?.type === 'text'
        ? new RegExp(`^${calloutMarker.source}`).exec(first.value!)
        : null;
    if (marker && first) {
      first.value = first.value!.slice(marker[0].length);
      parent.children[0].children!.unshift({ type: 'iroriInline', value: marker[0] });
    }
    parent.children = parent.children.flatMap((child) => {
      if (child.type === 'footnoteReference')
        return [{ type: 'iroriInline', value: `[^${child.label}]` }];
      if (child.type === 'text' && child.value) return splitText(child.value);
      visit(child);
      return [child];
    });
  };
  visit(node);
  // Code and HTML show their text as written; what looks like a piece there stays text.
  const shown: Array<{ piece?: Mdast; value: string }> = [];
  const collect = (parent: Mdast) => {
    for (const child of parent.children ?? []) {
      if (child.type === 'iroriInline') shown.push({ piece: child, value: child.value! });
      else if (child.type === 'inlineCode' || child.type === 'code' || child.type === 'html')
        for (const [value] of (child.value ?? '').matchAll(writtenPieces)) shown.push({ value });
      else collect(child);
    }
  };
  collect(node);
  const plain = (value: string) => value.replace(/\\\|/g, '|');
  if (shown.length !== written.length) return false;
  if (shown.some(({ value }, index) => plain(value) !== plain(written[index]))) return false;
  // A table cell writes a link's `|` as `\|`; the piece keeps what is written.
  shown.forEach(({ piece }, index) => piece && (piece.value = written[index]));
  return true;
}

/**
 * The editor's reading of a document's top-level blocks. Frontmatter, and a block
 * holding Markdown the editor would rewrite (HTML, math, directives, templates),
 * stays as its exact text; footnote marks, wiki links and callout markers become
 * pieces of an editable block.
 */
export function preserveTree(tree: { children: unknown[] }, source: string) {
  const frontmatter = /^(?:---\n[\s\S]*?\n---|\+\+\+\n[\s\S]*?\n\+\+\+)(?:\n|$)/.exec(source)?.[0];
  tree.children = (tree.children as Mdast[]).flatMap((node) => {
    const start = node.position?.start.offset ?? 0;
    const end = node.position?.end.offset ?? start;
    if (frontmatter && start < frontmatter.length)
      return start === 0 ? [{ type: 'iroriLiteral', value: frontmatter.trimEnd() }] : [];
    const raw = source.slice(start, end);
    // Crepe serializes empty paragraphs as HTML breaks; display document spacing.
    if (/^<br\s*\/?>(?:\s*)$/i.test(raw.trim())) return [{ type: 'paragraph', children: [] }];
    if (node.type === 'code' || !literalSyntax.test(raw)) return [node];
    // A definition, `[^name]: text`, is the editor's footnote block; its name is no piece.
    const body = node.type === 'footnoteDefinition' ? raw.replace(/^\[\^[^\]\s]+\]:/, '') : raw;
    const written = [...body.matchAll(writtenPieces)].map((match) => match[0]);
    if (!literalSyntax.test(body.replace(writtenPieces, '')) && toPieces(node, written))
      return [node];
    return [{ type: 'iroriLiteral', value: raw }];
  });
}

/**
 * How a note writes its list bullets and dividers, so an edit writes new and
 * rewritten ones the same way: `-` and `---` stay as they are instead of
 * becoming the serializer's `*` and `***`, which remain the default.
 */
export function writingStyle(text: string): { bullet: '-' | '*' | '+'; rule: '-' | '*' | '_' } {
  const body = text.replace(/^(?:---\n[\s\S]*?\n---|\+\+\+\n[\s\S]*?\n\+\+\+)(?:\n|$)/, '');
  const outside = body.replace(/^ {0,3}(```|~~~)[\s\S]*?^ {0,3}\1/gm, '');
  const rule = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/m.exec(outside)?.[1];
  const bullet = /^[ \t]*([-*+])[ \t]+\S/m.exec(
    outside.replace(/^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, ''),
  )?.[1];
  return {
    bullet: (bullet ?? '*') as '-' | '*' | '+',
    rule: (rule ?? '*') as '-' | '*' | '_',
  };
}
