import Papa from 'papaparse';
import { resolveNoteLink } from './note-links';
import { ontologyDeclaration, parseCsv } from './ontology';

/**
 * The graph index a knowledge base carries: `Knowledge_Base/ontology/`, a CSV
 * node table and a CSV edge table that irori generates from the pages of the
 * bundle — each page's `type`, `title` and `relations` in its frontmatter — and
 * the person commits, so every device shows the same graph for the same commit
 * (ADR 008). The same pages give the same bytes on any device: paths in NFC,
 * rows in code point order, `\n` line ends, no BOM. A declared
 * `.irori/ontology.json` still wins; irori neither reads nor generates the
 * module while one exists.
 */
export const bundleRoot = 'Knowledge_Base';
export const graphIndexFolder = `${bundleRoot}/ontology`;
export const graphIndexFiles = {
  entities: `${graphIndexFolder}/entities.csv`,
  relations: `${graphIndexFolder}/relations.csv`,
  index: `${graphIndexFolder}/index.md`,
} as const;
export const entityColumns = ['id', 'label', 'note', 'parentId', 'group'] as const;
export const relationColumns = ['sourceId', 'relation', 'targetId'] as const;
/** What the graph reader accepts (`ontologyGraph`); a larger index is refused, never truncated. */
export const graphIndexLimits = { entities: 2000, relations: 10000 } as const;

/** The declaration the module is read with, as if `.irori/ontology.json` named it. */
export function graphIndexDeclaration(relations: boolean) {
  return ontologyDeclaration.parse({
    schemaVersion: 1,
    entities: {
      path: graphIndexFiles.entities,
      id: 'id',
      label: 'label',
      note: 'note',
      parent: 'parentId',
      group: 'group',
    },
    ...(relations && {
      relations: {
        path: graphIndexFiles.relations,
        source: 'sourceId',
        target: 'targetId',
        label: 'relation',
      },
    }),
  });
}

/**
 * A page of the bundle: a `.md` under `Knowledge_Base/` that is neither a
 * folder's `index.md` nor inside the module itself.
 */
export function bundlePage(path: string) {
  return (
    path.startsWith(`${bundleRoot}/`) &&
    /\.md$/i.test(path) &&
    !/(^|\/)index\.md$/i.test(path) &&
    !path.startsWith(`${graphIndexFolder}/`)
  );
}

/** A page's id in the index: its path inside the bundle without `.md`. */
export function pageId(path: string) {
  return path.slice(bundleRoot.length + 1).replace(/\.md$/i, '');
}

/**
 * The YAML between a text's leading `---` line and the next, or undefined when
 * the text does not open with one. Scanned line by line, so a crafted page
 * costs its length and no more.
 */
