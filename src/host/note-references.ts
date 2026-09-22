import { isMap, isScalar, isSeq, parseDocument } from 'yaml';
import { frontmatterBlock } from '../domain/graph-index';
import { linkCount, linksTo, resolveNoteLink, rewriteLinks, samePath } from '../domain/note-links';

type Reference = { start: number; end: number; href: string; rooted: boolean };

/** Read scalar locations, not a reserialised YAML document: comments and unrelated bytes stay. */
function metadata(text: string) {
  const block = frontmatterBlock(text);
  if (block === undefined) return { body: 0, references: [] as Reference[] };
  const start =
    (text.startsWith('\uFEFF') ? 1 : 0) +
    /^---[^\n]*\n/.exec(text.replace(/^\uFEFF/, ''))![0].length;
  const close = start + block.length;
  const body = text.indexOf('\n', close) < 0 ? text.length : text.indexOf('\n', close) + 1;
  const document = parseDocument(block, { schema: 'failsafe', logLevel: 'silent' });
  if (document.errors.length)
    throw Error('frontmatter の構文を確認してからリンクを更新してください。');
  const references: Reference[] = [];
  if (!isMap(document.contents)) return { body, references };
  for (const [key, field] of [
    ['relations', 'target'],
    ['sources', 'resource'],
  ] as const) {
    const sequence = document.contents.get(key, true);
    if (sequence === undefined) continue;
    if (!isSeq(sequence)) throw Error('frontmatter の関係・出典は配列で指定してください。');
    for (const item of sequence.items) {
      if (!isMap(item)) throw Error('frontmatter の関係・出典の参照を確認してください。');
      const value = item.get(field, true);
      if (value === undefined) continue;
      if (!isScalar(value) || typeof value.value !== 'string' || !value.range || value.anchor)
        throw Error('frontmatter の参照には単一行の文字列を指定してください。');
      const [from, to] = value.range;
      if (/[\r\n]/.test(block.slice(from, to)))
        throw Error('複数行の frontmatter 参照は自動更新できません。');
      references.push({
        start: start + from,
        end: start + to,
        href: value.value,
        rooted: key === 'sources' && /^(?:Knowledge_Base|contents)\//.test(value.value),
      });
    }
  }
  return { body, references };
}

const origin = (from: string, reference: Reference) => (reference.rooted ? 'index.md' : from);
function relative(from: string, target: string) {
  const base = from.split('/').slice(0, -1),
    parts = target.split('/');
  let shared = 0;
  while (shared < base.length && base[shared] === parts[shared]) shared++;
  return [...base.slice(shared).map(() => '..'), ...parts.slice(shared)].join('/');
}

function scalar(value: string, before: string) {
  if (before.startsWith("'")) return "'" + value.replaceAll("'", "''") + "'";
  if (before.startsWith('"')) return JSON.stringify(value);
  // Keep a plain scalar only when its YAML meaning cannot change, including in flow arrays.
  return /^[\p{L}\p{N}_./%~-][\p{L}\p{N}_./%~ -]*$/u.test(value) && !/\s$/.test(value)
    ? value
    : JSON.stringify(value);
}

/** Count actual OKF references and Markdown body links, never a description containing Markdown. */
export function noteReferenceCount(text: string, from: string, target: string) {
  const { body, references } = metadata(text);
  return (
    linkCount(text.slice(body), from, target) +
    references.filter((reference) => {
      const link = resolveNoteLink(origin(from, reference), reference.href);
      return link.kind === 'internal' && samePath(link.path, target);
    }).length
  );
}

/** A line matcher for the existing guarded/indexed scan used by move previews and updates. */
export function referencesTo(text: string, from: string, target: string, foldCase = false) {
  const { body, references } = metadata(text);
  const at = new Set<number>();
  for (const reference of references) {
    const link = resolveNoteLink(origin(from, reference), reference.href);
    if (link.kind === 'internal' && samePath(link.path, target, foldCase)) at.add(reference.start);
  }
  const bodyMatch = linksTo(from, target, foldCase);
  const positions = [...at].sort((a, b) => a - b);
  let referenceIndex = 0;
  const endings = text.match(/\r\n|\n|\r/g) ?? [];
  let offset = 0,
    lineNumber = 0;
  return (line: string): RegExpExecArray | null => {
    const start = offset;
    offset += line.length + (endings[lineNumber++]?.length ?? 0);
    if (start >= body) return bodyMatch(line);
    while (positions[referenceIndex] < start) referenceIndex++;
    const position = positions[referenceIndex];
    if (position !== undefined && position < start + line.length) {
      const index = position - start;
      return Object.assign([line.slice(index)] as [string], { index, input: line });
    }
    return null;
  };
}

/** Change only supported reference scalars and body destinations; keep BOM, line endings and comments. */
export function rewriteNoteReferences(
  text: string,
  from: string,
  to: string,
  moved: (path: string) => string | undefined,
) {
  const { body, references } = metadata(text);
  let output = '',
    cursor = 0,
    links = 0;
  for (const reference of references.sort((a, b) => a.start - b.start)) {
    const link = resolveNoteLink(origin(from, reference), reference.href);
    if (link.kind !== 'internal') continue;
    const next = moved(link.path.normalize('NFC'));
    if (next === undefined) continue;
    const current = resolveNoteLink(origin(to, reference), reference.href);
    if (current.kind === 'internal' && samePath(current.path, next)) continue;
    const fragment = reference.href.includes('#')
      ? reference.href.slice(reference.href.indexOf('#'))
      : '';
    let value = relative(origin(to, reference), next);
    value = value.replace(/[%#]/g, (char) => '%' + char.charCodeAt(0).toString(16).toUpperCase());
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) value = './' + value;
    output +=
      text.slice(cursor, reference.start) +
      scalar(value + fragment, text.slice(reference.start, reference.end));
    cursor = reference.end;
    links++;
  }
  const rewritten = rewriteLinks(text.slice(body), from, to, moved);
  return {
    text: output + text.slice(cursor, body) + rewritten.text,
    links: links + rewritten.links,
  };
}
