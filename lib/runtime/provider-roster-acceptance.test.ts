import { describe, expect, it } from "vitest";
import { buildDetectedRoster } from "./roster";
import { routeRoleModel, type EmpiricalModelStats } from "./model-router";
import type { CatalogModel, DetectedProvider } from "./providers";

/**
 * The owner's one-model / five-model acceptance, on the REAL pipeline pieces: detection →
 * `buildDetectedRoster` (enumerated models now have a live producer — the HTTP wires) →
 * `routeRoleModel`. What is pinned:
 *
 *   - a one-entry roster serves EVERY role honestly (routed as "only available", never refused
 *     for lacking competition);
 *   - a five-model, mixed-family roster assigns per role from the ACTUAL roster; a role that
 *     needs structuredOutput can never land on a local model whose provider does not declare it
 *     (capability-aware allocation, not name-based preference).
 */

const NO_STATS: EmpiricalModelStats = { lookup: () => null };

function model(provider: DetectedProvider["id"], modelId: string): CatalogModel {
  return { provider, modelId, relativeQuality: "BASIC", relativeCost: "MEDIUM", supportsThinking: false };
}

function ready(id: DetectedProvider["id"], models: CatalogModel[]): DetectedProvider {
  return { id, status: "READY", reason: "test", models, quota: null, detectedAt: new Date().toISOString() };
}

describe("one-model roster", () => {
  it("every semantic role resolves to the only model, stated as such", () => {
    const roster = buildDetectedRoster([ready("vllm-local", [model("vllm-local", "solo-model")])]);
    expect(roster).toHaveLength(1);

    for (const role of ["researcher", "critic", "chief"]) {
      const decision = routeRoleModel({ role, needs: ["research"] }, roster, NO_STATS, "RESEARCH");
      expect(decision.ok, decision.ok ? "" : decision.message).toBe(true);
      if (decision.ok) expect(decision.modelId).toBe("solo-model");
    }
  });
});

describe("five-model mixed-family roster", () => {
  const detected: DetectedProvider[] = [
    // Local family: two discovered models; the descriptor declares NO structured output.
    ready("vllm-local", [model("vllm-local", "local-a"), model("vllm-local", "local-b")]),
    // API family: two discovered models; descriptor declares tools + structured output.
    ready("openai-api", [model("openai-api", "api-a"), model("openai-api", "api-b")]),
    // CLI family: READY but non-enumerating → the truthful sentinel entry.
    ready("claude-code", []),
  ];

  it("builds the five entries and assigns each role from the real roster", () => {
    const roster = buildDetectedRoster(detected);
    expect(roster.map((entry) => entry.modelId).sort()).toEqual(
      ["api-a", "api-b", "claude-code:default", "local-a", "local-b"].sort(),
    );

    const research = routeRoleModel({ role: "researcher", needs: ["research"] }, roster, NO_STATS, "RESEARCH");
    expect(research.ok).toBe(true);
    if (research.ok) expect(research.trail.length).toBe(5);
  });

  it("a structured-output role can NEVER land on a provider that does not declare it", () => {
    const roster = buildDetectedRoster(detected);
    const decision = routeRoleModel(
      { role: "verifier", needs: ["research", "structuredOutput"] },
      roster,
      NO_STATS,
      "RESEARCH",
    );
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(["openai-api", "claude-code"]).toContain(decision.providerId);
    // And the eligible trail excludes both local models — the gate, visible.
    expect(decision.trail.every((line) => line.providerId !== "vllm-local")).toBe(true);
  });

  it("measured verification steers assignment once a model earns history", () => {
    const roster = buildDetectedRoster(detected);
    const stats: EmpiricalModelStats = {
      lookup: (modelId, capability) =>
        modelId === "api-b" && capability === "RESEARCH"
          ? { verificationRate: 0.95, medianLatencyMs: 20_000, samples: 12 }
          : null,
    };
    const decision = routeRoleModel({ role: "researcher", needs: ["research"] }, roster, stats, "RESEARCH");
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.modelId).toBe("api-b");
      expect(decision.source).toBe("EMPIRICAL");
    }
  });
});
