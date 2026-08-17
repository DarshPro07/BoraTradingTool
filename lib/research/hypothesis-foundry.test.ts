import { describe, expect, it } from "vitest";
import {
  assessPlausibility,
  findPriorArt,
  semanticFingerprint,
  ILLIQUID_EFFECT_TO_COST_RATIO,
  MIN_EFFECT_TO_COST_RATIO,
  type EconomicHypothesis,
  type HypothesisRecord,
} from "./hypothesis-foundry";
import { INITIAL_HYPOTHESES, DELIVERY_COST_BPS } from "./hypothesis-classes";

const AVAILABLE = new Set(["daily_close", "daily_volume"]);

function hypothesis(over: Partial<EconomicHypothesis> = {}): EconomicHypothesis {
  return {
    id: "T01",
    klass: "LIQUIDITY_CONDITIONED_MOMENTUM",
    title: "test",
    mechanism: "Information diffuses gradually and past winners continue to outperform.",
    counterpartyOrConstraint: "Investors adjusting positions gradually under mandate constraints.",
    persistenceReason: "Arbitrage requires surviving correlated momentum crashes lasting quarters.",
    formationHorizon: "Three months of past returns, the documented diffusion window.",
    holdingHorizon: "One month, inside the one-to-six-month persistence the evidence reports.",
    expectedGrossEffectBps: 120,
    expectedAllInCostBps: DELIVERY_COST_BPS,
    capacityConstraint: "Capped at a small fraction of 20-day median traded value per name.",
    falsificationCondition: "No positive gross spread across independent eras kills the idea.",
    evidenceBasis: "LITERATURE",
    sourceReferences: ["Indian momentum/liquidity evidence, 2023"],
    conditioning: "top liquidity cohort by 20-day median traded value",
    direction: "CROSS_SECTIONAL_SPREAD",
    requiredData: ["daily_close", "daily_volume"],
    ...over,
  };
}

describe("assessPlausibility — the gate runs on the prior, never on a result", () => {
  it("admits an idea that answers all nine questions and clears its friction", () => {
    const verdict = assessPlausibility(hypothesis(), AVAILABLE);
    expect(verdict.admitted).toBe(true);
    expect(verdict.code).toBe("PLAUSIBLE");
    expect(verdict.actualRatio).toBeCloseTo(120 / 38, 4);
  });

  it("refuses an idea whose expected effect cannot clear twice its own cost", () => {
    // The point of gating on the PRIOR: an idea can be true, publishable, and still not worth a
    // permanent statistical trial because the mechanism does not predict enough to pay for itself.
    const verdict = assessPlausibility(
      hypothesis({ expectedGrossEffectBps: DELIVERY_COST_BPS * 1.5 }),
      AVAILABLE,
    );
    expect(verdict.admitted).toBe(false);
    expect(verdict.code).toBe("EFFECT_BELOW_COST_HURDLE");
    expect(verdict.requiredRatio).toBe(MIN_EFFECT_TO_COST_RATIO);
    expect(verdict.reason).toMatch(/may be true and still not worth a trial/);
  });

  it("raises the hurdle to 3x when the conditioning is illiquid", () => {
    // Illiquid effects look larger in a backtest and cost far more to trade. Without the higher
    // hurdle the Foundry would reliably discover beautiful untradeable strategies.
    const liquid = assessPlausibility(hypothesis({ expectedGrossEffectBps: 90 }), AVAILABLE);
    const illiquid = assessPlausibility(
      hypothesis({
        expectedGrossEffectBps: 90,
        conditioning: "bottom liquidity quintile by 20-day median traded value (illiquid)",
      }),
      AVAILABLE,
    );

    expect(liquid.admitted, "90 bps clears 2x of 38").toBe(true);
    expect(illiquid.admitted, "the same 90 bps does not clear 3x").toBe(false);
    expect(illiquid.requiredRatio).toBe(ILLIQUID_EFFECT_TO_COST_RATIO);
  });

  it.each([
    ["mechanism", "NO_MECHANISM"],
    ["counterpartyOrConstraint", "NO_COUNTERPARTY"],
    ["persistenceReason", "NO_PERSISTENCE_REASON"],
    ["capacityConstraint", "NO_CAPACITY_CONSTRAINT"],
    ["falsificationCondition", "NO_FALSIFICATION_CONDITION"],
  ] as const)("refuses an idea with no %s", (field, code) => {
    const verdict = assessPlausibility(hypothesis({ [field]: "" }), AVAILABLE);
    expect(verdict.admitted).toBe(false);
    expect(verdict.code).toBe(code);
  });

  it("treats a placeholder as an unanswered question, not an answer", () => {
    // "TBD" in a required field is how a nine-field gate becomes a five-field gate.
    for (const filler of ["TBD", "unknown", "n/a — figure this out later"]) {
      expect(assessPlausibility(hypothesis({ persistenceReason: filler }), AVAILABLE).admitted).toBe(
        false,
      );
    }
  });

  it("refuses an idea needing data this deployment does not hold", () => {
    // Missing is not zero. An earnings-drift hypothesis must be refused for want of data, not
    // quietly run against price bars and reported as a null result.
    const verdict = assessPlausibility(
      hypothesis({ requiredData: ["daily_close", "earnings_announcements"] }),
      AVAILABLE,
    );
    expect(verdict.admitted).toBe(false);
    expect(verdict.code).toBe("REQUIRED_DATA_UNAVAILABLE");
    expect(verdict.reason).toMatch(/earnings_announcements/);
  });
});

