import { describe, expect, it } from "vitest";
import type { DetectedProvider } from "./providers";
import { buildDetectedRoster, isProviderDefaultModel, providerDefaultModelId } from "./roster";

/**
 * The REAL roster builder (masterclass A6.1): detection truth → ModelEntry[], with no fabricated
 * model names or capabilities, and a truthful sentinel for READY-but-non-enumerating providers.
 */

function detected(partial: Partial<DetectedProvider> & { id: DetectedProvider["id"] }): DetectedProvider {
  return {
    status: "READY",
    reason: "test",
    models: [],
    quota: null,
    detectedAt: "2026-08-14T00:00:00.000Z",
    ...partial,
  };
}

describe("buildDetectedRoster", () => {
  it("a READY LLM that enumerates models yields one roster entry per DISCOVERED model", () => {
    const roster = buildDetectedRoster([
      detected({
        id: "anthropic-api",
        models: [
          { provider: "anthropic-api", modelId: "discovered-a", relativeQuality: "FRONTIER", relativeCost: "HIGH", supportsThinking: true },
          { provider: "anthropic-api", modelId: "discovered-b", relativeQuality: "BASIC", relativeCost: "LOW", supportsThinking: false },
        ],
      }),
    ]);

    expect(roster.map((m) => m.modelId).sort()).toEqual(["discovered-a", "discovered-b"]);
    // Capability flags come from the provider DESCRIPTOR's declared support — registry truth.
    expect(roster[0].capabilities.research).toBe(true);
    expect(roster[0].capabilities.toolUse).toBe(true);
    // Latency maps from the catalog's own relative cost; nothing is invented.
    expect(roster.find((m) => m.modelId === "discovered-a")?.latencyClass).toBe("SLOW");
    expect(roster.find((m) => m.modelId === "discovered-b")?.latencyClass).toBe("FAST");
  });

  it("a READY LLM that does NOT enumerate gets exactly one truthful `<provider>:default` sentinel", () => {
    const roster = buildDetectedRoster([detected({ id: "claude-code", models: [] })]);

    expect(roster).toHaveLength(1);
    expect(roster[0].modelId).toBe(providerDefaultModelId("claude-code"));
    expect(isProviderDefaultModel(roster[0].modelId)).toBe(true);
    expect(roster[0].costClass, "cost class is the registry's declared truth").toBe("SUBSCRIPTION");
    expect(roster[0].contextWindow, "unreported = 0, never a guessed number").toBe(0);
  });

  it("non-READY providers and non-LLM providers are excluded — the roster is what can actually serve", () => {
    const roster = buildDetectedRoster([
      detected({ id: "claude-code", status: "NOT_DETECTED", reason: "CLI missing" }),
      detected({ id: "kronos" }), // FINANCIAL_MODEL — never offered as a chatbot
      detected({ id: "scout" }), // RESEARCH_SERVICE
    ]);
    expect(roster).toEqual([]);
  });

  it("malformed enumerations (non-CatalogModel entries) are ignored, falling back to the sentinel", () => {
    const roster = buildDetectedRoster([
      detected({ id: "claude-code", models: ["test-model" as never] }),
    ]);
    expect(roster).toHaveLength(1);
    expect(roster[0].modelId).toBe("claude-code:default");
  });

  it("is roster-agnostic: two READY providers yield entries for both", () => {
    const roster = buildDetectedRoster([
      detected({ id: "claude-code" }),
      detected({
        id: "deepseek",
        models: [{ provider: "deepseek", modelId: "ds-discovered", relativeQuality: "STRONG", relativeCost: "MEDIUM", supportsThinking: false }],
      }),
    ]);
    expect(roster.map((m) => `${m.providerId}/${m.modelId}`).sort()).toEqual([
      "claude-code/claude-code:default",
      "deepseek/ds-discovered",
    ]);
  });
});
