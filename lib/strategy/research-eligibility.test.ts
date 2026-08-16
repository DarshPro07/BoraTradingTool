import { describe, expect, it } from "vitest";
import { classifySpec, marketOfDsl } from "./research-eligibility";

/**
 * Measured 2026-08-16: 14 of 22 strategy specs in the production database were Playwright
 * artifacts, and the pool criterion's "2 strategies standing ready to spend a trial" rested on a
 * US strategy whose verdict could not be reproduced. Neither is deleted — deleting audit history
 * to improve a number is the wrong trade — so the scoreboard has to be able to tell them apart.
 */

const production = { name: "orb_nse_5m", createdBy: "claude-code:intraday", market: "NSE" };

describe("classifying what the scoreboard may count", () => {
  it("counts a spec authored for the research programme", () => {
    const verdict = classifySpec(production);
    expect(verdict.origin).toBe("PRODUCTION_RESEARCH");
    expect(verdict.researchEligible).toBe(true);
  });

  it("excludes the test actors that wrote the fixtures", () => {
    for (const actor of ["e2e", "e2e-fixture", "http-20124"]) {
      const verdict = classifySpec({ ...production, createdBy: actor });
      expect(verdict.origin, actor).toBe("E2E_FIXTURE");
      expect(verdict.researchEligible).toBe(false);
    }
  });

  it("excludes by name too, because a fixture can be written by any client", () => {
    for (const name of [
      "e2e_ladder_fixture",
      "ledger_gap_screen_mspoa7oo_desktop_chromium_19b3a004",
      "forward_gap_screen_mspoay1y_9efa7384",
    ]) {
      const verdict = classifySpec({ ...production, name });
      expect(verdict.origin, name).toBe("E2E_FIXTURE");
    }
  });

  it("does not mistake a real strategy for a fixture", () => {
    // The guard must not be so eager that it quarantines the research it exists to protect.
    for (const name of ["sma_cross_20_50", "gap_largecap_premarket", "first_hour_momentum_nse_5m"]) {
      expect(classifySpec({ ...production, name }).origin, name).toBe("PRODUCTION_RESEARCH");
    }
  });

  it("marks an unsupported market PERMANENT, not blocked", () => {
    // The distinction that matters: a US strategy is not waiting for data. There is no ingestion
    // path for it, so no amount of autonomous work changes the answer.
    const verdict = classifySpec({ ...production, name: "sma_cross_20_50", market: "US" });
    expect(verdict.origin).toBe("UNSUPPORTED_MARKET");
    expect(verdict.researchEligible).toBe(false);
    expect(verdict.resolutionOwner).toBe("PERMANENT");
    expect(verdict.reason).toMatch(/out of scope/i);
  });

  it("keeps NSE and BSE in scope", () => {
    for (const market of ["NSE", "BSE", "IN"]) {
      expect(classifySpec({ ...production, market }).researchEligible, market).toBe(true);
    }
  });

  it("does not guess when the market cannot be read", () => {
    // An unparseable DSL is not evidence of an unsupported market.
    expect(classifySpec({ ...production, market: null }).origin).toBe("PRODUCTION_RESEARCH");
    expect(marketOfDsl("{ not json")).toBeNull();
    expect(marketOfDsl(JSON.stringify({ universe: { market: "NSE" } }))).toBe("NSE");
  });
});
