import { z } from 'zod';
import { webAddress } from './links';
import { t } from './i18n';

/**
 * Where a link written in a note points. The recommended knowledge base writes
 * relative Markdown links between pages — a page's identity is its path in the
 * bundle (`irori-templete` ADR 002 D3) — so a link is resolved against the note
 * that carries it, never against the knowledge base root.
 */
export type LinkTarget =
  | { kind: 'external'; url: string }
  | { kind: 'internal'; path: string }
  | { kind: 'anchor' }
  | { kind: 'rejected'; reason: string };

/** What the host found where an internal link points. */
export type ResolvedLink =
  | { kind: 'external'; url: string }
  | { kind: 'file'; path: string; note: boolean }
  | { kind: 'missing'; path: string }
  | { kind: 'anchor' }
  | { kind: 'rejected'; reason: string };

export const linkHref = z.string().min(1).max(4096);

function reject(reason: string): LinkTarget {
  return { kind: 'rejected', reason };
}

/**
 * Resolve `href` as written in the note at `from`. Pure string work on the
 * knowledge base's own `/` separated paths: the host applies the space, layer
 * and symlink guards, and only it knows whether the file exists.
 */
export function resolveNoteLink(from: string, href: string): LinkTarget {
  const raw = href.trim();
  if (!raw) return reject(t('リンク先が空です。', 'The link has no destination.'));
  if (raw.startsWith('#')) return { kind: 'anchor' };
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    const address = webAddress(raw);
    return address
      ? { kind: 'external', url: address.href }
      : reject(
          t('http と https 以外のリンクは開けません。', 'Only http and https links can be opened.'),
        );
  }
  // `//host/x` is an address without a scheme, not a path inside the KB.
  if (raw.startsWith('//'))
    return reject(
      t('http と https 以外のリンクは開けません。', 'Only http and https links can be opened.'),
    );
  if (raw.startsWith('/'))
    return reject(
      t(
        'KB の外を指す絶対パスのリンクは開けません。',
        'Links with an absolute path outside the KB cannot be opened.',
      ),
    );
  if (raw.includes('\\'))
    return reject(
      t(
        'リンク先のパスに使えない文字があります。',
        'The link path contains a character that is not allowed.',
      ),
    );
  const [withoutFragment] = raw.split('#');
  if (!withoutFragment) return { kind: 'anchor' };
  let target: string;
  try {
    target = decodeURIComponent(withoutFragment);
  } catch {
    return reject(t('リンク先のパスを読み取れません。', 'The link path cannot be read.'));
  }
  if (target.includes('\0'))
    return reject(
      t(
        'リンク先のパスに使えない文字があります。',
        'The link path contains a character that is not allowed.',
      ),
    );
  const segments = from.split('/').slice(0, -1);
  for (const segment of target.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (!segments.length)
        return reject(
          t('KB の外を指すリンクは開けません。', 'Links pointing outside the KB cannot be opened.'),
        );
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  if (!segments.length)
    return reject(t('リンク先が KB のルートです。', 'The link points to the root of the KB.'));
  // A trailing separator is a folder, which the editor has nothing to open.
  if (/[/]\s*$/.test(target))
    return reject(t('フォルダーへのリンクは開けません。', 'Links to folders cannot be opened.'));
  return { kind: 'internal', path: segments.join('/') };
}

// The destination after `](` of an inline link or image — `<…>`, or a run without
// spaces holding escapes and balanced parentheses, as the editor writes
// `file\(1\).md` — or of a reference definition `[id]: …` opening a line.
const destination =
  /\]\(\s*(?:<((?:[^<>\n\\]|\\.)*)>|((?:[^\s()\\]|\\.|\([^\s()]*\))+))|^ {0,3}\[[^\]]+\]:\s*(?:<([^<>\n]*)>|(\S+))/g;

/**
 * The line with its code spans blanked in place: a backtick run opens one and the
 * next run of the same length closes it. Pairing from a precomputed next run keeps
 * this linear, which a backtracking pattern is not on a crafted line.
 */
