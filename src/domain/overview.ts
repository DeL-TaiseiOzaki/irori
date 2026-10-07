import type { RunRecord } from './knowledge';

/** Where the Overview map draws a brain, on a board 1000 × 640 units. */
export interface MapNode {
  scopeId: string;
  x: number;
  y: number;
}
export const board = { width: 1000, height: 640 };
/** How many hibachis share a row of the map. */
const rowSize = 4;

/**
 * A plain, deterministic map: the hibachis in the workspace's order, a few to
 * a row, spread evenly. Categories are not drawn (ADR 029); the rail's groups
 * are how a person arranges hibachis. The owner will design how the map is
 * built later, so this is the only place that decides positions.
 */
export function mapLayout(
  spaces: { scopeId: string }[],
  { hearth = false }: { hearth?: boolean } = {},
) {
  const rows = Array.from({ length: Math.ceil(spaces.length / rowSize) }, (_, index) =>
    spaces.slice(index * rowSize, (index + 1) * rowSize),
  );
  const nodes: MapNode[] = [];
  // Rows keep close enough to read as one map, centred on the board.
  const step = rows.length > 1 ? Math.min((board.height - 180) / (rows.length - 1), 210) : 0;
  const top = (board.height - step * (rows.length - 1)) / 2;
  rows.forEach((row, index) => {
    const y = top + step * index;
    // Your AI keeps the hearth on the left; the brains take the rest.
    const area = hearth ? { left: 300, width: board.width - 330 } : { left: 0, width: board.width };
    const span = Math.min(area.width - 200, 240 * row.length);
    const left = area.left + (area.width - span) / 2;
    row.forEach((space, column) =>
      nodes.push({ scopeId: space.scopeId, x: left + (span / row.length) * (column + 0.5), y }),
    );
  });
  return { nodes, hearth: hearth ? { x: 140, y: board.height / 2 } : undefined };
}

/** One brain's hibachi agent read notes of another brain: drawn from the source to the reader. */
export interface ReferenceLink {
  from: string;
  to: string;
  /** The latest note read, and how many distinct notes were read. */
  path: string;
  notes: number;
  at: string;
}

/**
 * Lines between brains from the run records: a run in one brain whose sources
 * carry another workspace brain's scopeId. The latest read names the line.
 */
export function referenceLinks(histories: Record<string, RunRecord[]>, scopeIds: string[]) {
  const links = new Map<string, ReferenceLink & { paths: Set<string> }>();
  for (const to of scopeIds)
    for (const run of histories[to] ?? [])
      for (const source of run.sources) {
        if (source.scopeId === to || !scopeIds.includes(source.scopeId)) continue;
        const key = `${source.scopeId}>${to}`;
        const link = links.get(key) ?? {
          from: source.scopeId,
          to,
          path: source.path,
          notes: 0,
          at: '',
          paths: new Set<string>(),
        };
        link.paths.add(source.path);
        if (run.createdAt >= link.at) {
          link.at = run.createdAt;
          link.path = source.path;
        }
        links.set(key, link);
      }
  return [...links.values()]
    .map(({ paths, ...link }) => ({ ...link, notes: paths.size }))
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

/** A note's name as the map labels it: the file name without `.md`. */
export function noteLabel(path: string) {
  return path.split('/').at(-1)!.replace(/\.md$/i, '');
}
