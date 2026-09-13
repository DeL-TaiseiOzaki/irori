import Papa from 'papaparse';
import { z } from 'zod';

const column = z.string().min(1).max(120);
export const kbPath = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (value) =>
      !/^[\\/]|[:\\\0]/.test(value) &&
      value.split('/').every((part) => part && part !== '.' && part !== '..'),
    'Use a path relative to the owning KB',
  );
const csvPath = kbPath.refine((value) => /\.csv$/i.test(value), 'A CSV file is required');
export const ontologyDeclaration = z.object({
  schemaVersion: z.literal(1),
  entities: z.object({
    path: csvPath,
    id: column.default('id'),
    label: column.default('label'),
    note: column.optional(),
    parent: column.optional(),
    group: column.optional(),
  }),
  relations: z
    .object({
      path: csvPath,
      source: column.default('sourceId'),
      target: column.default('targetId'),
      label: column.default('relation'),
    })
    .optional(),
});
export type CsvTable = { columns: string[]; rows: string[][] };
export type OntologyEntity = {
  id: string;
  label: string;
  note?: string;
  parent?: string;
  group?: string;
};
export type OntologyEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
  hierarchy: boolean;
};
export type OntologyView = {
  scopeId: string;
  entitiesPath: string;
  relationsPath?: string;
  revisions: { path: string; hash: string }[];
  entities: OntologyEntity[];
  edges: OntologyEdge[];
};

// CSV is never serialized by the visualization. The original document remains authoritative.
export function parseCsv(text: string): CsvTable {
  const result = Papa.parse<string[]>(text, {
    delimiter: ',',
    skipEmptyLines: 'greedy',
    preview: 20002,
  });
  if (result.errors.length) throw Error(`CSV: ${result.errors[0].message}`);
  const [columns = [], ...rows] = result.data;
  if (
    !columns.length ||
    columns.some((name) => !name.trim()) ||
    new Set(columns).size !== columns.length
  )
    throw Error('CSV の列名は空欄・重複にできません。');
  if (rows.length > 20000 || columns.length > 100)
    throw Error('CSV 表示は 20,000 行・100 列までです。ソースで確認してください。');
  if (rows.some((row) => row.length !== columns.length))
    throw Error('CSV の列数が一致しません。ソースで確認してください。');
  return { columns, rows };
}

export function ontologyGraph(
  declaration: z.infer<typeof ontologyDeclaration>,
  entitiesText: string,
  relationsText?: string,
): Pick<OntologyView, 'entities' | 'edges'> {
  function records(text: string, columns: string[]) {
    const table = parseCsv(text);
    for (const column of columns)
      if (!table.columns.includes(column)) throw Error(`CSV に列「${column}」がありません。`);
    return table.rows.map((row) =>
      Object.fromEntries(table.columns.map((name, index) => [name, row[index]])),
    );
  }
  const mapping = declaration.entities;
  const entities = records(
    entitiesText,
    Object.entries(mapping)
      .filter(([key]) => key !== 'path')
      .map(([, value]) => value),
  ).map((row) => ({
    id: row[mapping.id],
    label: row[mapping.label],
    note: mapping.note ? row[mapping.note] || undefined : undefined,
    parent: mapping.parent ? row[mapping.parent] || undefined : undefined,
    group: mapping.group ? row[mapping.group] || undefined : undefined,
  }));
  if (entities.length > 2000) throw Error('オントロジー表示は 2,000 エンティティまでです。');
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  if (
    byId.size !== entities.length ||
    entities.some((entity) => !entity.id.trim() || !entity.label.trim())
  )
    throw Error('エンティティの ID・ラベルは必須です。ID は重複できません。');
  const edges: OntologyEdge[] = [];
  for (const entity of entities) {
    if (entity.note)
      kbPath
        .refine((value) => /\.md$/i.test(value), 'Note links must point to Markdown')
        .parse(entity.note);
    const seen = new Set([entity.id]);
    let parent = entity.parent;
    while (parent) {
      if (!byId.has(parent)) throw Error(`親エンティティ「${parent}」が見つかりません。`);
      if (seen.has(parent)) throw Error('親子階層に循環があります。CSV を確認してください。');
      seen.add(parent);
      parent = byId.get(parent)!.parent;
    }
    if (entity.parent)
      edges.push({
        id: `parent:${entity.id}`,
        source: entity.parent,
        target: entity.id,
        label: '親子',
        hierarchy: true,
      });
  }
  if (declaration.relations) {
    const mapping = declaration.relations;
    if (relationsText === undefined) throw Error('関係 CSV がありません。');
    for (const [index, row] of records(relationsText, [
      mapping.source,
      mapping.target,
      mapping.label,
    ]).entries()) {
      if (!byId.has(row[mapping.source]) || !byId.has(row[mapping.target]))
        throw Error(`関係 CSV の ${index + 2} 行目に不明なエンティティ ID があります。`);
      edges.push({
        id: `relation:${index}`,
        source: row[mapping.source],
        target: row[mapping.target],
        label: row[mapping.label],
        hierarchy: false,
      });
    }
  }
  if (edges.length > 10000) throw Error('オントロジー表示は 10,000 関係までです。');
  return { entities, edges };
}

export function selectSubgraph(
  view: Pick<OntologyView, 'entities' | 'edges'>,
  group: string,
  root: string,
  hierarchyOnly: boolean,
) {
  const children = new Set(root ? [root] : view.entities.map((entity) => entity.id));
  if (root) {
    for (let previous = -1; previous !== children.size;) {
      previous = children.size;
      for (const entity of view.entities)
        if (entity.parent && children.has(entity.parent)) children.add(entity.id);
    }
  }
  const entities = view.entities.filter(
    (entity) => children.has(entity.id) && (!group || entity.group === group),
  );
  const ids = new Set(entities.map((entity) => entity.id));
  return {
    entities,
    edges: view.edges.filter(
      (edge) => ids.has(edge.source) && ids.has(edge.target) && (!hierarchyOnly || edge.hierarchy),
    ),
  };
}
