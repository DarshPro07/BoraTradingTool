import { describe, expect, it } from "vitest";
import { sizeDeskTrade } from "./desk";

/**
 * The desk's Risk role. AutoHedge's risk agent is an LLM asked for "a recommended position size";
 * this is arithmetic over the owner's real cash, the paper engine's real cap and the real cost
 * model — so the answer cannot be talked into a trade the numbers do not support.
 */

const at = new Date("2026-09-18T06:00:00Z");
const account = { cash: 1_000, startingCash: 1_000, maxPositionPct: 15 };

describe("sizeDeskTrade", () => {
  it("refuses a stock one share of which exceeds the position cap", () => {
    // RELIANCE at 1,226 against a 15% cap on 1,000 = 150.
    const sized = sizeDeskTrade({ ...account, entry: 1_226, stop: 1_180, target: 1_340, at });
    expect(sized.verdict).toBe("UNAFFORDABLE");
    expect(sized.quantity).toBe(0);
    expect(sized.reason).toMatch(/150/);
  });

  it("refuses a delivery trade whose expected move does not clear twice its cost", () => {
    // A 140 stock, 1 share: the ~16 DP charge is ~11% of the position; a 10% target cannot pay it.
    const sized = sizeDeskTrade({ ...account, entry: 140, stop: 133, target: 154, at });
    expect(sized.verdict).toBe("COST_EXCEEDS_EDGE");
    expect(sized.costPct).toBeGreaterThan(0.1);
  });

  it("sizes a trade that clears its cost, capped by position size and by risk", () => {
    const sized = sizeDeskTrade({
      cash: 50_000, startingCash: 50_000, maxPositionPct: 15, entry: 500, stop: 480, target: 560, at,
    });
    // Cap 7,500 -> 15 shares; risk 2% of 50,000 = 1,000 / 20 per share -> 50. The cap binds.
    expect(sized.verdict).toBe("SIZED");
    expect(sized.quantity).toBe(15);
    expect(sized.rewardAmount).toBeGreaterThan(2 * sized.costTotal);
  });

  it("lets the risk budget bind when the stop is wide", () => {
    const sized = sizeDeskTrade({
      cash: 50_000, startingCash: 50_000, maxPositionPct: 50, entry: 500, stop: 400, target: 800, at,
    });
    // Risk 1,000 / 100 per share -> 10, below the cap's 50.
    expect(sized.quantity).toBe(10);
  });

  it("rejects levels that do not describe a long trade", () => {
    expect(sizeDeskTrade({ ...account, entry: 100, stop: 105, target: 120, at }).verdict).toBe("BAD_LEVELS");
    expect(sizeDeskTrade({ ...account, entry: 100, stop: 95, target: 99, at }).verdict).toBe("BAD_LEVELS");
  });
});
