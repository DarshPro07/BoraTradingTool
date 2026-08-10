import { describe, expect, it } from "vitest";
import { roundTripCostBps } from "@/lib/strategy/dsl";
import type { StrategyDsl } from "@/lib/strategy/dsl";
import { CostModelError, roundTripCost } from "./cost-model";
import {
  MAX_POSITION_PCT,
  OWNER_CAPITAL,
  breedingBasis,
  costsForCapital,
  maxViablePositions,
  minimumTradableCapital,
  viableConfiguration,
} from "./capital";

/**
 * The bridge between what trading really costs and what the strategy factory assumes it costs.
 *
 * `lib/factory/breed.ts` hardcodes `{ commissionBps: 3, slippageBps: 7 }`, which
 * `roundTripCostBps` turns into 20 bps — 0.20% a round trip. That number is defensible for a
 * large US position and is wildly wrong for a small Indian one, because the DP charge is flat:
 * the same ₹15.93 whether the position is ₹100 or ₹1,00,000.
 *
 * Every candidate the factory has ever screened was optimised against that 20 bps. These tests
 * measure the gap.
 */

const IN = { market: "IN" as const, product: "DELIVERY" as const };

/** What `breed.ts` assumes today, expressed the way the backtest engine reads it. */
const FACTORY_ASSUMPTION_BPS = (3 + 7) * 2;

function dslWith(costs: { commissionBps: number; slippageBps: number }): StrategyDsl {
  return { costs } as StrategyDsl;
}

describe("the gap between assumed and real cost", () => {
  it("is roughly ninefold at a single ₹1,000 position", () => {
    // ~1.8% a round trip against an assumed 0.20%.
    const real = costsForCapital({ capital: 1_000, positions: 1, ...IN });
    expect(roundTripCostBps(dslWith(real))).toBeGreaterThan(FACTORY_ASSUMPTION_BPS * 8);
  });

  it("closes as the position grows, because the flat charge dilutes", () => {
    const small = roundTripCostBps(dslWith(costsForCapital({ capital: 10_000, positions: 1, ...IN })));
    const large = roundTripCostBps(dslWith(costsForCapital({ capital: 1_000_000, positions: 1, ...IN })));
    expect(large).toBeLessThan(small);
  });

  it("never closes completely, because STT is charged on both delivery legs", () => {
    // Even at ₹10,00,000 the round trip is ~22 bps of statutory cost, so the assumption is
    // optimistic at every size — just not catastrophically so at large ones.
    const huge = roundTripCostBps(dslWith(costsForCapital({ capital: 10_000_000, positions: 1, ...IN })));
    expect(huge).toBeGreaterThan(FACTORY_ASSUMPTION_BPS);
  });
});

describe("costs the backtest engine can actually consume", () => {
  it("produces a DSL cost block the engine reads without adaptation", () => {
    const costs = costsForCapital({ capital: 100_000, positions: 1, ...IN });
    expect(costs.commissionBps).toBeGreaterThan(0);
    expect(costs.slippageBps).toBeGreaterThan(0);
    expect(Number.isFinite(roundTripCostBps(dslWith(costs)))).toBe(true);
  });

  it("keeps slippage as a separate assumption rather than folding it into the statutory cost", () => {
    // Statutory cost is measurable; market impact is an estimate. Merging them would hide which
    // half of the number is a fact and which half is a guess.
    const costs = costsForCapital({ capital: 100_000, positions: 1, ...IN });
    expect(costs.slippageBps).toBe(7);
  });

  it("charges more for a US round trip than nothing, even without Indian statutory charges", () => {
    const us = costsForCapital({ capital: 100_000, positions: 1, market: "US" });
    expect(roundTripCostBps(dslWith(us))).toBeGreaterThan(0);
  });
});

