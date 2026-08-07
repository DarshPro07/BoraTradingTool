import { buildMemoryGraph, type MemoryGraph } from "@/lib/knowledge/memory-graph";

/**
 * Idle detection and memory self-inspection.
 *
 * The learning cycle in `./cycle.ts` already knows *what work to do* at each mode. Two things
 * it does not know: whether the owner is away, and whether its own memory is in good order.
 * This module supplies both, and stays separate so the cycle's mode ladder is untouched.
 *
 * What idle mode deliberately does not do: read papers or browse the web unattended. There is
 * no model inside the application by design — the app does not call Claude, Claude calls the
 * app. So inspection produces a queue of work for the agent's next connection, and findings
 * come back through the MCP write tools carrying provenance. Anything else would be inventing
 * a capability the process does not have.
 */

export type IdleState = "active" | "idle" | "deep_idle";

export const IDLE_THRESHOLDS = Object.freeze({
  /** Minutes of owner silence before light maintenance is worth running. */
  idleAfterMinutes: 15,
  /** Minutes before the expensive passes are allowed. */
  deepIdleAfterMinutes: 60,
  /** A failure mode seen this many times is a pattern, not bad luck. */
  repeatedFailureThreshold: 3,
});

export function assessIdle(
  lastOwnerActivityAt: Date,
  now: Date = new Date(),
): { state: IdleState; minutesIdle: number } {
  const minutesIdle = Math.max(0, (now.getTime() - lastOwnerActivityAt.getTime()) / 60_000);
  const state: IdleState =
    minutesIdle >= IDLE_THRESHOLDS.deepIdleAfterMinutes
      ? "deep_idle"
      : minutesIdle >= IDLE_THRESHOLDS.idleAfterMinutes
        ? "idle"
        : "active";
  return { state, minutesIdle };
}

export type FindingKind =
  | "orphan_knowledge"
  | "repeated_failure"
  | "stalled_strategy"
  | "unsupported_lesson"
  | "empty_memory";

export interface MemoryFinding {
  kind: FindingKind;
  severity: "info" | "attention";
  summary: string;
  /** What the agent should actually do about it on its next connection. */
  suggestedWork: string;
  subjectIds: string[];
}

export interface IntrospectionReport {
  findings: MemoryFinding[];
  graphSummary: { nodes: number; edges: number; orphans: number; counts: Record<string, number> };
  summary: string;
}

/**
 * Inspects the knowledge graph for knowledge that arrived and was never used, mistakes the
 * system keeps repeating, and work that stalled mid-lifecycle.
 *
 * Orphans are the reason this exists. A claim nobody turned into a hypothesis is invisible to
 * any root-anchored trace, because by definition nothing points at it — it can sit in the
 * database forever looking like progress.
 */
export function inspectMemory(graph: MemoryGraph = buildMemoryGraph()): IntrospectionReport {
  const findings: MemoryFinding[] = [];

  if (graph.nodes.length === 0) {
    findings.push({
      kind: "empty_memory",
      severity: "attention",
      summary: "The knowledge base is empty — nothing has been ingested yet.",
      suggestedWork: "Ingest a first source with the ingest-research skill so later cycles have material to work with.",
      subjectIds: [],
    });
  }

  const orphansOfType = (type: string) => graph.orphans.filter((node) => node.type === type);

  const orphanClaims = orphansOfType("claim");
  if (orphanClaims.length > 0) {
    findings.push({
      kind: "orphan_knowledge",
      severity: "attention",
      summary: `${orphanClaims.length} claim(s) recorded but never turned into a hypothesis.`,
      suggestedWork:
        "Read each claim and either raise a falsifiable hypothesis from it, or record why it cannot support one.",
      subjectIds: orphanClaims.slice(0, 20).map((node) => node.id),
    });
  }

  const orphanHypotheses = orphansOfType("hypothesis");
  if (orphanHypotheses.length > 0) {
    findings.push({
      kind: "orphan_knowledge",
      severity: "info",
      summary: `${orphanHypotheses.length} hypothesis(es) have no strategy implementing them.`,
      suggestedWork: "Compile a candidate for the most promising, or retire the hypothesis with a stated reason.",
      subjectIds: orphanHypotheses.slice(0, 20).map((node) => node.id),
    });
  }

  // The orphan that matters most, and the one this inspection used to miss entirely: a
  // strategy connected to nothing implements no hypothesis and has never been tested. There is
  // no claim it descends from, so there is nothing it could turn out to be wrong about — it is
  // conviction with no evidence on either side of it.
  const orphanStrategies = orphansOfType("strategy");
  if (orphanStrategies.length > 0) {
    findings.push({
      kind: "orphan_knowledge",
      severity: "attention",
      summary: `${orphanStrategies.length} strategy(ies) implement no hypothesis and have never been tested.`,
      suggestedWork:
        "Attach the hypothesis each one came from, or retire it with a reason. A strategy with no stated reason to exist cannot be falsified.",
      subjectIds: orphanStrategies.slice(0, 20).map((node) => node.id),
    });
  }

  const unsupportedLessons = orphansOfType("lesson");
  if (unsupportedLessons.length > 0) {
    findings.push({
      kind: "unsupported_lesson",
      severity: "attention",
      summary: `${unsupportedLessons.length} lesson(s) cite no source or claim.`,
      suggestedWork:
        "Attach the evidence each lesson was drawn from, or delete it. An uncited lesson is an assertion nobody can check.",
      subjectIds: unsupportedLessons.slice(0, 20).map((node) => node.id),
    });
  }

  for (const failure of graph.repeatedFailures) {
    if (failure.occurrences < IDLE_THRESHOLDS.repeatedFailureThreshold) continue;
    findings.push({
      kind: "repeated_failure",
      severity: "attention",
      summary: `"${failure.failureMode}" has been recorded ${failure.occurrences} times.`,
      suggestedWork:
        "Three occurrences is a pattern. Find the shared cause and record it as a lesson, so the next candidate is rejected before it spends a trial.",
      subjectIds: [failure.failureMode],
    });
  }

  const stalled = graph.nodes.filter(
    (node) => node.type === "strategy" && (node.status === "draft" || node.status === "validating"),
  );
  if (stalled.length > 0) {
    findings.push({
      kind: "stalled_strategy",
      severity: "info",
      summary: `${stalled.length} strategy(ies) still sitting in draft or validating.`,
      suggestedWork:
        "Run the gauntlet on each or reject it explicitly. A strategy in limbo consumes attention without producing evidence.",
      subjectIds: stalled.slice(0, 20).map((node) => node.id),
    });
  }

  const attention = findings.filter((finding) => finding.severity === "attention").length;

  return {
    findings,
    graphSummary: {
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      orphans: graph.orphans.length,
      counts: graph.counts,
    },
    summary: findings.length
      ? `${findings.length} finding(s), ${attention} needing attention, across ${graph.nodes.length} memory nodes.`
      : `Memory is tidy: ${graph.nodes.length} nodes, nothing orphaned, no repeated failure modes.`,
  };
}
