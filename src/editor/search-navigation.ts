import type { Node } from '@milkdown/kit/prose/model';

export interface SearchTarget {
  query: string;
  line: number;
  preview: string;
  /** Where the query stands on the line, when the caller knows; a link's label rather than the first same text. */
  column?: number;
}
export interface SourceNode {
  type: string;
  value?: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: SourceNode[];
}

function occurrences(text: string, query: string) {
  const found: number[] = [];
  if (!query) return found;
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  for (const match of text.matchAll(pattern)) found.push(match.index);
  return found;
}

export function sourceMatch(text: string, target: SearchTarget) {
  const lines = text.split('\n');
  const line = lines[target.line - 1];
  if (line === undefined) return null;
  const columns = occurrences(line, target.query);
  const column = columns.find((at) => at === target.column) ?? columns[0];
  if (column === undefined) return null;
  // A stale result must not silently jump to an unrelated line after external edits.
  const preview = target.preview.replace(/^…|…$/g, '');
  if (preview && !line.includes(preview)) return null;
  const from =
    lines.slice(0, target.line - 1).reduce((sum, value) => sum + value.length + 1, 0) + column;
  return { from, to: from + target.query.length };
}

export function richMatch(doc: Node, source: string, target: SearchTarget, ast: SourceNode) {
  const match = sourceMatch(source, target);
  if (!match) return null;
  const visibleSource: number[] = [];
  function collect(node: SourceNode) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    // Only source spans proven to be ordinary displayed text are navigable.
    // Destinations, entities, generated text and metadata cannot stand in for them.
    if (
      node.type === 'text' &&
      start !== undefined &&
      end !== undefined &&
      source.slice(start, end) === node.value
    )
      for (const offset of occurrences(node.value!, target.query))
        visibleSource.push(start + offset);
    for (const child of node.children ?? []) collect(child);
  }
  collect(ast);
  const index = visibleSource.indexOf(match.from);
  if (index === -1) return null;
  const matches: { from: number; to: number }[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // Joining text across inline marks also finds phrases containing bold/italic spans.
    const text = node.textBetween(0, node.content.size, '', '\ufffc');
    for (const offset of occurrences(text, target.query))
      matches.push({ from: pos + 1 + offset, to: pos + 1 + offset + target.query.length });
    return false;
  });
  // Markdown punctuation, destinations and hidden metadata are not always visible.
  // Select only when source and rendered occurrences have an unambiguous ordering.
  if (visibleSource.length !== matches.length) return null;
  return matches[index] ?? null;
}

/** The first line of a quote that has text, trimmed: what a rendered view and its source share. */
export function quoteHead(quote: string) {
  return (
    quote
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) ?? ''
  );
}

/** Where each occurrence of `text` starts in `source`, exactly as written. */
export function positionsOf(source: string, text: string) {
  const found: number[] = [];
  if (!text) return found;
  for (let at = source.indexOf(text); at !== -1; at = source.indexOf(text, at + 1)) found.push(at);
  return found;
}

/** The 1-based line of an offset in `source`. */
export function lineAt(source: string, offset: number) {
  let line = 1;
  for (let at = source.indexOf('\n'); at !== -1 && at < offset; at = source.indexOf('\n', at + 1))
    line++;
  return line;
}

/**
 * The line of the source a rendered selection stands on: the `index`-th place
 * its first line occurs in the source, or the first when the source shows it
 * fewer times (formatting inside it, say). Undefined when the source does not
 * carry it at all.
 */
export function sourceLineOf(source: string, quote: string, index: number) {
  const at = positionsOf(source, quoteHead(quote));
  const offset = at[index] ?? at[0];
  return offset === undefined ? undefined : lineAt(source, offset);
}

/** Which of `positions` is on the line nearest to `line`, or the first without one. */
export function nearest(source: string, positions: number[], line?: number) {
  if (!positions.length) return undefined;
  if (!line) return positions[0];
  return positions.reduce((best, at) =>
    Math.abs(lineAt(source, at) - line) < Math.abs(lineAt(source, best) - line) ? at : best,
  );
}
