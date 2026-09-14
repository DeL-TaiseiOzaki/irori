import type { Node } from '@milkdown/kit/prose/model';

export interface SearchTarget {
  query: string;
  line: number;
  preview: string;
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
  const column = occurrences(line, target.query)[0];
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
