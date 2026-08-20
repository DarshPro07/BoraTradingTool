import { describe, expect, it } from "vitest";
import { assessPlausibility, type EconomicHypothesis } from "./hypothesis-foundry";
import {
  BUCKETING,
  CONFIG_BANK,
  EXPIRY_RULE,
  LABELS,
  LUCK_TEST,
  OMITTED_LABELS,
  PHASES,
  PRICE_REPRESENTATIONS,
  REQUIRED_DATA,
  SAMPLE_RULE,
  SESSION,
} from "./vix-day-character";

/**
 * The programme is encoded so the Foundry can refuse it for the RIGHT reason.
 *
 * A study nobody can run is not a failure — but "we discussed it and it needs data" is a note in a
 * conversation, while `REQUIRED_DATA_UNAVAILABLE` from the gate is a countable state that survives
 * the conversation ending.
 */

const V01_VIX_HYPOTHESIS: EconomicHypothesis = {
  id: "DC01",
  klass: "RETURN_VOLUME_REGIME",
  title: "NSE day-character study: does pre-10:00 state shift a bank of neutral intraday strategies?",
  mechanism:
    "Expected volatility known before the session begins changes the distribution of intraday " +
    "outcomes — range, follow-through, mean reversion — so strategies that are agnostic about " +
    "direction should still perform differently across volatility states.",
  counterpartyOrConstraint:
    "Nobody, in the usual sense, and that is the point. This is not a claim that someone leaves " +
    "money available; it asks whether a pre-known state changes the ODDS a generic strategy faces.",
  persistenceReason:
    "A conditioning effect on outcome distributions is not an arbitrage and need not be competed " +
    "away. Volatility regimes persist because volatility itself is persistent.",
  formationHorizon:
    "Everything known by 10:00 IST: prior close, prior session range, the open, calendar facts. " +
    "Nothing requiring the day's own close or range, which would be a label leak.",
  holdingHorizon:
    "Intraday. Entries after 09:15, flat by 15:35, inside the 09:15-15:40 NSE derivatives session.",
  expectedGrossEffectBps: 120,
  expectedAllInCostBps: 38,
  capacityConstraint:
    "NIFTY futures are among the most liquid instruments in India, so capacity is not the binding " +
    "constraint here — data availability is, which is unusual and worth saying plainly.",
  falsificationCondition:
    "No label shifts the strategy-bank outcome distribution beyond its own max-statistic " +
    "permutation null; or an effect that appears only under one block length; or one that survives " +
    "permutation but vanishes under the 10:00 truncation control, which would mark it as leakage.",
  evidenceBasis: "LITERATURE",
  sourceReferences: [
    "Indian evidence on NIFTY / India VIX high-frequency return-implied-volatility relationships, " +
      "asymmetric VIX response to negative equity shocks, and expiry-cycle regime dependence. " +
      "Establishes India VIX as a defensible conditioning variable — NOT that a tradeable effect exists.",
  ],
  priorDirection: "UNKNOWN",
  conditioning: "pre-10:00 IST day-character state on NIFTY futures",
  direction: "CROSS_SECTIONAL_SPREAD",
  requiredData: REQUIRED_DATA,
};

describe("the gate refuses DC01 for the right reason", () => {
  it("is REQUIRED_DATA_UNAVAILABLE, not a soft note in a document", () => {
    // The store holds NSE cash equities only: zero NIFTY futures, zero India VIX, zero BANKNIFTY,
    // and no futures/roll infrastructure at all.
    const available = new Set(["daily_close", "daily_volume"]);
    const verdict = assessPlausibility(V01_VIX_HYPOTHESIS, available);

    expect(verdict.admitted).toBe(false);
    expect(verdict.code).toBe("REQUIRED_DATA_UNAVAILABLE");
    expect(verdict.reason).toMatch(/nifty_futures_1m/);
    expect(verdict.reason).toMatch(/india_vix_daily/);
  });

  it("would be admitted on economics alone once the data exists", () => {
    // Worth separating: the idea is not blocked because it is weak. It clears the 2x friction
    // hurdle and answers all nine questions. Only the data is missing.
    const withData = new Set([...REQUIRED_DATA, "daily_close", "daily_volume"]);
    const verdict = assessPlausibility(V01_VIX_HYPOTHESIS, withData);

    expect(verdict.admitted).toBe(true);
    expect(verdict.code).toBe("PLAUSIBLE");
  });
});

