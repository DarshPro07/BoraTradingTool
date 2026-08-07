import type { GraphEdge, GraphNode } from "./types";

/**
 * Layered layout for the memory graph.
 *
 * The provenance graph is a DAG whose direction *is* its meaning: a source asserts a claim, a
 * claim motivates a hypothesis, a hypothesis becomes a strategy, a strategy is tested, and a
 * test teaches a lesson. So the layout is not a force simulation — it is one lane per stage,
 * left to right, and an edge that runs backwards is visibly wrong rather than merely tangled.
 *
 * Pure geometry, no DOM, no dependency. It returns coordinates; the component draws them.
 */

export interface Lane {
  /** Stage title shown above the lane. */
  label: string;
  /** Node types that belong in this lane. */
  types: readonly GraphNode["type"][];
}

/** One lane per stage of the provenance chain, in the order evidence actually flows. */
export const LANES: readonly Lane[] = Object.freeze([
  { label: "SOURCES", types: ["source"] },
  { label: "CLAIMS", types: ["claim", "concept", "equation"] },
  { label: "HYPOTHESES", types: ["hypothesis", "reproduction"] },
  { label: "STRATEGIES", types: ["strategy"] },
  { label: "TESTS", types: ["trial", "validation"] },
  { label: "OUTCOMES", types: ["forward_outcome", "lesson"] },
]);

export const NODE_WIDTH = 148;
export const NODE_HEIGHT = 26;
const LANE_GAP = 64;
const ROW_GAP = 10;
const PADDING = 20;
const HEADER = 26;

export interface PositionedNode extends GraphNode {
  x: number;
  y: number;
  lane: number;
  /** No edge in either direction — ingested and then ignored. */
  orphan: boolean;
}

export interface PositionedEdge extends GraphEdge {
  /** Cubic bezier, flat-ish so the lane structure stays readable. */
  path: string;
  /** True when the edge runs right-to-left, i.e. against the direction of evidence. */
  backwards: boolean;
}

export interface LaneSummary {
  label: string;
  x: number;
  shown: number;
  total: number;
}

export interface GraphLayout {
  nodes: PositionedNode[];
  edges: PositionedEdge[];
  lanes: LaneSummary[];
  width: number;
  height: number;
  /** Set when any lane was capped. The screen must say so rather than look complete. */
  truncated: boolean;
}

/**
 * @param perLane Hard cap per lane. Without one a graph of a few hundred nodes renders as a
 *   grey wall — legible to nobody, and slower to draw than it is to read.
 */
export function layoutMemoryGraph(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  perLane = 14,
): GraphLayout {
  const laneOf = new Map<GraphNode["type"], number>();
  LANES.forEach((lane, index) => lane.types.forEach((type) => laneOf.set(type, index)));

  const buckets: GraphNode[][] = LANES.map(() => []);
  for (const node of nodes) {
    const lane = laneOf.get(node.type);
    if (lane !== undefined) buckets[lane].push(node);
  }

  // Newest first, then capped: a stale graph should surface what the system learned recently,
  // not whichever rows the database happened to return first.
  const totals = buckets.map((bucket) => bucket.length);
  const kept = buckets.map((bucket) =>
    [...bucket].sort((a, b) => time(b.createdAt) - time(a.createdAt)).slice(0, perLane),
  );

  const visible = new Set(kept.flat().map((node) => node.id));
  const shownEdges = edges.filter((edge) => visible.has(edge.from) && visible.has(edge.to));

  const parents = new Map<string, string[]>();
  for (const edge of shownEdges) {
    const list = parents.get(edge.to);
    if (list) list.push(edge.from);
    else parents.set(edge.to, [edge.from]);
  }

  // One barycentre pass, left to right: put each node opposite the average position of what
  // produced it. A full Sugiyama sweep is not worth it for lanes this small, but a single pass
  // removes most crossings, and crossings are what make a provenance graph unreadable.
  const rowOf = new Map<string, number>();
  const positioned: PositionedNode[] = [];
  const connected = new Set<string>();
  for (const edge of edges) {
    connected.add(edge.from);
    connected.add(edge.to);
  }

  kept.forEach((bucket, lane) => {
    const ordered =
      lane === 0
        ? bucket
        : [...bucket].sort((a, b) => barycentre(a, parents, rowOf) - barycentre(b, parents, rowOf));

    ordered.forEach((node, row) => {
      rowOf.set(node.id, row);
      positioned.push({
        ...node,
        lane,
        x: PADDING + lane * (NODE_WIDTH + LANE_GAP),
        y: PADDING + HEADER + row * (NODE_HEIGHT + ROW_GAP),
        orphan: !connected.has(node.id),
      });
    });
  });

  const byId = new Map(positioned.map((node) => [node.id, node]));
  const drawn: PositionedEdge[] = [];
  for (const edge of shownEdges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) continue;
    const x1 = from.x + NODE_WIDTH;
    const y1 = from.y + NODE_HEIGHT / 2;
    const x2 = to.x;
    const y2 = to.y + NODE_HEIGHT / 2;
    const bend = Math.max(24, Math.abs(x2 - x1) / 2);
    drawn.push({
      ...edge,
      path: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
      backwards: to.lane <= from.lane,
    });
  }

  const rows = Math.max(1, ...kept.map((bucket) => bucket.length));
  return {
    nodes: positioned,
    edges: drawn,
    lanes: LANES.map((lane, index) => ({
      label: lane.label,
      x: PADDING + index * (NODE_WIDTH + LANE_GAP),
      shown: kept[index].length,
      total: totals[index],
    })),
    width: PADDING * 2 + LANES.length * NODE_WIDTH + (LANES.length - 1) * LANE_GAP,
    height: PADDING * 2 + HEADER + rows * NODE_HEIGHT + (rows - 1) * ROW_GAP,
    truncated: kept.some((bucket, index) => bucket.length < totals[index]),
  };
}

/** A node with no placed parent keeps its own order rather than collapsing to the top. */
function barycentre(node: GraphNode, parents: Map<string, string[]>, rowOf: Map<string, number>): number {
  const rows = (parents.get(node.id) ?? []).map((id) => rowOf.get(id)).filter((row): row is number => row !== undefined);
  return rows.length === 0 ? Number.MAX_SAFE_INTEGER : rows.reduce((sum, row) => sum + row, 0) / rows.length;
}

function time(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}
