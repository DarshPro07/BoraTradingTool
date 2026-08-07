import { NODE_HEIGHT, NODE_WIDTH, layoutMemoryGraph } from "@/lib/knowledge/graph-layout";
import type { GraphEdge, GraphNode } from "@/lib/knowledge/types";

/**
 * The memory graph, drawn.
 *
 * The previous view printed edges as text (`a1b2c3… supports → d4e5f6…`), which is a graph only
 * in the sense that a list of coordinates is a map. Reading it required holding the shape in
 * your head, and the two things worth seeing — a source that produced nothing, and a lesson
 * resting on a single trial — are exactly the shapes a list hides.
 *
 * Server-rendered SVG. No charting dependency, no client JavaScript; the only motion is a CSS
 * dash animation on the edges, which needs neither.
 */

/** Same palette the rest of the terminal uses, so a colour means the same thing everywhere. */
const TONE: Record<GraphNode["type"], string> = {
  source: "var(--terminal)",
  claim: "var(--amber)",
  concept: "var(--amber)",
  equation: "var(--amber)",
  reproduction: "var(--amber)",
  hypothesis: "var(--amber)",
  strategy: "var(--green)",
  trial: "var(--red)",
  validation: "var(--red)",
  forward_outcome: "var(--green)",
  lesson: "var(--muted-foreground)",
};

export function MemoryMap({
  nodes,
  edges,
  perLane = 14,
}: {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  perLane?: number;
}) {
  const layout = layoutMemoryGraph(nodes, edges, perLane);

  if (layout.nodes.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-6 text-center">
        Nothing has been ingested yet. An empty graph is an empty graph — not a clean one.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <svg
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="img"
          aria-label={`Memory graph: ${layout.nodes.length} nodes across ${layout.lanes.length} stages`}
          className="memory-map"
        >
          <defs>
            <marker id="mm-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill="currentColor" opacity="0.55" />
            </marker>
          </defs>

          {layout.lanes.map((lane) => (
            <text
              key={lane.label}
              x={lane.x}
              y={14}
              className="fill-current text-muted-foreground"
              style={{ fontSize: 9, letterSpacing: "0.08em" }}
            >
              {/* Always a number, including zero — an empty stage is a finding, not a gap in
                  the rendering. No strategy tested yet is exactly what this should show. */}
              {lane.label} {lane.shown < lane.total ? `${lane.shown}/${lane.total}` : lane.total}
            </text>
          ))}

          <g className="text-muted-foreground">
            {layout.edges.map((edge) => (
              <path
                key={`${edge.from}-${edge.to}-${edge.relation}`}
                d={edge.path}
                fill="none"
                stroke="currentColor"
                strokeWidth={1}
                strokeOpacity={edge.backwards ? 0.75 : 0.35}
                strokeDasharray={edge.backwards ? "3 3" : undefined}
                markerEnd="url(#mm-arrow)"
                className={edge.backwards ? "memory-map-edge-back" : "memory-map-edge"}
              >
                <title>{`${edge.from} — ${edge.relation} → ${edge.to}`}</title>
              </path>
            ))}
          </g>

          {layout.nodes.map((graphNode) => (
            <g key={graphNode.id}>
              <rect
                x={graphNode.x}
                y={graphNode.y}
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                fill="var(--card)"
                stroke={TONE[graphNode.type]}
                strokeWidth={1}
                strokeDasharray={graphNode.orphan ? "2 2" : undefined}
                strokeOpacity={graphNode.orphan ? 0.9 : 0.6}
              />
              <text
                x={graphNode.x + 6}
                y={graphNode.y + 11}
                className="fill-current"
                style={{ fontSize: 8, letterSpacing: "0.06em", fill: TONE[graphNode.type] }}
              >
                {graphNode.type.replace(/_/g, " ").toUpperCase()}
                {graphNode.orphan ? " · ORPHAN" : ""}
              </text>
              <text
                x={graphNode.x + 6}
                y={graphNode.y + 21}
                className="fill-foreground"
                style={{ fontSize: 9 }}
              >
                {truncate(graphNode.label, 22)}
              </text>
              <title>
                {`${graphNode.label}${graphNode.status ? ` · ${graphNode.status}` : ""}${
                  graphNode.orphan ? " · connected to nothing" : ""
                }`}
              </title>
            </g>
          ))}
        </svg>
      </div>

      {layout.truncated ? (
        <p className="text-[10px] text-amber" data-testid="memory-map-truncated">
          Showing the {perLane} most recent per stage. Lane totals above are the real counts —
          this view is capped for legibility, not because the rest is gone.
        </p>
      ) : null}
    </div>
  );
}

/** SVG has no text-overflow, so labels are cut here rather than allowed to run over an edge. */
function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
