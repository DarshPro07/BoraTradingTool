import { describe, expect, it } from "vitest";
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
  it("gives each its own family instead of failing the sweep", () => {
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
    const report = authorFromHypotheses("test");

    const families = getDb().select().from(schema.strategyFamilies).all();
    const names = families.map((family) => family.name);

    expect(report.outcomes.length).toBeGreaterThanOrEqual(2);
    expect(families.length).toBeGreaterThanOrEqual(2);
    // Distinct families, and distinct names — the UNIQUE constraint is satisfied by construction
    // rather than by luck.
    expect(new Set(names).size).toBe(names.length);
  });
});
