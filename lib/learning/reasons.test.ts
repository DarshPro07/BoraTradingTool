import { describe, expect, it } from "vitest";
import { degradesRun, degradingMessages, nextBarOpportunity, type CycleReason } from "./reasons";

describe("reason severity — the one rule, in one place", () => {
  const reasons: CycleReason[] = [
    { code: "STRATEGY_WARMUP", category: "ELIGIBILITY", severity: "INFO", message: "warming up" },
    { code: "QUANT_CORE_STALE", category: "INFRASTRUCTURE", severity: "WARNING", message: "stale" },
    { code: "QUANT_CORE_UNREACHABLE", category: "INFRASTRUCTURE", severity: "DEGRADED", message: "did not answer" },
  ];

  it("only DEGRADED/FAILED degrade; INFO and WARNING never do", () => {
    expect(degradingMessages(reasons)).toEqual(["did not answer"]);
    expect(degradesRun(reasons)).toBe(true);
    expect(degradesRun(reasons.slice(0, 2)), "a WARNING is surfaced, not an impairment").toBe(false);
  });
});

describe("nextBarOpportunity — waiting states name their wake time", () => {
  it("while a session runs, the state can change at the next phase boundary (an exact instant)", () => {
    // Wednesday 2026-08-12, 10:00 IST — mid NSE regular session. The next daily bar settles at
    // the 15:30 close, 330 minutes away. A minute delta from `at` is DST-safe by construction.
    const at = new Date("2026-08-12T04:30:00Z");
    const resume = nextBarOpportunity("IN", at);
    expect(resume).toBe(new Date(at.getTime() + 330 * 60_000).toISOString());
  });

  it("while the exchange is shut for the day, nothing changes before the next session opens", () => {
    // Saturday 2026-08-15 — a weekend AND Independence Day. Sunday follows; Monday the 17th is
    // the next trading day. Reported as a plainly-labelled exchange-local time, never a quietly
    // wrong UTC conversion — the market clock's own doctrine.
    const resume = nextBarOpportunity("IN", new Date("2026-08-15T05:00:00Z"));
    expect(resume).toBe("2026-08-17 09:00 Asia/Kolkata");
  });
});
