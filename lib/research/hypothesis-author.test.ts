import { describe, expect, it } from "vitest";
import { fixtureResolver } from "./syntax/fixtures";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { getDb, schema } from "@/lib/db";
import { recordHypothesis } from "@/lib/knowledge/repository";
import { authorFromHypotheses } from "./hypothesis-author";

useTemporaryDatabase();

/**
 * Two hypotheses can legitimately share a title.
 *
 * The research bridge names a proposal after what it is about — "IN:XNSE:NIFTYBEES — LONG SWING"
 * — so researching the same instrument twice produces two DIFFERENT hypotheses (different
 * statements, different content hashes) with the SAME title. The family guard checked the family
 * ID, which is derived per hypothesis and therefore never collided, while the database's UNIQUE
 * constraint is on (campaign, NAME), which does. The authoring sweep died with a 500 and took the
 * whole hand-off with it.
 *
 * One family per hypothesis is the deliberate design — "the hypothesis IS the family" — and it is
 * what keeps the multiple-testing denominator honest. So the fix makes the NAME unique per
 * hypothesis rather than merging two distinct economic claims into one family.
 */
describe("authoring survives two hypotheses that share a title", () => {
  it("gives each its own family instead of failing the sweep", async () => {
    const first = recordHypothesis({
      title: "IN:XNSE:NIFTYBEES — LONG SWING",
      statement: "Enter when rsi_14 is above 55 on the daily close, exiting on a close below sma_20.",
      market: "NSE",
      createdBy: "test",
    });
    const second = recordHypothesis({
      title: "IN:XNSE:NIFTYBEES — LONG SWING",
      statement: "Enter when rsi_14 is above 60 on the daily close, exiting after five sessions.",
      market: "NSE",
      createdBy: "test",
    });

    expect(second).not.toBe(first);

    // The sweep must not throw. Before the fix this raised
    // SQLITE_CONSTRAINT_UNIQUE: strategy_families.research_campaign_id, strategy_families.name
    const report = await authorFromHypotheses("test", new Date(), fixtureResolver());

    const families = getDb().select().from(schema.strategyFamilies).all();
    const names = families.map((family) => family.name);

    expect(report.outcomes.length).toBeGreaterThanOrEqual(2);
    expect(families.length).toBeGreaterThanOrEqual(2);
    // Distinct families, and distinct names — the UNIQUE constraint is satisfied by construction
    // rather than by luck.
    expect(new Set(names).size).toBe(names.length);
  });
});

/**
 * The spec is born on the product the capital basis says it can trade.
 *
 * `breedingBasis()` at the owner's stated capital resolves the product (INTRADAY at a small
 * account — the ₹23,000 delivery floor), and `selectTrialCandidates`' `tradable_at_capital`
 * guard enforces exactly that against the RESOLUTION the spec declares. The author set neither:
 * `universe.resolution` defaulted to "D", which implies DELIVERY, so every autonomously
 * authored strategy was permanently refused a trial by a field the author never wrote — the
 * funnel read 10 rehearsed, 0 eligible, forever.
 */
describe("authored specs are tradable at the capital they were bred for", () => {
  it("declares a resolution whose implied product matches the breeding basis", async () => {
    const { breedingBasis } = await import("@/lib/paper/capital");
    const { isIntradayResolution } = await import("@/lib/strategy/dsl");
    const basis = breedingBasis();

    // The fixture parser knows only its canned clauses — reuse the exact pair the suite already
    // parses successfully.
    recordHypothesis({
      title: "IN:XNSE:NIFTYBEES — LONG SWING",
      statement: "Enter when rsi_14 is above 55 on the daily close, exiting on a close below sma_20.",
      market: "NSE",
      createdBy: "test",
    });

    const report = await authorFromHypotheses("test", new Date(), fixtureResolver());
    const authored = report.outcomes.filter((outcome) => outcome.verdict === "EXPRESSIBLE");
    expect(authored.length).toBeGreaterThanOrEqual(1);

    const specs = getDb().select().from(schema.strategySpecs).all();
    expect(specs.length).toBeGreaterThanOrEqual(1);

    for (const spec of specs) {
      const dsl = JSON.parse(spec.dsl) as {
        universe: { resolution?: string };
        costs: { assumedSpreadBps?: number };
      };
      const intraday = isIntradayResolution(dsl.universe.resolution);
      if (basis.product === "INTRADAY") {
        expect(
          intraday,
          `basis says INTRADAY but the authored spec resolves "${dsl.universe.resolution ?? "D"}" — ` +
            "the tradable_at_capital guard will refuse it forever",
        ).toBe(true);
        // The schema refuses intraday without a DECLARED spread; the author must state one.
        expect(dsl.costs.assumedSpreadBps).toBeGreaterThan(0);
      } else {
        expect(intraday).toBe(false);
      }
    }
  });
});
