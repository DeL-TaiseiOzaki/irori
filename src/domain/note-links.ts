import { z } from 'zod';
import { webAddress } from './links';

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
  if (!raw) return reject('リンク先が空です。');
  if (raw.startsWith('#')) return { kind: 'anchor' };
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    const address = webAddress(raw);
    return address
      ? { kind: 'external', url: address.href }
      : reject('http と https 以外のリンクは開けません。');
  }
  // `//host/x` is an address without a scheme, not a path inside the KB.
  if (raw.startsWith('//')) return reject('http と https 以外のリンクは開けません。');
  if (raw.startsWith('/')) return reject('KB の外を指す絶対パスのリンクは開けません。');
  if (raw.includes('\\')) return reject('リンク先のパスに使えない文字があります。');
  const [withoutFragment] = raw.split('#');
  if (!withoutFragment) return { kind: 'anchor' };
  let target: string;
  try {
    target = decodeURIComponent(withoutFragment);
  } catch {
    return reject('リンク先のパスを読み取れません。');
  }
  if (target.includes('\0')) return reject('リンク先のパスに使えない文字があります。');
  const segments = from.split('/').slice(0, -1);
  for (const segment of target.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (!segments.length) return reject('KB の外を指すリンクは開けません。');
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  if (!segments.length) return reject('リンク先が KB のルートです。');
  // A trailing separator is a folder, which the editor has nothing to open.
  if (/[/]\s*$/.test(target)) return reject('フォルダーへのリンクは開けません。');
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
