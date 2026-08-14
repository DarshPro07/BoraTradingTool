import { describe, expect, it } from "vitest";
import type { ModelCapabilities, ModelEntry } from "./model-catalog";
import { computeModelStats } from "./model-stats";
import {
  routeRoleModel,
  type EmpiricalModelStats,
  type ModelStat,
  type RoleModelRequirement,
} from "./model-router";

/**
 * The ModelRouter — the learned, role-based model selection of rung 4. No database and no vendor
 * names: a fixture roster (`ModelEntry[]`) plus a fixture/ledger-derived stats source prove the
 * POLICY. The learned signal comes from `computeModelStats` over the AgentRun ledger.
 */

function model(
  modelId: string,
  providerId: ModelEntry["providerId"],
  caps: Partial<ModelCapabilities>,
  costClass: ModelEntry["costClass"],
  latencyClass: ModelEntry["latencyClass"],
  opts: { available?: boolean; health?: ModelEntry["health"] } = {},
): ModelEntry {
  return {
    modelId,
    providerId,
    capabilities: {
      reasoning: false, coding: false, research: false, toolUse: false,
      structuredOutput: false, vision: false, longContext: false, financialTimeseries: false,
      ...caps,
    },
    costClass,
    latencyClass,
    contextWindow: 200_000,
    available: opts.available ?? true,
    health: opts.health ?? "READY",
  };
}

function statsOf(entries: Record<string, ModelStat>): EmpiricalModelStats {
  return { lookup: (modelId, capability) => entries[`${modelId}|${capability}`] ?? null };
}

const NO_STATS: EmpiricalModelStats = { lookup: () => null };
const researchRole: RoleModelRequirement = { role: "researcher", needs: ["research"] };

describe("routeRoleModel — capability filter", () => {
  it("excludes a model that does not declare the needed capability", () => {
    const roster = [
      model("m-research", "claude-code", { research: true }, "SUBSCRIPTION", "MEDIUM"),
      model("m-coding-only", "codex", { coding: true }, "SUBSCRIPTION", "FAST"),
    ];
    const decision = routeRoleModel(researchRole, roster, NO_STATS, "RESEARCH");
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.modelId).toBe("m-research");
    expect(decision.trail.map((t) => t.modelId), "the coding-only model is not an eligible candidate").toEqual(["m-research"]);
  });
});

describe("routeRoleModel — learns from the ledger", () => {
  const A = model("m-accurate", "claude-code", { research: true }, "SUBSCRIPTION", "MEDIUM");
  const B = model("m-fast", "codex", { research: true }, "SUBSCRIPTION", "MEDIUM");
  const roster = [A, B];

  it("routes to the model with the higher LEARNED verification rate (source EMPIRICAL)", () => {
    const stats = statsOf({
      "m-accurate|RESEARCH": { verificationRate: 0.94, medianLatencyMs: 22_000, samples: 10 },
      "m-fast|RESEARCH": { verificationRate: 0.8, medianLatencyMs: 8_000, samples: 10 },
    });
    const decision = routeRoleModel(researchRole, roster, stats, "RESEARCH");
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.modelId, "94% verified beats 80% for a research role").toBe("m-accurate");
    expect(decision.source).toBe("EMPIRICAL");
    expect(decision.reason).toContain("earned");
  });

  it("a role that WEIGHTS latency prefers the faster model even with a small verification deficit", () => {
    const stats = statsOf({
      "m-accurate|RESEARCH": { verificationRate: 0.94, medianLatencyMs: 22_000, samples: 10 },
      "m-fast|RESEARCH": { verificationRate: 0.8, medianLatencyMs: 8_000, samples: 10 },
    });
    const latencySensitive: RoleModelRequirement = { role: "fast_screen", needs: ["research"], weights: { verification: 0.3, cost: 0.2, latency: 1.0 } };
    const decision = routeRoleModel(latencySensitive, roster, stats, "RESEARCH");
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.modelId, "the same roster routes DIFFERENTLY per the role's weights").toBe("m-fast");
  });

  it("tries an unproven model on its prior, but a proven high-verification model still wins", () => {
    const stats = statsOf({ "m-accurate|RESEARCH": { verificationRate: 0.94, medianLatencyMs: 22_000, samples: 10 } });
    const withNewcomer = [A, model("m-new", "deepseek", { research: true }, "SUBSCRIPTION", "MEDIUM")];
    const decision = routeRoleModel(researchRole, withNewcomer, stats, "RESEARCH");
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.modelId).toBe("m-accurate");
    // The newcomer is eligible (tried on its prior), not rejected for lacking history.
    expect(decision.trail.map((t) => t.modelId).sort()).toEqual(["m-accurate", "m-new"]);
    expect(decision.trail.find((t) => t.modelId === "m-new")?.source).toBe("PRIOR");
  });
});

