import { describe, expect, it } from "vitest";
import { PROVIDER_REGISTRY, type DetectedProvider, type ProviderId } from "./providers";
import { DETERMINISTIC_ENGINE, defaultProfile, route } from "./routing";

/**
 * The AI runtime's honesty properties, as tests. Each one guards a way the router could quietly
 * lie: routing arithmetic to a language model, offering a forecasting model as a chatbot,
 * swapping providers without saying so, calling a prepaid plan free, or inventing an answer when
 * nothing can serve.
 */

function detected(id: ProviderId, status: DetectedProvider["status"] = "READY"): DetectedProvider {
  return { id, status, reason: `${id} ${status}`, models: [], quota: null, detectedAt: "2026-08-10T17:00:00.000Z" };
}

const PROFILE = defaultProfile("BALANCED", "boot_test");

describe("arithmetic is not routable", () => {
  it("sends DETERMINISTIC to the quant core even when every model is available", () => {
    const all = (Object.keys(PROVIDER_REGISTRY) as ProviderId[]).map((id) => detected(id));
    const outcome = route("DETERMINISTIC", all, PROFILE);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.resolved).toBe(DETERMINISTIC_ENGINE);
    expect(outcome.costClass).toBe("NONE");
  });

  it("serves DETERMINISTIC even with nothing detected — the engine is ours, not a provider", () => {
    expect(route("DETERMINISTIC", [], PROFILE).ok).toBe(true);
  });
});

describe("the forecasting model keeps its own lane", () => {
  it("routes TIME_SERIES only to the financial model", () => {
    const outcome = route("TIME_SERIES", [detected("kronos"), detected("claude-code")], PROFILE);
    expect(outcome.ok && outcome.resolved).toBe("kronos");
  });

  it("refuses TIME_SERIES rather than substituting a chatbot", () => {
    // Every LLM present, Kronos absent. A language model must not answer a forecast.
    const outcome = route("TIME_SERIES", [detected("claude-code"), detected("codex"), detected("deepseek")], PROFILE);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("PROVIDER_UNAVAILABLE");
    expect(outcome.message).toMatch(/queued rather than answered by a fabricated response|No provider is configured/);
  });
});

describe("fallback is never silent", () => {
  it("records what was requested, what ran, and why they differ", () => {
    // The 2026-08-10 incident, as a test: Codex 429 → the next usable provider, stated.
    const outcome = route(
      "CODING",
      [detected("codex", "QUOTA_EXHAUSTED"), detected("claude-code")],
      PROFILE,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.requested).toBe("codex");
    expect(outcome.resolved).toBe("claude-code");
    expect(outcome.fallbackReason).toMatch(/codex: QUOTA_EXHAUSTED/);
  });

  it("leaves fallbackReason null when the first choice actually served", () => {
    const outcome = route("CODING", [detected("codex")], PROFILE);
    expect(outcome.ok && outcome.fallbackReason).toBeNull();
  });

  it("returns the full attempt trail when nothing can serve", () => {
    const outcome = route("RESEARCH", [detected("scout", "UNHEALTHY"), detected("claude-code", "UNAUTHENTICATED")], PROFILE);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.attempted.map((entry) => entry.provider)).toContain("scout");
    expect(outcome.attempted.some((entry) => /UNAUTHENTICATED/.test(entry.reason))).toBe(true);
  });
});

describe("budget separates prepaid capacity from metered spend", () => {
  it("never calls a subscription free", () => {
    expect(PROVIDER_REGISTRY["claude-code"].costClass).toBe("SUBSCRIPTION");
    expect(PROVIDER_REGISTRY.codex.costClass).toBe("SUBSCRIPTION");
    expect(PROVIDER_REGISTRY.deepseek.costClass).toBe("API");
    expect(PROVIDER_REGISTRY.kronos.costClass).toBe("LOCAL");
  });

  it("stops metered spend at the daily cap without touching prepaid providers", () => {
    const spent = { apiSpentToday: PROFILE.budget.dailyApiBudget };
    const blocked = route("CHEAP", [detected("deepseek")], PROFILE, spent);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe("BUDGET_EXHAUSTED");

    // Same exhausted budget, a prepaid provider available: work continues.
    const served = route("CHEAP", [detected("deepseek"), detected("claude-code")], PROFILE, spent);
    expect(served.ok && served.resolved).toBe("claude-code");
  });

  it("prefers prepaid capacity over metered spend when subscriptionFirst is set", () => {
    expect(PROFILE.budget.subscriptionFirst).toBe(true);
    const outcome = route("CHEAP", [detected("deepseek"), detected("codex")], PROFILE);
    expect(outcome.ok && outcome.resolved).toBe("codex");
  });
});

describe("profiles", () => {
  it("gives every profile the same untouchable rows for arithmetic and forecasting", () => {
    for (const name of ["SUBSCRIPTION_FIRST", "LOW_COST", "BALANCED", "MAX_QUALITY", "CUSTOM"] as const) {
      const profile = defaultProfile(name, `boot_${name}`);
      expect(profile.routing.DETERMINISTIC).toEqual([]);
      expect(profile.routing.TIME_SERIES).toEqual(["kronos"]);
    }
  });

  it("asks on restart by default, as the owner requires", () => {
    expect(defaultProfile("BALANCED", "boot_x").askOnRestart).toBe(true);
  });

  it("spends nothing incrementally in SUBSCRIPTION_FIRST", () => {
    expect(defaultProfile("SUBSCRIPTION_FIRST", "boot_y").budget.dailyApiBudget).toBe(0);
  });
});

describe("refusal codes name the real reason", () => {
  it("reports PROVIDER_UNAVAILABLE, not BUDGET_EXHAUSTED, when a zero-API-budget profile has no provider", () => {
    // The defect this pins (found by the first live M5 run, 2026-08-10): SUBSCRIPTION_FIRST sets
    // dailyApiBudget = 0 on purpose — it spends no metered money by design. The guard read
    // `spentToday >= dailyBudget` as 0 >= 0 = true, so EVERY refusal under the default profile
    // blamed an exhausted budget. Nothing was exhausted and nothing was spent; the machine simply
    // had no research provider. A refusal that names the wrong cause sends the owner to fix the
    // wrong thing.
    const profile = defaultProfile("SUBSCRIPTION_FIRST", "boot_test");
    const outcome = route("RESEARCH", [], profile, { apiSpentToday: 0 });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("PROVIDER_UNAVAILABLE");
  });

  it("still reports BUDGET_EXHAUSTED when a budget genuinely blocked an available provider", () => {
    const profile = defaultProfile("BALANCED", "boot_test");
    const detected = [
      {
        id: "anthropic-api" as const,
        status: "READY" as const,
        reason: "key present",
        models: [],
        quota: null,
        detectedAt: "2026-08-10T00:00:00.000Z",
      },
    ];
    const outcome = route("DEEP_REASONING", detected, profile, { apiSpentToday: 10_000 });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("BUDGET_EXHAUSTED");
    expect(outcome.attempted.some((entry) => entry.reason.includes("budget"))).toBe(true);
  });
});
