import { describe, expect, it } from "vitest";
import { LANES, NODE_WIDTH, layoutMemoryGraph } from "./graph-layout";
import type { GraphEdge, GraphNode } from "./types";

function node(id: string, type: GraphNode["type"], createdAt = "2026-08-01T00:00:00.000Z"): GraphNode {
  return { id, type, label: id, createdAt: new Date(createdAt) };
}

const chain: GraphNode[] = [
  node("src1", "source"),
  node("clm1", "claim"),
  node("hyp1", "hypothesis"),
  node("stg1", "strategy"),
  node("trl1", "trial"),
  node("les1", "lesson"),
];

const chainEdges: GraphEdge[] = [
  { from: "src1", to: "clm1", relation: "asserts" },
  { from: "clm1", to: "hyp1", relation: "motivates" },
  { from: "hyp1", to: "stg1", relation: "implemented_as" },
  { from: "stg1", to: "trl1", relation: "tested_by" },
  { from: "trl1", to: "les1", relation: "taught_as" },
];

describe("lanes follow the direction evidence flows", () => {
  it("places one full provenance chain in six successive lanes", () => {
    const layout = layoutMemoryGraph(chain, chainEdges);
    expect(layout.nodes.map((item) => item.lane)).toEqual([0, 1, 2, 3, 4, 5]);
    // Strictly increasing x is the whole point: reading left to right is reading the argument.
    const xs = layout.nodes.map((item) => item.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(new Set(xs).size).toBe(6);
  });

  it("never draws a forward edge as backwards", () => {
    const layout = layoutMemoryGraph(chain, chainEdges);
    expect(layout.edges).toHaveLength(5);
    expect(layout.edges.every((edge) => !edge.backwards)).toBe(true);
  });

  it("flags an edge that runs against the chain", () => {
    // A lesson feeding a claim is a real shape — it happens when a lesson is cited as evidence
    // — but it must be visibly distinguishable from the forward flow, not silently drawn.
    const layout = layoutMemoryGraph(chain, [
      ...chainEdges,
      { from: "les1", to: "clm1", relation: "cited_by" },
    ]);
    expect(layout.edges.filter((edge) => edge.backwards)).toHaveLength(1);
  });

  it("puts related types in the same lane", () => {
    const layout = layoutMemoryGraph([node("c", "claim"), node("e", "equation"), node("k", "concept")], []);
    expect(new Set(layout.nodes.map((item) => item.lane))).toEqual(new Set([1]));
  });
});

describe("orphans", () => {
  it("marks a node no edge touches", () => {
    const layout = layoutMemoryGraph([...chain, node("clm9", "claim")], chainEdges);
    const orphans = layout.nodes.filter((item) => item.orphan).map((item) => item.id);
    expect(orphans).toEqual(["clm9"]);
  });

  it("does not mark a node whose only edge points at it", () => {
    const layout = layoutMemoryGraph(chain, chainEdges);
    expect(layout.nodes.some((item) => item.orphan)).toBe(false);
  });
});

describe("capping is visible, never silent", () => {
  const many = Array.from({ length: 30 }, (_, index) =>
    node(`src${index}`, "source", `2026-08-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`),
  );

  it("caps a lane and reports both numbers", () => {
    const layout = layoutMemoryGraph(many, [], 5);
    expect(layout.lanes[0].shown).toBe(5);
    expect(layout.lanes[0].total).toBe(30);
    expect(layout.truncated).toBe(true);
  });

  it("keeps the newest rather than whatever came back first", () => {
    const layout = layoutMemoryGraph(many, [], 3);
    const shown = layout.nodes.map((item) => item.id);
    expect(shown).toContain("src27"); // 2026-08-28, the latest
    expect(shown).not.toContain("src0"); // 2026-08-01, the earliest
  });

  it("is not truncated when everything fits", () => {
    expect(layoutMemoryGraph(chain, chainEdges).truncated).toBe(false);
  });

  it("drops edges whose endpoints were capped away, rather than drawing to nowhere", () => {
    const layout = layoutMemoryGraph(many, [{ from: "src0", to: "src1", relation: "x" }], 3);
    expect(layout.edges).toHaveLength(0);
  });
});

describe("geometry", () => {
  it("is wide enough for every lane", () => {
    const layout = layoutMemoryGraph(chain, chainEdges);
    const rightmost = Math.max(...layout.nodes.map((item) => item.x + NODE_WIDTH));
    expect(layout.width).toBeGreaterThanOrEqual(rightmost);
    expect(layout.lanes).toHaveLength(LANES.length);
  });

  it("is tall enough for the busiest lane", () => {
    const layout = layoutMemoryGraph(
      Array.from({ length: 8 }, (_, index) => node(`s${index}`, "source")),
      [],
    );
    const lowest = Math.max(...layout.nodes.map((item) => item.y));
    expect(layout.height).toBeGreaterThan(lowest);
  });

  it("survives an empty graph without producing a zero-sized canvas", () => {
    const layout = layoutMemoryGraph([], []);
    expect(layout.nodes).toHaveLength(0);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });

  it("ignores an edge pointing at a node that does not exist", () => {
    const layout = layoutMemoryGraph(chain, [{ from: "src1", to: "ghost", relation: "asserts" }]);
    expect(layout.edges).toHaveLength(0);
  });
});

describe("crossing reduction", () => {
  it("orders a lane by what produced its nodes, not by insertion order", () => {
    // Each source has one claim, and the claims' own timestamps run *opposite* to their
    // parents'. Sorting the lane by recency alone would therefore cross the two edges; only
    // ordering by what produced them uncrosses it.
    const nodes = [
      node("srcA", "source", "2026-08-05T00:00:00.000Z"),
      node("srcB", "source", "2026-08-04T00:00:00.000Z"),
      node("clmA", "claim", "2026-08-01T00:00:00.000Z"),
      node("clmB", "claim", "2026-08-02T00:00:00.000Z"),
    ];
    const layout = layoutMemoryGraph(nodes, [
      { from: "srcA", to: "clmA", relation: "asserts" },
      { from: "srcB", to: "clmB", relation: "asserts" },
    ]);
    const y = (id: string) => layout.nodes.find((item) => item.id === id)!.y;
    // srcA sorts above srcB (newer first), so clmA must sit above clmB too.
    expect(y("srcA")).toBeLessThan(y("srcB"));
    expect(y("clmA")).toBeLessThan(y("clmB"));
  });
});
