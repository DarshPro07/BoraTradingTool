import { describe, expect, it } from "vitest";
import { getDb, schema } from "@/lib/db";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { overdueBy, parseJob } from "./jobs";
import { MODELS, pickModel, restingModels, restUntil, routeJob, type RunResult } from "./router";

const NOW = new Date("2026-09-19T12:00:00Z");

describe("restUntil — believe a stated reset, otherwise the model's default", () => {
  it("reads 'try again in 3 days 4 hours'", () => {
    const until = restUntil("You've hit your usage limit. Try again in 3 days 4 hours.", MODELS.codex!, NOW)!;
    expect(until.getTime() - NOW.getTime()).toBe((3 * 24 + 4) * 3_600_000);
  });
  it("falls back to the default rest when no time is named", () => {
    const until = restUntil("429 RESOURCE_EXHAUSTED", MODELS.antigravity!, NOW)!;
    expect(until.getTime() - NOW.getTime()).toBe(MODELS.antigravity!.defaultRestMs);
  });
  it("is null for output that is not a quota error", () => {
    expect(restUntil("Recorded 2 sources and 1 hypothesis.", MODELS.codex!, NOW)).toBeNull();
  });
});

describe("pickModel", () => {
  it("takes the cheapest available model in the tier, skipping any at rest", () => {
    expect(pickModel("routine", new Map())).toBe("opencode-free");
    expect(pickModel("routine", new Map([["opencode-free", NOW]]))).toBe("antigravity");
    expect(pickModel("standard", new Map(), ["codex"])).toBe("codex");
  });
});

describe("routeJob — never stalls on one broken or exhausted model", () => {
  useTemporaryDatabase();

  it("falls back past a rate-limited and a failing model, records every attempt and rest", async () => {
    const outcomes: Record<string, RunResult["status"]> = { "opencode-free": "RATE_LIMITED", antigravity: "FAILED", "claude-haiku": "SUCCEEDED" };
    const result = await routeJob(
      { id: "t-job", tier: "routine", prompt: "p", timeoutMs: 1_000 },
      async (spec) => ({ status: outcomes[spec.id] ?? "FAILED", output: outcomes[spec.id] === "RATE_LIMITED" ? "usage limit reached, try again in 2 hours" : "", model: spec.id, durationMs: 1 }),
    );
    expect(result?.model).toBe("claude-haiku");
    expect(getDb().select().from(schema.agentRuns).all().map((r) => r.status)).toEqual(["RATE_LIMITED", "FAILED", "SUCCEEDED"]);
    const resting = restingModels();
    expect([...resting.keys()].sort()).toEqual(["antigravity", "opencode-free"]);
    expect(resting.get("opencode-free")!.getTime() - Date.now()).toBeGreaterThan(1.9 * 3_600_000);
  });
});

describe("jobs", () => {
  useTemporaryDatabase();
  const job = parseJob("---\nid: j1\nlayer: L1\ntier: routine\ncadenceMinutes: 120\n---\nDo the thing.");

  it("parses frontmatter and prompt", () => {
    expect(job).toMatchObject({ id: "j1", tier: "routine", cadenceMs: 7_200_000, prompt: "Do the thing." });
  });

  it("is due when never run, not due right after a success, due again past its cadence", () => {
    expect(overdueBy(job, NOW.getTime())).not.toBeNull();
    getDb().insert(schema.agentRuns).values({
      id: "r1", capability: "j1", provider: "gemini", model: "gemini", status: "SUCCEEDED", trigger: "SCHEDULED",
      startedAt: NOW, completedAt: NOW,
    }).run();
    expect(overdueBy(job, NOW.getTime() + 60_000)).toBeNull();
    expect(overdueBy(job, NOW.getTime() + 121 * 60_000)).not.toBeNull();
  });
});

describe("runModel — a CLI that reads stdin must not hang", () => {
  it("closes stdin, so a program waiting for end-of-input still finishes", async () => {
    // Smoke test 2026-09-19: OpenCode waited on an open stdin pipe for the full 12-minute timeout.
    const { runModel } = await import("./router");
    const waitsForEof = { ...MODELS["opencode-free"]!, command: process.execPath, args: ["-e", "process.stdin.resume();process.stdin.on('end',()=>console.log('started'))", "--"] };
    const result = await runModel(waitsForEof, "prompt", 5_000);
    expect(result.status).toBe("SUCCEEDED");
    expect(result.output).toMatch(/started/);
  });
});

describe("review findings: tool scope and quota false positives", () => {
  it("maps a job's tools to exact Claude tool names — no marketpulse wildcard", async () => {
    const { claudeToolNames } = await import("./router");
    const names = claudeToolNames(["marketpulse_record_source", "memory_recall", "WebFetch"]);
    expect(names).toEqual(["mcp__marketpulse__marketpulse_record_source", "mcp__mem0__memory_recall", "WebFetch"]);
    expect(names.some((n) => n.endsWith("*"))).toBe(false);
  });

  it("does not mistake a short answer that mentions quotas for a rate limit", () => {
    expect(restUntil("Reviewed 2 papers on quota-based liquidity rules.", MODELS.codex!, NOW)).toBeNull();
    expect(restUntil("You have hit your usage limit.", MODELS.codex!, NOW)).not.toBeNull();
  });
});