describe("routeRoleModel — hard caps and refusal (never a silent downgrade)", () => {
  it("rejects a model over the latency cap", () => {
    const roster = [
      model("m-slow", "claude-code", { research: true }, "SUBSCRIPTION", "MEDIUM"),
      model("m-quick", "codex", { research: true }, "SUBSCRIPTION", "FAST"),
    ];
    const stats = statsOf({
      "m-slow|RESEARCH": { verificationRate: 0.95, medianLatencyMs: 22_000, samples: 10 },
      "m-quick|RESEARCH": { verificationRate: 0.85, medianLatencyMs: 8_000, samples: 10 },
    });
    const capped: RoleModelRequirement = { role: "researcher", needs: ["research"], maxLatencyMs: 10_000 };
    const decision = routeRoleModel(capped, roster, stats, "RESEARCH");
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.modelId, "the accurate-but-slow model is capped out").toBe("m-quick");
  });

  it("applies the verification FLOOR to proven models only — an unproven model is still tried", () => {
    const roster = [
      model("m-weak", "deepseek", { research: true }, "SUBSCRIPTION", "FAST"),
      model("m-new", "codex", { research: true }, "SUBSCRIPTION", "MEDIUM"),
    ];
    const stats = statsOf({ "m-weak|RESEARCH": { verificationRate: 0.4, medianLatencyMs: 8_000, samples: 12 } });
    const strict: RoleModelRequirement = { role: "researcher", needs: ["research"], minVerificationRate: 0.7 };
    const decision = routeRoleModel(strict, roster, stats, "RESEARCH");
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    // The proven-weak model is rejected by the floor; the unproven one is judged on its prior and wins.
    expect(decision.modelId).toBe("m-new");
    expect(decision.source).toBe("PRIOR");
  });

  it("refuses NO_MODEL_AVAILABLE when nothing declares the capability", () => {
    const roster = [model("m-coding", "codex", { coding: true }, "SUBSCRIPTION", "FAST")];
    const decision = routeRoleModel(researchRole, roster, NO_STATS, "RESEARCH");
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.code).toBe("NO_MODEL_AVAILABLE");
    expect(decision.attempted.map((a) => a.modelId)).toContain("m-coding");
  });

  it("refuses NO_MODEL_MEETS_REQUIREMENTS when capable models all fail the hard caps", () => {
    const roster = [model("m-slow", "claude-code", { research: true }, "SUBSCRIPTION", "SLOW")];
    const stats = statsOf({ "m-slow|RESEARCH": { verificationRate: 0.95, medianLatencyMs: 55_000, samples: 10 } });
    const capped: RoleModelRequirement = { role: "researcher", needs: ["research"], maxLatencyMs: 5_000 };
    const decision = routeRoleModel(capped, roster, stats, "RESEARCH");
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.code, "capable but over the cap is a different failure than nothing capable").toBe("NO_MODEL_MEETS_REQUIREMENTS");
    expect(decision.attempted[0].reason).toContain("latency");
  });

  it("excludes an unhealthy model", () => {
    const roster = [
      model("m-down", "claude-code", { research: true }, "SUBSCRIPTION", "FAST", { health: "UNAVAILABLE" }),
      model("m-up", "codex", { research: true }, "SUBSCRIPTION", "MEDIUM"),
    ];
    const decision = routeRoleModel(researchRole, roster, NO_STATS, "RESEARCH");
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.modelId).toBe("m-up");
  });
});

describe("computeModelStats — learns per (model, capability) from the ledger", () => {
  const START = new Date("2026-08-14T09:00:00.000Z");
  function run(model: string, status: string, verificationStatus: string | null, durMs: number, provider = "claude-code", capability = "RESEARCH") {
    return { model, capability, status, verificationStatus, provider, startedAt: START, completedAt: new Date(START.getTime() + durMs) };
  }

  it("counts a COMPLETED+SOURCE_VERIFIED as a win, a CONFLICTED completion and a FAILED as not, and excludes deterministic runs", () => {
    const rows = [
      run("m-good", "COMPLETED", "SOURCE_VERIFIED",10_000),
      run("m-good", "COMPLETED", "SOURCE_VERIFIED",20_000),
      run("m-good", "COMPLETED", "SOURCE_VERIFIED",30_000),
      run("m-good", "FAILED", null,5_000),
      run("m-bad", "COMPLETED", "CONFLICTED",8_000),
      run("m-bad", "COMPLETED", "SOURCE_VERIFIED",8_000),
      run("m-bad", "COMPLETED", "INSUFFICIENT_EVIDENCE",8_000),
      run("chief_of_staff", "COMPLETED", null,1_000, "deterministic"),
    ];
    const stats = computeModelStats(rows);

    const good = stats.lookup("m-good", "RESEARCH");
    expect(good).toMatchObject({ samples: 4, medianLatencyMs: 15_000 }); // 3 verified of 4
    expect(good?.verificationRate).toBeCloseTo(0.75, 5);

    const bad = stats.lookup("m-bad", "RESEARCH");
    expect(bad?.verificationRate, "only 1 of 3 completions was verified").toBeCloseTo(1 / 3, 5);

    // The deterministic Chief-of-Staff synthesis is not a model observation.
    expect(stats.lookup("chief_of_staff", "RESEARCH")).toBeNull();
  });

  it("keys stats by capability, so the same model has independent records per capability", () => {
    const rows = [
      run("m", "COMPLETED", "SOURCE_VERIFIED",10_000, "claude-code", "RESEARCH"),
      run("m", "FAILED", null,10_000, "claude-code", "CODING"),
    ];
    const stats = computeModelStats(rows);
    expect(stats.lookup("m", "RESEARCH")?.verificationRate).toBe(1);
    expect(stats.lookup("m", "CODING")?.verificationRate).toBe(0);
  });
});