export function frontmatterBlock(text: string): string | undefined {
  const source = text.startsWith('\uFEFF') ? text.slice(1) : text;
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

/** What the generator takes from one page: its KB path in NFC and its frontmatter's graph facts. */
export interface PageFacts {
  path: string;
  type?: string;
  title?: string;
  relations: { rel: string; target: string }[];
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === 'string' ? value : undefined);

/**
 * The facts in a parsed frontmatter, read leniently: a value of the wrong shape
 * is as good as absent, and a relation without a string `rel` and `target` is
 * one the builder leaves out and counts.
 */
export function pageFacts(path: string, frontmatter: unknown): PageFacts {
  const fields = record(frontmatter) ? frontmatter : {};
  const relations = Array.isArray(fields.relations) ? fields.relations : [];
  return {
    path: path.normalize('NFC'),
    type: text(fields.type),
    title: text(fields.title),
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

function compareRows(x: string[], y: string[]) {
  for (let column = 0; column < x.length; column++) {
    const order = compareCodePoints(x[column], y[column] ?? '');
    if (order) return order;
  }
  return 0;
}

export interface GraphIndexTables {
  entities: string[][];
  relations: string[][];
  /** Relations left out: no `rel`, a URL, a missing page, an `index.md`, a path outside the bundle. */
  excluded: number;
}

/**
 * The node and edge tables the pages give. A relation is kept when its target,
 * resolved from the page that carries it as a note link is, names another page
 * of the bundle; exact duplicates collapse. A page takes part when it is the
 * source or target of a kept relation. Rows are sorted by code point — entities
 * by id, relations by source, relation and target — so the order the pages
 * were met in leaves no trace.
 */
export function buildGraphIndex(pages: PageFacts[]): GraphIndexTables {
  const byPath = new Map<string, PageFacts>();
  for (const page of pages) {
    const path = page.path.normalize('NFC');
    if (bundlePage(path)) byPath.set(path, { ...page, path });
  }
  const kept = new Map<string, string[]>();
  let excluded = 0;
  for (const page of byPath.values())
    for (const { rel, target } of page.relations) {
      const link = rel ? resolveNoteLink(page.path, target) : undefined;
      const found = link?.kind === 'internal' ? byPath.get(link.path.normalize('NFC')) : undefined;
      if (!found) {
        excluded++;
        continue;
      }
      const row = [pageId(page.path), rel, pageId(found.path)];
      kept.set(row.join('\0'), row);
    }
  const relations = [...kept.values()].sort(compareRows);
  const taking = new Set(relations.flatMap(([source, , target]) => [source, target]));
  const entities = [...byPath.values()]
    .filter((page) => taking.has(pageId(page.path)))
    .map((page) => [
      pageId(page.path),
      page.title?.trim() ? page.title : pageId(page.path).split('/').at(-1)!,
      page.path,
      '',
      page.type ?? '',
    ])
    .sort(compareRows);
  return { entities, relations, excluded };
}

/** A table as the module writes it: the fixed header, `\n` line ends, quoting only where CSV needs it, one final newline. */
export function renderTable(columns: readonly string[], rows: string[][]) {
  const text = Papa.unparse({ fields: [...columns], data: rows }, { newline: '\n' });
  return text.endsWith('\n') ? text : `${text}\n`;
}

export const graphIndexReadme = `# ontology

The files in this folder are the graph index irori generates from the pages of
this bundle — each page's \`type\`, \`title\` and \`relations\` in its
frontmatter. Regenerate them in irori (オントロジー → グラフ索引を更新) rather
than editing them.

- \`entities.csv\`: one row per page that takes part in a relation — \`id\` (the page's path inside \`Knowledge_Base/\` without \`.md\`), \`label\` (its title), \`note\` (its path from the repository root), \`parentId\` (empty) and \`group\` (its type).
- \`relations.csv\`: one row per relation — \`sourceId\`, \`relation\` and \`targetId\`.
`;

/** The bytes of the three module files for these tables. */
export function renderGraphIndex(tables: GraphIndexTables) {
  return {
    entities: renderTable(entityColumns, tables.entities),
    relations: renderTable(relationColumns, tables.relations),
    index: graphIndexReadme,
  } satisfies Record<keyof typeof graphIndexFiles, string>;
}

export interface RowDelta {
  /** Rows the pages give now. */
  rows: number;
  /** Rows an update would add to, and remove from, the table on disk. */
  added: number;
  removed: number;
}

/**
 * How the generated rows differ from a table on disk, matched on the module's
 * columns wherever the file puts them. A file that is not such a table counts
 * as empty: every generated row would be added.
 */
export function tableDelta(
  columns: readonly string[],
  generated: string[][],
  text: string | undefined,
): RowDelta {
  const onDisk = new Map<string, number>();
  if (text !== undefined)
    try {
      const table = parseCsv(text);
      if (columns.every((column) => table.columns.includes(column))) {
        const at = columns.map((column) => table.columns.indexOf(column));
        for (const row of table.rows) {
          const key = at.map((index) => row[index]).join('\0');
          onDisk.set(key, (onDisk.get(key) ?? 0) + 1);
        }
      }
    } catch {
      /* not the module's table */
    }
  let added = 0;
  for (const row of generated) {
    const key = row.join('\0');
    const count = onDisk.get(key);
    if (!count) added++;
    else if (count === 1) onDisk.delete(key);
    else onDisk.set(key, count - 1);
  }
  let removed = 0;
  for (const count of onDisk.values()) removed += count;
  return { rows: generated.length, added, removed };
}

export interface GraphIndexStatus {
  /** `.irori/ontology.json` declares the graph: the module is neither read nor generated, and the rest is empty. */
  declared: boolean;
  /** `entities.csv` exists in the module. */
  present: boolean;
  /** Both tables hold the bytes the pages give now. */
  current: boolean;
  /** Pages of the bundle the walk met, and those whose frontmatter could not be read. */
  pages: number;
  unreadable: number;
  /** Relations left out, as `GraphIndexTables.excluded`. */
  excluded: number;
  entities: RowDelta;
  relations: RowDelta;
}

export interface GraphIndexUpdate extends GraphIndexStatus {
  /** The module files whose bytes changed, and so were written. */
  written: string[];
}

export const declaredGraphIndex: GraphIndexStatus = {
  declared: true,
  present: false,
  current: false,
  pages: 0,
  unreadable: 0,
  excluded: 0,
  entities: { rows: 0, added: 0, removed: 0 },
  relations: { rows: 0, added: 0, removed: 0 },
};