describe("the NSE adaptation refuses to fake what it cannot measure", () => {
  it("omits the three US labels that have no honest NSE equivalent", () => {
    const omitted = OMITTED_LABELS.map((o) => o.id);
    expect(omitted).toContain("vix9d_over_vix");
    expect(omitted).toContain("vix_over_vix3m");
    expect(omitted).toContain("overnight_range_in_atr");
    // And none of them sneaks back in under a different name.
    for (const id of omitted) expect(LABELS.map((l) => l.id)).not.toContain(id);
  });

  it("records WHY each is omitted, so nobody re-adds it as a proxy later", () => {
    for (const o of OMITTED_LABELS) expect(o.reason.length).toBeGreaterThan(60);
  });

  it("ships 10 labels, not 14 — every extra label is paid for in multiplicity", () => {
    expect(LABELS).toHaveLength(10);
  });
});

describe("the traps this design is built around", () => {
  it("never infers expiry from the weekday", () => {
    // NSE moved expiry Thursday -> Tuesday for contracts expiring from September 2025. A weekday
    // rule would be silently wrong before that date and right after — the exact defect class this
    // repository keeps finding.
    expect(EXPIRY_RULE.inferFromWeekday).toBe(false);
    expect(EXPIRY_RULE.source).toBe("NSE_CONTRACT_METADATA");
  });

  it("never executes from a back-adjusted series", () => {
    expect(PRICE_REPRESENTATIONS.execution).toBe("UNADJUSTED_FRONT_CONTRACT");
    expect(PRICE_REPRESENTATIONS.features).toBe("BACK_ADJUSTED_CONTINUOUS");
  });

  it("freezes all day-character information at 10:00 IST, inside the real session", () => {
    expect(SESSION.informationCutoffIst).toBe("10:00");
    // Not the US design's 15:55 — NSE derivatives close at 15:40.
    expect(SESSION.flatByIst).toBe("15:35");
    expect(SESSION.closeIst).toBe("15:40");
    for (const label of LABELS) {
      expect(["10:00_IST", "PRIOR_CLOSE", "CALENDAR"]).toContain(label.knownBy);
    }
  });

  it("buckets on trailing quantiles, never the full sample", () => {
    expect(BUCKETING.fullSample).toBe(false);
    expect(BUCKETING.method).toBe("TRAILING_QUANTILES");
  });

  it("fixes the config bank before results exist", () => {
    // Otherwise "400 configs did not work, generate another 400" is uncounted search.
    expect(CONFIG_BANK.fingerprintBeforeResults).toBe(true);
    expect(CONFIG_BANK.directionBalanced).toBe(true);
  });

  it("corrects the luck test by max-statistic, not by pretending labels are independent", () => {
    expect(LUCK_TEST.method).toBe("BLOCK_PERMUTATION_WITH_MAX_STATISTIC");
    expect(LUCK_TEST.sensitivityBlocks).toContain(21);
    expect(LUCK_TEST.sensitivityBlocks).toContain(126);
    expect(LUCK_TEST.blockRationale.length).toBeGreaterThan(60);
  });

  it("leaves the minimum sample unset rather than importing a US number", () => {
    // Filter by sample size, never profitability — but choose the size for THIS instrument, and
    // choose it before looking at performance.
    expect(SAMPLE_RULE.minimumTradesWholeSample).toBeNull();
    expect(SAMPLE_RULE.chooseBeforeInspectingPerformance).toBe(true);
  });

  it("puts the dashboard last", () => {
    expect(PHASES.at(-1)).toMatch(/Dashboard/);
    expect(PHASES[0]).toMatch(/NIFTY futures only/);
  });
});