describe("semanticFingerprint — identity over economics, not wording", () => {
  it("gives the same identity to the same idea described differently", () => {
    // The failure this prevents: an agent regenerates a rejected idea under new prose and it
    // enters the queue as novel.
    const original = semanticFingerprint({
      klass: "LIQUIDITY_CONDITIONED_MOMENTUM",
      conditioning: "top liquidity cohort by 20-day median traded value",
      direction: "CROSS_SECTIONAL_SPREAD",
      formationHorizon: "Three months of past returns",
      holdingHorizon: "One month",
    });
    const reworded = semanticFingerprint({
      klass: "LIQUIDITY_CONDITIONED_MOMENTUM",
      conditioning: "Top   liquidity cohort, by the 20 day median traded value!",
      direction: "CROSS_SECTIONAL_SPREAD",
      formationHorizon: "three months of the past returns",
      holdingHorizon: "one   MONTH",
    });
    expect(reworded).toBe(original);
  });

  it("separates ideas that differ economically", () => {
    const base = {
      klass: "LIQUIDITY_CONDITIONED_MOMENTUM",
      conditioning: "top liquidity cohort",
      direction: "CROSS_SECTIONAL_SPREAD",
      formationHorizon: "three months",
      holdingHorizon: "one month",
    } as const;

    // A different formation window is a different claim about how long information takes to
    // diffuse — not a reparameterisation.
    expect(semanticFingerprint({ ...base, formationHorizon: "six months" })).not.toBe(
      semanticFingerprint(base),
    );
    expect(semanticFingerprint({ ...base, conditioning: "bottom liquidity quintile" })).not.toBe(
      semanticFingerprint(base),
    );
    expect(semanticFingerprint({ ...base, direction: "LONG_LOSERS" })).not.toBe(
      semanticFingerprint(base),
    );
  });
});

describe("findPriorArt — remembering why ideas died", () => {
  const rejected: HypothesisRecord[] = [
    {
      id: "M02",
      fingerprint: semanticFingerprint({
        klass: "LIQUIDITY_CONDITIONED_MOMENTUM",
        conditioning: "top liquidity cohort",
        direction: "CROSS_SECTIONAL_SPREAD",
        formationHorizon: "six months",
        holdingHorizon: "one month",
      }),
      klass: "LIQUIDITY_CONDITIONED_MOMENTUM",
      stage: "RESEARCH_PROBE",
      rejectionReason: "NO_GROSS_EDGE",
      note: "gross spread was negative across both eras",
    },
  ];

  it("recognises a rejected idea returning under different wording", () => {
    const art = findPriorArt(
      {
        klass: "LIQUIDITY_CONDITIONED_MOMENTUM",
        conditioning: "the top liquidity cohort",
        direction: "CROSS_SECTIONAL_SPREAD",
        formationHorizon: "Six  months!",
        holdingHorizon: "One month",
      },
      rejected,
    );

    expect(art.status).toBe("PREVIOUSLY_REJECTED");
    expect(art.rejectionReason).toBe("NO_GROSS_EDGE");
    expect(art.relatedIds).toEqual(["M02"]);
  });

  it("surfaces a related hypothesis rather than calling a near-neighbour novel", () => {
    // 3m/1m is genuinely a different claim from 6m/1m, but a reader deciding whether to spend on
    // it should see that the sibling already failed.
    const art = findPriorArt(
      {
        klass: "LIQUIDITY_CONDITIONED_MOMENTUM",
        conditioning: "top liquidity cohort",
        direction: "CROSS_SECTIONAL_SPREAD",
        formationHorizon: "three months",
        holdingHorizon: "one month",
      },
      rejected,
    );
    expect(art.status).toBe("RELATED_EXISTING_HYPOTHESIS");
    expect(art.relatedIds).toContain("M02");
  });

  it("reports NEVER_TESTED only when nothing in the class exists", () => {
    const art = findPriorArt(
      {
        klass: "RETURN_VOLUME_REGIME",
        conditioning: "abnormal 5-day volume",
        direction: "LONG_WINNERS",
        formationHorizon: "five days",
        holdingHorizon: "one month",
      },
      rejected,
    );
    expect(art.status).toBe("NEVER_TESTED");
    expect(art.relatedIds).toEqual([]);
  });
});

describe("the initial six classes", () => {
  it("every hypothesis answers all nine questions", () => {
    for (const h of INITIAL_HYPOTHESES) {
      const verdict = assessPlausibility(h, AVAILABLE);
      expect(
        ["PLAUSIBLE", "EFFECT_BELOW_COST_HURDLE"],
        `${h.id} failed on a missing field, not on economics: ${verdict.code}`,
      ).toContain(verdict.code);
    }
  });

  it("R01 is refused by the illiquidity hurdle it was written against", () => {
    // Written deliberately below 3x. The mechanism is real and the economics are not, and the
    // gate must say so rather than the class file picking a number that passes.
    const r01 = INITIAL_HYPOTHESES.find((h) => h.id === "R01")!;
    const verdict = assessPlausibility(r01, AVAILABLE);

    expect(verdict.admitted).toBe(false);
    expect(verdict.code).toBe("EFFECT_BELOW_COST_HURDLE");
    expect(verdict.requiredRatio).toBe(ILLIQUID_EFFECT_TO_COST_RATIO);
  });

  it("gives every hypothesis a distinct economic identity", () => {
    const fingerprints = INITIAL_HYPOTHESES.map((h) => semanticFingerprint(h));
    expect(new Set(fingerprints).size).toBe(INITIAL_HYPOTHESES.length);
  });

  it("carries a source reference for every LITERATURE claim", () => {
    // An idea whose prior rests on published evidence must name it, or the evidence basis is a
    // label rather than a citation.
    for (const h of INITIAL_HYPOTHESES) {
      if (h.evidenceBasis === "LITERATURE") expect(h.sourceReferences.length).toBeGreaterThan(0);
    }
  });
});