describe("how many positions the capital can carry", () => {
  it("refuses outright at ₹1,000 — no position count works, not even one", () => {
    // The finding that matters most, and it is harsher than "use fewer positions". A whole
    // ₹1,000 committed to a single name still pays ~1.8% a round trip, because ₹15.93 of flat
    // DP charge does not care that ₹1,000 is all the capital there is. Ten positions of ₹100
    // would pay ~16%. There is no split of ₹1,000 that trades economically.
    expect(() => maxViablePositions(1_000, IN)).toThrow(CostModelError);
    expect(() => maxViablePositions(1_000, IN)).toThrow(/1,?000|position/i);
  });

  it("returns the largest count that still clears the bar, and no more", () => {
    // Asserting the definition rather than a remembered number. The exact count falls out of
    // where the viability threshold sits, so pinning it to a literal would test my arithmetic
    // rather than the rule.
    const n = maxViablePositions(100_000, IN);
    const at = (positions: number) =>
      roundTripCost({ ...IN, notional: 100_000 / positions }).pctOfNotional;

    expect(n).toBeGreaterThanOrEqual(1);
    expect(at(n)).toBeLessThanOrEqual(0.005);
    expect(at(n + 1)).toBeGreaterThan(0.005);
  });

  it("grows with capital", () => {
    expect(maxViablePositions(1_000_000, IN)).toBeGreaterThan(maxViablePositions(100_000, IN));
  });

  it("is capped, so a large account does not breed a thousand-name portfolio", () => {
    expect(maxViablePositions(100_000_000, IN)).toBeLessThanOrEqual(20);
  });

  it("refuses rather than returning zero when no position size is viable", () => {
    // Zero would flow downstream as "unlimited" or divide-by-zero. A refusal names the problem.
    expect(() => maxViablePositions(50, IN)).toThrow(CostModelError);
  });
});

describe("what the factory breeds against", () => {
  it("does not halt discovery just because the account is too small to trade", () => {
    // Refusing to breed at ₹1,000 would be defensible and wrong: a rule found today is still a
    // rule when the capital arrives, and the interval spent refusing is discovery lost.
    const basis = breedingBasis();
    expect(basis.positions).toBeGreaterThanOrEqual(1);
    expect(basis.capital).toBeGreaterThan(0);
  });

  it("flags that the figure is assumed, and names the owner's real one", () => {
    const basis = breedingBasis();
    expect(basis.assumed).toBe(true);
    expect(basis.capital).toBeGreaterThan(OWNER_CAPITAL.amount);
    expect(basis.reason).toContain(String(OWNER_CAPITAL.amount));
  });

  it("picks a basis that genuinely clears the viability bar", () => {
    // A basis that is itself unviable would reintroduce the whole defect one level up. Checked
    // against the basis's *own* product: the same ₹500 position is fine on intraday and hopeless
    // on delivery, so asserting against a fixed product would test the wrong market.
    const basis = breedingBasis();
    const size = basis.capital / basis.positions;
    const cost = roundTripCost({ market: "IN", product: basis.product, notional: size });
    expect(cost.pctOfNotional).toBeLessThanOrEqual(0.005);
  });

  it("reaches the owner's ₹1,000 far more closely on intraday than delivery would", () => {
    // Delivery would have forced the basis to ₹32,000. Intraday brings it within one doubling of
    // what the owner actually has, which is the difference between research they can act on and
    // research about somebody else's account.
    const basis = breedingBasis();
    expect(basis.product).toBe("INTRADAY");
    expect(basis.capital).toBeLessThanOrEqual(OWNER_CAPITAL.amount * 4);
  });

  it("funds at least the four positions the concentration cap requires", () => {
    // The collision that broke the first wiring attempt: the DSL forbids more than 25% in one
    // name, so a compliant portfolio needs four positions — and four *viable* positions is a far
    // higher bar than one. A basis satisfying only the cost rule produced specs the DSL rejected.
    expect(breedingBasis().positions).toBeGreaterThanOrEqual(100 / MAX_POSITION_PCT);
  });
});

