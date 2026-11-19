import type { RunRecord } from './knowledge';

/** Where the Overview map draws a brain, on a board 1000 × 640 units. */
export interface MapNode {
  scopeId: string;
  x: number;
  y: number;
}
/**
 * The rectangle of the map that holds the vaults of one SSH host (ADR 061):
 * its top-left corner and its size, in board units. The host's name sits in
 * the strip at its top.
 */
export interface MapHostArea {
  host: { id: string; name: string };
  x: number;
  y: number;
  width: number;
  height: number;
}
export const board = { width: 1000, height: 640 };
/** How many vaults share a row of the map. */
const rowSize = 4;
/** The tallest a row gets: the farthest apart two rows stand. */
const rowLimit = 210;
/** Above a host's first row, the strip that names the host. */
const hostHeader = 34;
/** Between the vaults here and a host's area, and between two hosts' areas. */
const areaGap = 26;
/** How far a host's area keeps inside the part of the board the vaults use. */
const areaInset = 10;

function rowsOf<T>(items: T[]) {
  return Array.from({ length: Math.ceil(items.length / rowSize) }, (_, index) =>
    items.slice(index * rowSize, (index + 1) * rowSize),
  );
}

/**
 * A plain, deterministic map: the vaults in the workspace's order, a few to
 * a row, spread evenly. Categories are not drawn (ADR 029); the rail's groups
 * are how a person arranges vaults. The owner will design how the map is
 * built later, so this is the only place that decides positions.
 *
 * The vaults of this device come first. Each SSH host's vaults follow in an
 * area of their own, in the order the host's first vault has in the workspace,
 * so a vault on another machine never reads as one of this machine's.
 * `rowStep` is the height of a row in board units, for the view to keep a row
 * tall enough to read.
 */
export function mapLayout(
  spaces: { scopeId: string; host?: { id: string; name: string } }[],
  { hearth = false }: { hearth?: boolean } = {},
) {
  const groups: { host?: { id: string; name: string }; scopeIds: string[] }[] = [];
  const here = spaces.filter((space) => !space.host).map((space) => space.scopeId);
  if (here.length) groups.push({ scopeIds: here });
  for (const space of spaces) {
    if (!space.host) continue;
    const group = groups.find((item) => item.host?.id === space.host!.id);
    if (group) group.scopeIds.push(space.scopeId);
    else groups.push({ host: space.host, scopeIds: [space.scopeId] });
  }
  const rowCount = groups.reduce((sum, group) => sum + rowsOf(group.scopeIds).length, 0);
  // What the hosts' areas take besides their rows, before the map is fitted to the board.
  const fixed = groups.reduce(
    (sum, group, index) => sum + (group.host ? hostHeader : 0) + (index ? areaGap : 0),
    0,
  );
  // Rows, host names and gaps shrink together when they would not fit, and stay centred.
  const scale = Math.min(1, (board.height - 40) / (rowLimit * rowCount + fixed || 1));
  const rowStep = rowLimit * scale;
  const header = hostHeader * scale;
  const gap = areaGap * scale;
  // Your AI keeps the hearth on the left; the brains take the rest.
  const area = hearth ? { left: 300, width: board.width - 330 } : { left: 0, width: board.width };
  const nodes: MapNode[] = [];
  const hosts: MapHostArea[] = [];
  let y = (board.height - (rowLimit * rowCount + fixed) * scale) / 2;
  groups.forEach((group, index) => {
    if (index) y += gap;
    const top = y;
    if (group.host) y += header;
    for (const row of rowsOf(group.scopeIds)) {
      const span = Math.min(area.width - 200, 240 * row.length);
      const left = area.left + (area.width - span) / 2;
      row.forEach((scopeId, column) =>
        nodes.push({ scopeId, x: left + (span / row.length) * (column + 0.5), y: y + rowStep / 2 }),
      );
      y += rowStep;
    }
    if (group.host)
      hosts.push({
        host: group.host,
        x: area.left + areaInset,
        y: top,
        width: area.width - 2 * areaInset,
        height: y - top,
      });
  });
  return {
    nodes,
    hosts,
    rowStep,
    hearth: hearth ? { x: 140, y: board.height / 2 } : undefined,
  };
}

/** One brain's vault agent read notes of another brain: drawn from the source to the reader. */
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