function withoutCode(line: string) {
  const parts = line.split(/(`+)/);
  const next: number[] = [];
  const seen = new Map<number, number>();
  for (let i = parts.length - 2; i > 0; i -= 2) {
    next[i] = seen.get(parts[i].length) ?? 0;
    seen.set(parts[i].length, i);
  }
  for (let i = 1; i < parts.length; i += 2)
    if (next[i]) {
      for (let j = i; j <= next[i]; j++) parts[j] = ' '.repeat(parts[j].length);
      i = next[i];
    }
  return parts.join('');
}

/**
 * Whether two KB paths name the same file. They compare in NFC, since a Mac may
 * store a Japanese name decomposed while a link is written composed, and in one
 * case where the disk reaches a file through either — the host observes that.
 */
export function samePath(a: string, b: string, foldCase = false) {
  const [x, y] = [a, b].map((p) =>
    foldCase ? p.normalize('NFC').toLowerCase() : p.normalize('NFC'),
  );
  return x === y;
}

/**
 * The match moved onto the link's label, so a hit can carry the text a reader
 * sees and where it starts. Brackets pair in one pass — a backtracking pattern
 * would not be linear on a crafted line. An image, a reference definition and a
 * `]` with no `[` have no visible label, and the plain destination match stands.
 */
function labelled(line: string, plain: string, found: RegExpExecArray) {
  if (found[1] === undefined && found[2] === undefined) return found;
  const opens: number[] = [];
  let escaped = -1;
  for (let i = 0; i < found.index; i++)
    if (plain[i] === '\\') escaped = ++i;
    else if (plain[i] === '[') opens.push(i);
    else if (plain[i] === ']') opens.pop();
  const open = opens.pop();
  if (open === undefined || (plain[open - 1] === '!' && escaped !== open - 1)) return found;
  return Object.assign([line.slice(open + 1, found.index + found[0].length)] as [string], {
    index: open + 1,
    input: line,
    groups: { label: line.slice(open + 1, found.index) },
  });
}

/**
 * Reads one note line by line and answers where a line links to `target`, as a
 * Markdown reader would see it: code spans and fenced code are text, not links.
 */
export function linksTo(from: string, target: string, foldCase = false) {
  let fence = '';
  return (line: string) => {
    const [, marker = '', info = ''] = /^\s*(`{3,}|~{3,})(.*)/.exec(line) ?? [];
    if (fence) {
      if (marker.startsWith(fence) && !info.trim()) fence = '';
      return null;
    }
    // A backtick run whose info string holds a backtick is inline code, not a fence.
    if (marker && !(marker[0] === '`' && info.includes('`'))) {
      fence = marker;
      return null;
    }
    const plain = withoutCode(line);
    for (const found of plain.matchAll(destination)) {
      const href = (found[1] ?? found[2] ?? found[3] ?? found[4]).replace(
        /\\([!-/:-@[-`{-~])/g,
        '$1',
      );
      const link = resolveNoteLink(from, href);
      if (link.kind === 'internal' && samePath(link.path, target, foldCase))
        return labelled(line, plain, found);
    }
    return null;
  };
}

/** What a move did to links: in the moved note and in the other notes that led to it. */
export interface LinkUpdate {
  /** Links rewritten in the moved note. */
  self: number;
  /** Other notes rewritten, and the links rewritten in them. */
  notes: number;
  links: number;
  /** Notes left alone: changed meanwhile, holding unsaved text, or unreadable. */
  skipped: string[];
  /** The scan for linking notes hit a limit, so some may not have been found. */
  incomplete: boolean;
}

const unescaped = (written: string) => written.replace(/\\([!-/:-@[-`{-~])/g, '$1');

// The same destinations, with offsets, so one can be replaced in place.
const destinations = new RegExp(destination.source, 'gd');

/**
 * Each destination in `text` as `linksTo` reads it — outside fenced code and
 * code spans — with its offsets, so that nothing else is touched.
 */
function* noteDestinations(text: string) {
  let fence = '';
  let offset = 0;
  for (const [index, part] of text.split(/(\r\n|\n|\r)/).entries()) {
    const start = offset;
    offset += part.length;
    if (index % 2) continue;
    const [, marker = '', info = ''] = /^\s*(`{3,}|~{3,})(.*)/.exec(part) ?? [];
    if (fence) {
      if (marker.startsWith(fence) && !info.trim()) fence = '';
      continue;
    }
    if (marker && !(marker[0] === '`' && info.includes('`'))) {
      fence = marker;
      continue;
    }
    for (const found of withoutCode(part).matchAll(destinations)) {
      const group = [1, 2, 3, 4].find((group) => found[group] !== undefined)!;
      const [from, to] = found.indices![group]!;
      yield {
        start: start + from,
        end: start + to,
        written: found[group],
        angled: group % 2 === 1,
      };
    }
  }
}

/** How many links in `text`, read at `from`, resolve to `target`. */
export function linkCount(text: string, from: string, target: string) {
  const wanted = target.normalize('NFC');
  let count = 0;
  for (const { written } of noteDestinations(text)) {
    const link = resolveNoteLink(from, unescaped(written));
    if (link.kind === 'internal' && link.path.normalize('NFC') === wanted) count++;
  }
  return count;
}

/** `to` relative to the folder of `at`, on the knowledge base's own `/` paths. */
function relativeTo(at: string, to: string) {
  const base = at.split('/').slice(0, -1);
  const target = to.split('/');
  let shared = 0;
  while (shared < base.length && base[shared] === target[shared]) shared++;
  return [...base.slice(shared).map(() => '..'), ...target.slice(shared)].join('/');
}

/**
 * A destination in the author's form: percent-encoded when they encoded, inside
 * their `<…>` when they wrote one (the brackets stay in place) or in new ones
 * when the path needs them, else bare with the editor's own `\(` `\)` escapes.
 * `#` and `%` in the path are encoded because the reader splits at the one and
 * decodes the other.
 */
function destinationText(path: string, fragment: string, written: string, angled: boolean) {
  if (!angled && /%[0-9a-f]{2}/i.test(written))
    return path.split('/').map(encodeURIComponent).join('/') + fragment;
  let literal = path.replace(/[%#<>]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  // A first segment with a colon would read as a scheme.
  if (/^[a-z][a-z0-9+.-]*:/i.test(literal)) literal = `./${literal}`;
  literal += fragment;
  if (angled) return literal;
  if (/\s/.test(literal)) return `<${literal}>`;
  return literal.replace(/[()]/g, '\\$&');
}

/**
 * `text` as read at `from`, with each link to a path that `moved` relocates
 * rewritten so that it resolves to the new path once the text is at `at`. Only
 * the destination changes — the fragment, the title and the author's form stay —
 * and a destination that already resolves right is left as it is.
 */
export function rewriteLinks(
  text: string,
  from: string,
  at: string,
  moved: (path: string) => string | undefined,
) {
  let out = '';
  let cursor = 0;
  let links = 0;
  for (const { start, end, written, angled } of noteDestinations(text)) {
    const href = unescaped(written).trim();
    const link = resolveNoteLink(from, href);
    if (link.kind !== 'internal') continue;
    const next = moved(link.path.normalize('NFC'));
    if (next === undefined) continue;
    const now = resolveNoteLink(at, href);
    if (now.kind === 'internal' && now.path.normalize('NFC') === next.normalize('NFC')) continue;
    const fragment = href.includes('#') ? href.slice(href.indexOf('#')) : '';
    out +=
      text.slice(cursor, start) + destinationText(relativeTo(at, next), fragment, written, angled);
    cursor = end;
    links++;
  }
  return { text: out + text.slice(cursor), links };
}
