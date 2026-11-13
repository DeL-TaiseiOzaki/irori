import { defaultKnowledgeFolder, isSchemaPath } from './layers';

/**
 * The pages of a knowledge base, and what irori reads from each one's
 * frontmatter: its `type`, `title` and `description`, the keys it carries and
 * its `relations`. The ontology check (ADR 060) and the folder indexes of an
 * Open Knowledge Format bundle (ADR 028) are both made from these facts. irori
 * keeps no graph of the pages: what a page is and how it relates is in the
 * page, and what kinds there are is in the declaration.
 */
export const bundleRoot = defaultKnowledgeFolder;

/**
 * A page of the bundle: a `.md` under the knowledge folder that is not a
 * folder's `index.md`. At the vault's root, the Schema files beside the bundle
 * are not pages; the walk leaves contents out.
 */
export function bundlePage(path: string, root: string = bundleRoot) {
  return (
    (root ? path.startsWith(`${root}/`) : !isSchemaPath(path)) &&
    /\.md$/i.test(path) &&
    !/(^|\/)index\.md$/i.test(path)
  );
}

/**
 * The YAML between a text's leading `---` line and the next, or undefined when
 * the text does not open with one. Scanned line by line, so a crafted page
 * costs its length and no more.
 */
export function frontmatterBlock(text: string): string | undefined {
  const source = text.startsWith('﻿') ? text.slice(1) : text;
  const opening = /^---[ \t]*\r?\n/.exec(source);
  if (!opening) return undefined;
  const start = opening[0].length;
  for (let at = start; at <= source.length;) {
    const newline = source.indexOf('\n', at);
    const end = newline === -1 ? source.length : newline;
    if (/^---[ \t]*\r?$/.test(source.slice(at, end))) return source.slice(start, at);
    if (newline === -1) return undefined;
    at = newline + 1;
  }
  return undefined;
}

/** What irori takes from one page: its KB path in NFC and its frontmatter's facts. */
export interface PageFacts {
  path: string;
  type?: string;
  title?: string;
  /** What the page's line in its folder index says (ADR 028). */
  description?: string;
  /** The top-level keys that hold a value. */
  keys: string[];
  relations: { rel: string; target: string }[];
  /** The page opens with frontmatter that could not be read. */
  unreadable?: boolean;
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
const filled = (value: unknown) =>
  typeof value === 'string'
    ? !!value.trim()
    : Array.isArray(value)
      ? value.length > 0
      : record(value)
        ? Object.keys(value).length > 0
        : value !== null && value !== undefined;

/**
 * The facts in a parsed frontmatter, read leniently: a value of the wrong shape
 * is as good as absent, and a relation without a string `rel` and `target`
 * keeps its place with the missing part empty, for the check to report.
 */
export function pageFacts(path: string, frontmatter: unknown): PageFacts {
  const fields = record(frontmatter) ? frontmatter : {};
  const relations = Array.isArray(fields.relations) ? fields.relations : [];
  return {
    path: path.normalize('NFC'),
    type: text(fields.type),
    title: text(fields.title),
    description: text(fields.description),
    keys: Object.keys(fields).filter((key) => filled(fields[key])),
    relations: relations.map((entry) => ({
      rel: (record(entry) && text(entry.rel)) || '',
      target: (record(entry) && text(entry.target)) || '',
    })),
  };
}

/** Code point order, the same on every runtime; UTF-16 order would put an astral character before U+E000. */
export function compareCodePoints(a: string, b: string) {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const p = a.codePointAt(i)!;
    const q = b.codePointAt(j)!;
    if (p !== q) return p < q ? -1 : 1;
    i += p > 0xffff ? 2 : 1;
    j += q > 0xffff ? 2 : 1;
  }
  return Number(i < a.length) - Number(j < b.length);
}

/**
 * The folder indexes of an OKF bundle (ADR 028): the `index.md` files the pages
 * give, and of those the ones an update would create or rewrite.
 */
export interface FolderIndexStatus {
  folders: number;
  added: number;
  changed: number;
}

/** What **索引を更新** and `irori index` did. */
export interface IndexUpdate {
  /** The knowledge folder is an OKF bundle; without one there is no index to write. */
  bundle: boolean;
  /** Pages of the bundle the walk met. */
  pages: number;
  /** The folder indexes whose bytes changed, and so were written. */
  written: string[];
}

/**
 * The graph index irori generated before 0.2.65 (`ontology/` in the knowledge
 * folder, ADR 008). Nothing reads or writes it now (ADR 060); irori only says
 * that it is still there.
 */
export const formerGraphIndex = (root: string) => `${root ? `${root}/` : ''}ontology/entities.csv`;
