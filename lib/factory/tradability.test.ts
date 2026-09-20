import { describe, expect, it } from "vitest";
import { breedingBasis, OWNER_CAPITAL, maxViablePositions, liveBasis } from "@/lib/paper/capital";
import { compileStrategy, isIntradayResolution } from "@/lib/strategy/dsl";
import { breedGeneration } from "./breed";

/**
 * The factory must not breed candidates its own guard will refuse.
 *
 * ## The deadlock this guards
 *
 * `baseDsl` asked `costsForCapital` for INTRADAY costs — because intraday is all ₹1,000 can trade —
 * and then omitted `resolution` from `universe`, so the schema defaulted it to `"D"`. Every bred
 * candidate was *priced* as intraday and *shaped* as delivery.
 *
 * `auto-gauntlet`'s `tradable_at_capital` guard reads the product implied by the resolution, saw
 * DELIVERY, and refused. Observed on a real cycle, every strategy in the registry:
 *
 * ```
 * sma_cross_20_50   eligible=false  failing: tradable_at_capital
 * f1_gen_*  (×5)    eligible=false  failing: ..., tradable_at_capital
 * ```
 *
 * Nothing could ever reach `validated`, so nothing reached paper forward, so nothing reached owner
 * review, so the trade board was empty **by construction**. Two modules disagreed about which
 * product the owner trades and neither could see the other.
 *
 * This is the highest-severity class in this repository: no exception, no failing test, no wrong
 * number — just a system that quietly cannot succeed.
 */

describe("bred candidates are tradable at the owner's capital", () => {
  it("breeds at a resolution the capital's product implies", () => {
    const basis = breedingBasis();
    const report = breedGeneration({
      parents: [],
      buriedIdentities: new Set(),
      livingIdentities: new Set(),
      size: 8,
      generation: 1,
      seed: 11,
    });

    expect(report.candidates.length).toBeGreaterThan(0);

    for (const candidate of report.candidates) {
      const impliedProduct = isIntradayResolution(candidate.dsl.universe.resolution)
        ? "INTRADAY"
        : "DELIVERY";
      // The exact question `tradable_at_capital` asks: can the breeding book afford a position in
      // the product this candidate implies? Equality was the old test, and it was wrong in both
      // directions -- it refused a daily candidate while the basis said INTRADAY, and once training
      // moved to 25,000 it would have refused every intraday candidate the live book needs.
      expect(
        maxViablePositions(basis.capital, { market: OWNER_CAPITAL.market, product: impliedProduct }),
        `${candidate.dsl.name} implies ${impliedProduct}, unaffordable at ${basis.capital}`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it("declares a spread whenever it breeds intraday, or the schema refuses the spec", () => {
    const basis = breedingBasis();
    const report = breedGeneration({
      parents: [],
      buriedIdentities: new Set(),
      livingIdentities: new Set(),
      size: 8,
      generation: 2,
      seed: 12,
    });

    // The premise this test depends on: SOMETHING here can trade intraday. Training at 25,000
    // cannot, but the owner's real 5,000 can trade nothing else -- and the factory breeds for both.
    expect(liveBasis().product).toBe("INTRADAY");
    const intradayBred = report.candidates.filter((candidate) =>
      isIntradayResolution(candidate.dsl.universe.resolution),
    );
    expect(intradayBred.length, "the live book's lane must still be fed").toBeGreaterThan(0);
    for (const candidate of intradayBred) {
      expect(candidate.dsl.costs.assumedSpreadBps).toBeGreaterThan(0);
    }
    expect(basis.product).toBe("DELIVERY"); // the training book, stated so a change is visible
  });

  it("omits afterDays on intraday specs, because it counts bars rather than days", () => {
    // At 5-minute resolution `afterDays: 12` means an hour while reading as a fortnight. A
    // generated spec must not carry a unit trap nobody chose; the broker's square-off closes it.
    const report = breedGeneration({
      parents: [],
      buriedIdentities: new Set(),
      livingIdentities: new Set(),
      size: 8,
      generation: 3,
      seed: 13,
    });

    for (const candidate of report.candidates) {
      if (!isIntradayResolution(candidate.dsl.universe.resolution)) continue;
      expect(candidate.dsl.exit.afterDays).toBeUndefined();
      // It must still close somehow, or the schema would have refused it.
      expect(candidate.dsl.exit.stopLossPct).toBeGreaterThan(0);
    }
  });

  it("every bred candidate still compiles", () => {
    // The breeder already refuses uncompilable candidates; asserted here because the intraday
    // branch added two new ways to produce an invalid spec (missing spread, no exit).
    const report = breedGeneration({
      parents: [],
      buriedIdentities: new Set(),
      livingIdentities: new Set(),
      size: 10,
      generation: 4,
      seed: 14,
    });

    expect(report.candidates.length).toBeGreaterThan(0);
    for (const candidate of report.candidates) {
      expect(compileStrategy(candidate.dsl).ok).toBe(true);
    }
  });
});
