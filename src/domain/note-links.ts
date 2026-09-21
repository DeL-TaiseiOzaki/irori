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
