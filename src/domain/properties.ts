import { z } from 'zod';
import {
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  stringify,
  type Document as YamlDocument,
  type Node as YamlNode,
  type Scalar,
} from 'yaml';

/**
 * A knowledge base's own declaration of its page properties (ADR 015):
 * `.property/property.json`, a schema-layer file because its top-level entry
 * starts with a dot. irori reads it and defines no vocabulary of its own.
 */
export const propertyDeclarationFile = '.property/property.json';
export const propertyDeclarationLimit = 256 * 1024;

/** The kinds irori knows how to show; any other kind gets a generic row. */
export const propertyKinds = [
  'type',
  'text',
  'select',
  'multi-select',
  'datetime',
  'actor-time',
  'actor-time-list',
  'link',
  'sources',
  'relations',
] as const;
export type PropertyKind = (typeof propertyKinds)[number];

const name = z.string().min(1).max(200);
const property = z.looseObject({
  kind: z.string().min(1).max(64),
  options: z.array(z.string().max(200)).max(200).optional(),
  default: z.string().max(200).optional(),
  auto: z.literal('last-change').optional(),
  description: z.string().max(2000).optional(),
});
export const propertyDeclaration = z.looseObject({
  schemaVersion: z.literal(1),
  properties: z.record(name, property).default({}),
  required: z.array(name).max(200).default([]),
  types: z
    .record(
      name,
      z.looseObject({
        description: z.string().max(2000).optional(),
        heading: z.string().max(200).optional(),
        required: z.array(name).max(200).default([]),
      }),
    )
    .default({}),
  relations: z
    .record(
      name,
      z.looseObject({
        description: z.string().max(2000).optional(),
        from: z.union([z.literal('any'), z.array(name)]).optional(),
        to: z.string().max(64).optional(),
      }),
    )
    .default({}),
  avoid: z.array(z.looseObject({ name, use: z.string().max(200) })).default([]),
});
export type PropertyDeclaration = z.infer<typeof propertyDeclaration>;
export type PropertyDefinition = PropertyDeclaration['properties'][string];

/** What the property view needs from the host for one knowledge base. */
export interface PageProperties {
  /** The declaration, or null when the knowledge base has none or it is broken. */
  declaration: PropertyDeclaration | null;
  /** Why a declaration that exists could not be used. */
  problem?: string;
  /** `human:<id>` from the local part of `git config user.email`, when set. */
  actor?: string;
}

export function actorFromEmail(email: string): string | undefined {
  const local = email.trim().split('@')[0]?.trim();
  return local && /^[^\s:]+$/.test(local) ? `human:${local}` : undefined;
}

/**
 * A page split at its frontmatter. `head` is everything from the start of the
 * file through the closing `---` line, BOM and line endings included, so
 * `head + body` is always the original text.
 */
export interface SplitPage {
  head: string;
  body: string;
  /** The YAML between the delimiters, with the file's own line endings. */
  yaml?: string;
  newline: '\n' | '\r\n';
  bom: string;
}

