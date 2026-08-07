import { describe, expect, it } from "vitest";
import type { MemoryGraph } from "@/lib/knowledge/memory-graph";
import { assessIdle, inspectMemory } from "./introspection";

const T0 = new Date("2026-08-06T10:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

function graph(overrides: Partial<MemoryGraph> = {}): MemoryGraph {
  return {
    nodes: [],
    edges: [],
    counts: {},
    orphans: [],
    repeatedFailures: [],
    generatedAt: T0.toISOString(),
    ...overrides,
  };
}

function node(id: string, type: string, status?: string) {
  return { id, type, label: id, status, createdAt: T0 } as MemoryGraph["nodes"][number];
}

describe("idle detection", () => {
  it("treats a recently active owner as active", () => {
    expect(assessIdle(T0, at(5)).state).toBe("active");
  });

  it("becomes idle at the threshold, not one minute after it", () => {
    expect(assessIdle(T0, at(14)).state).toBe("active");
    expect(assessIdle(T0, at(15)).state).toBe("idle");
  });

  it("escalates to deep idle after an hour", () => {
    expect(assessIdle(T0, at(59)).state).toBe("idle");
    expect(assessIdle(T0, at(60)).state).toBe("deep_idle");
  });

  it("never reports negative idle time when clocks disagree", () => {
    const { minutesIdle, state } = assessIdle(at(30), T0);
    expect(minutesIdle).toBe(0);
    expect(state).toBe("active");
  });
});

describe("memory inspection", () => {
  it("calls out an empty knowledge base rather than reporting it as tidy", () => {
    const report = inspectMemory(graph());
    expect(report.findings.map((finding) => finding.kind)).toContain("empty_memory");
  });

  it("reports memory with no problems as tidy", () => {
    const report = inspectMemory(
      graph({ nodes: [node("src_1", "source"), node("clm_1", "claim")], edges: [{ from: "src_1", to: "clm_1", relation: "asserts" }] }),
    );
    expect(report.findings).toHaveLength(0);
    expect(report.summary).toMatch(/tidy/);
  });

  it("flags claims that never became a hypothesis", () => {
    const orphan = node("clm_9", "claim");
    const report = inspectMemory(graph({ nodes: [orphan], orphans: [orphan] }));
    const finding = report.findings.find((item) => item.kind === "orphan_knowledge");
    expect(finding?.severity).toBe("attention");
    expect(finding?.subjectIds).toContain("clm_9");
  });

  it("flags a strategy that descends from nothing and has never been tested", () => {
    const orphan = node("stg_1", "strategy", "candidate");
    const report = inspectMemory(graph({ nodes: [orphan], orphans: [orphan] }));
    const finding = report.findings.find((item) => item.summary.includes("strategy(ies)"));
    expect(finding?.severity).toBe("attention");
    expect(finding?.subjectIds).toContain("stg_1");
    expect(finding?.suggestedWork).toMatch(/falsified/);
  });

  it("does not call a tested strategy an orphan just because it has no hypothesis", () => {
    // Connected in one direction is still connected: this one has evidence, only no origin.
    const strategy = node("stg_2", "strategy", "candidate");
    const trial = node("trl_2", "trial", "fail");
    const report = inspectMemory(
      graph({ nodes: [strategy, trial], edges: [{ from: "stg_2", to: "trl_2", relation: "tested_by" }] }),
    );
    expect(report.findings.some((item) => item.summary.includes("strategy(ies) implement no"))).toBe(false);
  });

  it("flags a lesson that cites nothing", () => {
    const orphan = node("lsn_1", "lesson");
    const report = inspectMemory(graph({ nodes: [orphan], orphans: [orphan] }));
    expect(report.findings.some((finding) => finding.kind === "unsupported_lesson")).toBe(true);
  });

  it("treats two occurrences as luck and three as a pattern", () => {
    const twice = inspectMemory(
      graph({
        nodes: [node("src_1", "source")],
        repeatedFailures: [{ failureMode: "cost_stress", occurrences: 2, lastSeen: T0 }],
      }),
    );
    expect(twice.findings.some((finding) => finding.kind === "repeated_failure")).toBe(false);

    const thrice = inspectMemory(
      graph({
        nodes: [node("src_1", "source")],
        repeatedFailures: [{ failureMode: "cost_stress", occurrences: 3, lastSeen: T0 }],
      }),
    );
    expect(thrice.findings.some((finding) => finding.kind === "repeated_failure")).toBe(true);
  });

  it("flags strategies stalled in draft or validating, but not finished ones", () => {
    const report = inspectMemory(
      graph({
        nodes: [
          node("spc_1", "strategy", "draft"),
          node("spc_2", "strategy", "validating"),
          node("spc_3", "strategy", "rejected"),
        ],
      }),
    );
    const finding = report.findings.find((item) => item.kind === "stalled_strategy");
    expect(finding?.subjectIds).toEqual(["spc_1", "spc_2"]);
  });

  it("gives every finding concrete work rather than just a complaint", () => {
    const orphan = node("clm_9", "claim");
    const report = inspectMemory(graph({ nodes: [orphan], orphans: [orphan] }));
    for (const finding of report.findings) {
      expect(finding.suggestedWork.length).toBeGreaterThan(20);
    }
  });
});