describe("intraday, which has no flat charge at all", () => {
  const INTRA = { market: "IN" as const, product: "INTRADAY" as const };

  it("costs an order of magnitude less than delivery at ₹1,000", () => {
    // The finding that reopens small-capital trading. Nothing leaves the demat account on an
    // intraday square-off, so no DP charge arises, and STT is 0.025% sell-side only rather than
    // 0.1% on both legs.
    const delivery = roundTripCost({ ...IN, notional: 1_000 }).pctOfNotional;
    const intraday = roundTripCost({ ...INTRA, notional: 1_000 }).pctOfNotional;
    expect(delivery / intraday).toBeGreaterThan(10);
  });

  it("costs the same fraction at every size, because every charge is proportional", () => {
    // Delivery's cost curve bends because ₹15.93 is flat. Intraday's does not bend at all until
    // the ₹20 brokerage cap binds, which is why it reaches down to small accounts and delivery
    // cannot.
    const small = roundTripCost({ ...INTRA, notional: 1_000 }).pctOfNotional;
    const larger = roundTripCost({ ...INTRA, notional: 20_000 }).pctOfNotional;
    expect(small).toBeCloseTo(larger, 5);
  });

  it("needs far less capital than delivery to satisfy the same rules", () => {
    expect(minimumTradableCapital(INTRA)).toBeLessThan(minimumTradableCapital(IN) / 5);
  });
});

describe("a position too small to buy a share", () => {
  it("is refused, however cheap the round trip is", () => {
    // Intraday cost is a flat 0.106% at any notional, so cost alone would happily permit twenty
    // ₹50 positions on a ₹1,000 account. A ₹50 position cannot buy one share of most of the
    // liquid NSE universe, so the cost model would be approving something unexecutable.
    expect(maxViablePositions(1_000, { market: "IN", product: "INTRADAY" })).toBeLessThanOrEqual(2);
  });

  it("is what makes ₹1,000 fall short even on intraday", () => {
    // Not a cost failure — a granularity one. Four positions of at least ₹500 is ₹2,000.
    expect(() => viableConfiguration(1_000, "IN")).toThrow(CostModelError);
    expect(() => viableConfiguration(1_000, "IN")).toThrow(/2,?000/);
  });
});

describe("choosing the product for the capital", () => {
  it("picks intraday at small capital, where delivery is impossible", () => {
    const chosen = viableConfiguration(2_000, "IN");
    expect(chosen.product).toBe("INTRADAY");
    expect(chosen.positions).toBeGreaterThanOrEqual(100 / MAX_POSITION_PCT);
  });

  it("keeps delivery available once the account can carry it", () => {
    // Delivery is the lower-risk product; it should be used the moment it is affordable rather
    // than leaving the owner in intraday forever.
    expect(viableConfiguration(100_000, "IN").product).toBe("DELIVERY");
  });

  it("names both floors when nothing is viable", () => {
    expect(() => viableConfiguration(400, "IN")).toThrow(CostModelError);
  });
});

describe("the capital this market actually requires", () => {
  it("is far above the owner's stated figure, and is arithmetic rather than opinion", () => {
    // Four positions, each large enough that a ~₹15.93 flat charge plus 0.22% statutory cost
    // stays under half a percent a round trip. Both inputs are published; neither is a judgement.
    const floor = minimumTradableCapital(IN);
    expect(floor).toBeGreaterThan(OWNER_CAPITAL.amount * 10);
    expect(floor).toBeLessThan(50_000);
  });

  it("is consistent with the position-count rule it is derived from", () => {
    const floor = minimumTradableCapital(IN);
    expect(maxViablePositions(floor, IN)).toBeGreaterThanOrEqual(100 / MAX_POSITION_PCT);
    expect(() => maxViablePositions(floor - 1_000, IN)).not.toThrow();
    expect(maxViablePositions(floor - 1_000, IN)).toBeLessThan(100 / MAX_POSITION_PCT);
  });
});

describe("the owner's declared capital", () => {
  it("is a stated figure the rest of the system can read", () => {
    expect(OWNER_CAPITAL.amount).toBeGreaterThan(0);
    expect(OWNER_CAPITAL.market).toBe("IN");
  });

  it("carries the date it was stated, because capital that grows makes a stale figure a lie", () => {
    expect(OWNER_CAPITAL.statedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