const frontmatterPattern = /^(﻿?)---(\r?\n)(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

export function splitPage(text: string): SplitPage {
  const match = frontmatterPattern.exec(text);
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  if (!match) return { head: '', body: text, newline, bom: text.startsWith('﻿') ? '﻿' : '' };
  return {
    head: match[0],
    body: text.slice(match[0].length),
    yaml: match[3] ?? '',
    newline: match[2] as '\n' | '\r\n',
    bom: match[1],
  };
}

/**
 * The head for `yaml`, in the page's own line endings and BOM. The YAML is kept
 * as given, so a trailing blank line typed into the raw view survives the round
 * trip through `splitPage`.
 */
export function frontmatterHead(yaml: string, newline: '\n' | '\r\n' = '\n', bom = ''): string {
  const lines = yaml.replace(/\r\n/g, '\n');
  const inner = lines ? `${lines}\n` : '';
  return `${bom}---\n${inner}---\n`.replace(/\n/g, newline);
}

/** YAML from a structured edit, without the trailing newlines an append leaves. */
export function tidyYaml(yaml: string): string {
  return yaml.replace(/\n+$/, '');
}

export type YamlValue =
  string | number | boolean | null | YamlValue[] | { [key: string]: YamlValue };

export interface ParsedProperties {
  values: Record<string, YamlValue>;
  /** Keys in file order. */
  keys: string[];
  error?: string;
}

function read(yaml: string): YamlDocument.Parsed {
  return parseDocument(yaml.replace(/\r\n/g, '\n'), { uniqueKeys: true, prettyErrors: false });
}

export function parseProperties(yaml: string | undefined): ParsedProperties {
  if (yaml === undefined || !yaml.trim()) return { values: {}, keys: [] };
  const doc = read(yaml);
  const failure = doc.errors[0];
  if (failure) return { values: {}, keys: [], error: failure.message };
  if (doc.contents !== null && !isMap(doc.contents))
    return { values: {}, keys: [], error: 'The frontmatter is not a set of keys.' };
  const keys = isMap(doc.contents)
    ? doc.contents.items.map((pair) => String(isScalar(pair.key) ? pair.key.value : pair.key))
    : [];
  try {
    const values = (doc.toJS({ maxAliasCount: 0 }) ?? {}) as Record<string, YamlValue>;
    return { values, keys };
  } catch (error) {
    return { values: {}, keys: [], error: error instanceof Error ? error.message : String(error) };
  }
}

const plainTypes = new Set(['PLAIN', 'QUOTE_DOUBLE', 'QUOTE_SINGLE']);

/** One scalar on one line, in the given quoting style where YAML allows it. */
function scalarText(value: YamlValue, style?: Scalar.Type | string, inFlow = false): string {
  const single = typeof value === 'string' ? value.replace(/\s*\r?\n\s*/g, ' ') : value;
  const text = stringify(single, {
    lineWidth: 0,
    defaultStringType: (style && plainTypes.has(style) ? style : 'PLAIN') as Scalar.Type,
    defaultKeyType: 'PLAIN',
  }).trimEnd();
  // A plain scalar inside a flow collection must not carry flow indicators.
  if (inFlow && typeof single === 'string' && /[,[\]{}]/.test(text) && !/^["']/.test(text))
    return JSON.stringify(single);
  return text;
}

/** A value on one line: scalars as themselves, collections in flow style. */
function flowText(value: YamlValue): string {
  if (Array.isArray(value)) return `[${value.map((item) => flowText(item)).join(', ')}]`;
  if (value && typeof value === 'object')
    return `{ ${Object.entries(value)
      .map(([key, item]) => `${scalarText(key, 'PLAIN', true)}: ${flowText(item)}`)
      .join(', ')} }`;
  return scalarText(value, 'PLAIN', true);
}

function column(source: string, offset: number) {
  return offset - (source.lastIndexOf('\n', offset - 1) + 1);
}

function inFlowCollection(doc: YamlDocument.Parsed, path: string[]) {
  let node: unknown = doc.contents;
  for (const key of path.slice(0, -1)) {
    if (!isMap(node)) return false;
    node = node.get(key, true);
    if ((isMap(node) || isSeq(node)) && node.flow) return true;
  }
  return false;
}

/**
 * Sets one value in `yaml`, rewriting only the text of that value so comments,
 * key order, quoting and the style of every other entry stay as written.
 * `undefined` removes a top-level key. Falls back to re-serializing the
 * document only when the change cannot be made in place.
 */
export function setProperty(yaml: string, path: string[], value: YamlValue | undefined): string {
  const source = yaml.replace(/\r\n/g, '\n');
  const doc = read(source);
  if (doc.errors[0]) throw Error(doc.errors[0].message);
  const node = doc.getIn(path, true) as YamlNode | undefined;
  const splice = (from: number, to: number, text: string) =>
    source.slice(0, from) + text + source.slice(to);
  let next: string | undefined;
  if (value === undefined) {
    if (path.length === 1 && isMap(doc.contents)) {
      const pair = doc.contents.items.find(
        (item) => isScalar(item.key) && String(item.key.value) === path[0],
      );
      const start = (pair?.key as YamlNode | undefined)?.range?.[0];
      const end =
        (pair?.value as YamlNode | undefined)?.range?.[2] ??
        (pair?.key as YamlNode | undefined)?.range?.[2];
      if (pair && start !== undefined && end !== undefined) {
        const lineStart = source.lastIndexOf('\n', start - 1) + 1;
        const lineEnd = source.indexOf('\n', Math.max(end - 1, start));
        next = splice(lineStart, lineEnd === -1 ? source.length : lineEnd + 1, '');
      }
    }
  } else if (node?.range && isScalar(node) && (value === null || typeof value !== 'object')) {
    next = splice(
      node.range[0],
      node.range[1],
      scalarText(value, node.type, inFlowCollection(doc, path)),
    );
  } else if (node?.range && isSeq(node) && Array.isArray(value)) {
    if (node.flow) next = splice(node.range[0], node.range[1], flowText(value));
    else if (value.length) {
      const indent = ' '.repeat(column(source, node.range[0]));
      next = splice(
        node.range[0],
        node.range[1],
        value.map((item, index) => `${index ? indent : ''}- ${flowText(item)}`).join('\n') + '\n',
      );
    }
  } else if (!node && path.length === 1 && (doc.contents === null || isMap(doc.contents))) {
    const body = source.replace(/\n*$/, '');
    next = `${body}${body ? '\n' : ''}${scalarText(path[0], 'PLAIN')}: ${flowText(value)}\n`;
  }
  if (next !== undefined) {
    const check = read(next);
    if (!check.errors[0] && sameAfter(check, path, value)) return next;
  }
  // Re-serializing keeps comments and styles but may re-space lines elsewhere.
  if (value === undefined) doc.deleteIn(path);
  else doc.setIn(path, doc.createNode(value, { flow: Array.isArray(value) || isObject(value) }));
  return doc.toString({ lineWidth: 0, flowCollectionPadding: false });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sameAfter(doc: YamlDocument.Parsed, path: string[], value: YamlValue | undefined) {
  const after = doc.getIn(path);
  const plain = (item: unknown) =>
    JSON.stringify(
      item && typeof item === 'object' && 'toJSON' in item
        ? (item as { toJSON(): unknown }).toJSON()
        : item,
    );
  return value === undefined ? !doc.hasIn(path) : plain(after) === JSON.stringify(value);
}

/** The value of a page with one property set, or its frontmatter created. */
export function withProperty(text: string, path: string[], value: YamlValue | undefined): string {
  const page = splitPage(text);
  const yaml = tidyYaml(setProperty(page.yaml ?? '', path, value));
  return frontmatterHead(yaml, page.newline, page.bom) + page.body;
}

/** An ISO 8601 moment in local time with its offset, to the second. */
export function localTimestamp(at: Date): string {
  const two = (value: number) => String(value).padStart(2, '0');
  const offset = -at.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const zone = `${sign}${two(Math.floor(Math.abs(offset) / 60))}:${two(Math.abs(offset) % 60)}`;
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}T${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}${zone}`;
}

/**
 * Names the person as the last to change a page: every property the
 * declaration marks `auto: last-change` becomes `{ by, at }`. A page without
 * frontmatter, or whose frontmatter does not parse, is returned unchanged.
 */
export function stampLastChange(
  text: string,
  declaration: PropertyDeclaration | null | undefined,
  actor: string | undefined,
  at: Date,
): string {
  if (!declaration || !actor) return text;
  const keys = Object.entries(declaration.properties)
    .filter(([, definition]) => definition.auto === 'last-change')
    .map(([key]) => key);
  const page = splitPage(text);
  if (!keys.length || page.yaml === undefined || parseProperties(page.yaml).error) return text;
  const when = localTimestamp(at);
  let yaml = page.yaml;
  for (const key of keys) {
    const current = parseProperties(yaml).values[key];
    if (isObject(current)) {
      yaml = setProperty(yaml, [key, 'by'], actor);
      yaml = setProperty(yaml, [key, 'at'], when);
    } else yaml = setProperty(yaml, [key], { by: actor, at: when });
  }
  return frontmatterHead(tidyYaml(yaml), page.newline, page.bom) + page.body;
}

/** The keys a page of `type` must carry under the declaration. */
export function requiredKeys(declaration: PropertyDeclaration | null | undefined, type: unknown) {
  if (!declaration) return [];
  const own = typeof type === 'string' ? (declaration.types[type]?.required ?? []) : [];
  return [...new Set([...declaration.required, ...own])];
}

export function isEmptyValue(value: YamlValue | undefined): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && !value.trim()) ||
    (Array.isArray(value) && !value.length) ||
    (isObject(value) && !Object.keys(value).length)
  );
}
