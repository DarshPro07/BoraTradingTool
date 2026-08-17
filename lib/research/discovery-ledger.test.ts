import { describe, expect, it } from "vitest";
import { useTemporaryDatabase } from "@/lib/db/testing";
import {
  adjustFamily,
  allLooks,
  canPromote,
  countsTowardMultiplicity,
  programmeState,
  recordLook,
  twoSidedP,
  type DiscoveryLook,
} from "./discovery-ledger";

useTemporaryDatabase();

function look(over: Partial<DiscoveryLook> = {}): DiscoveryLook {
  return {
    probeId: "V01",
    hypothesisId: "V01",
    statisticId: "interaction",
    role: "PRIMARY_CONFIRMATORY",
    declaredBeforeRun: true,
    directionDeclared: "UNKNOWN",
    estimateBps: 114.1,
    hacT: 1.74,
    ci95Bps: [-15, 243],
    observations: 261,
    familyId: "foundry-2026",
    contractHash: "abc123",
    cohortFingerprint: "deep-358",
    dataRole: "DISCOVERY_DATA",
    observedAt: "2026-08-17",
    ...over,
  };
}

describe("what consumes selection budget", () => {
  it("counts every market statistic that could spawn a new hypothesis", () => {
    for (const role of ["PRIMARY_CONFIRMATORY", "SECONDARY_PREDECLARED", "DIAGNOSTIC", "POST_HOC_DISCOVERY"] as const) {
      expect(countsTowardMultiplicity(role)).toBe(true);
    }
  });

  it("does NOT count controls", () => {
    // A control's outcome is engineered in advance to validate the apparatus. Detecting a planted
    // effect gives no licence to believe a real one — and counting controls would penalise the
    // discipline that has caught three fixture defects.
    expect(countsTowardMultiplicity("CONTROL")).toBe(false);
  });

  it("counts a predeclared secondary — declaring seven looks does not make them free", () => {
    expect(countsTowardMultiplicity("SECONDARY_PREDECLARED")).toBe(true);
  });
});

describe("canPromote — the rule that must never bend", () => {
  it("refuses a post-hoc discovery regardless of its statistics", () => {
    // V01's negNormal cell came in at t = 3.01. No p-value repairs the fact that the hypothesis was
    // read off the same data it would be tested on.
    const spectacular = look({ role: "POST_HOC_DISCOVERY", hacT: 12, estimateBps: 900 });
    expect(canPromote(spectacular)).toBe(false);
  });

  it("refuses anything measured on discovery data, however well declared", () => {
    expect(canPromote(look({ role: "PRIMARY_CONFIRMATORY", declaredBeforeRun: true }))).toBe(false);
  });

  it("refuses a primary that was not declared before the run", () => {
    expect(
      canPromote(look({ dataRole: "INDEPENDENT_CONFIRMATION_DATA", declaredBeforeRun: false })),
    ).toBe(false);
  });

  it("permits only a predeclared primary on independent confirmation data", () => {
    expect(
      canPromote(look({ dataRole: "INDEPENDENT_CONFIRMATION_DATA", declaredBeforeRun: true })),
    ).toBe(true);
  });
});

describe("twoSidedP", () => {
  it("matches known normal tail values", () => {
    expect(twoSidedP(0)).toBeCloseTo(1, 3);
    expect(twoSidedP(1.96)).toBeCloseTo(0.05, 3);
    expect(twoSidedP(2.58)).toBeCloseTo(0.01, 3);
    expect(twoSidedP(3.01)).toBeCloseTo(0.0026, 3);
  });

  it("is symmetric in the sign of t", () => {
    expect(twoSidedP(-2.5)).toBeCloseTo(twoSidedP(2.5), 12);
  });
});

describe("adjustFamily", () => {
  it("applies Holm, which is uniformly no worse than Bonferroni", () => {
    // The V01 situation: one strong statistic among thirteen looks. Plain Bonferroni would multiply
    // by 13; Holm multiplies the smallest p by 13 too, but is less punitive further down.
    const family = [
      look({ statisticId: "negNormal", role: "SECONDARY_PREDECLARED", hacT: 3.01 }),
      ...Array.from({ length: 12 }, (_unused, i) =>
        look({ statisticId: `s${i}`, role: "SECONDARY_PREDECLARED", hacT: 0.5 + i * 0.1 }),
      ),
    ];
    const adjusted = adjustFamily(family);
    const strongest = adjusted.find((a) => a.statisticId === "negNormal")!;

    expect(strongest.rawP).toBeCloseTo(0.0026, 3);
    expect(strongest.holmP).toBeCloseTo(strongest.rawP * 13, 3);
    // Holm never reports a smaller adjusted p than the raw one.
    for (const a of adjusted) expect(a.holmP).toBeGreaterThanOrEqual(a.rawP - 1e-12);
  });

  it("keeps Holm monotone in the raw ordering", () => {
    const family = [3.5, 2.9, 1.2, 0.4].map((t, i) =>
      look({ statisticId: `s${i}`, role: "DIAGNOSTIC", hacT: t }),
    );
    const adjusted = adjustFamily(family);
    for (let i = 1; i < adjusted.length; i += 1) {
      expect(adjusted[i]!.holmP).toBeGreaterThanOrEqual(adjusted[i - 1]!.holmP);
    }
  });

  it("reports BH q-values that are never above the Holm values", () => {
    // BH controls a false-discovery rate rather than family-wise error, so it is less strict by
    // construction. It is for ranking leads, never for granting promotion.
    const family = [3.5, 2.9, 2.1, 1.2, 0.4].map((t, i) =>
      look({ statisticId: `s${i}`, role: "DIAGNOSTIC", hacT: t }),
    );
    for (const a of adjustFamily(family)) expect(a.bhQ).toBeLessThanOrEqual(a.holmP + 1e-12);
  });

  it("excludes controls from the multiplicity denominator", () => {
    const withControls = [
      look({ statisticId: "real", role: "SECONDARY_PREDECLARED", hacT: 3.01 }),
      ...Array.from({ length: 20 }, (_unused, i) =>
        look({ statisticId: `ctl${i}`, role: "CONTROL", hacT: 20 }),
      ),
    ];
    const adjusted = adjustFamily(withControls);
    expect(adjusted).toHaveLength(1);
    // m = 1, so Holm leaves the raw p untouched rather than multiplying by 21.
    expect(adjusted[0]!.holmP).toBeCloseTo(adjusted[0]!.rawP, 12);
  });

  it("returns nothing for a family of only controls", () => {
    expect(adjustFamily([look({ role: "CONTROL" })])).toEqual([]);
  });
});

describe("the ledger, end to end", () => {
  it("records looks and reports both counts separately", () => {
    // The two numbers that must always travel together. Reporting the first alone was true and
    // misleading: no permanent trial spent, thirteen chances taken.
    recordLook(look({ probeId: "M02", statisticId: "longShort" }));
    recordLook(look({ probeId: "M02", statisticId: "longOnly", role: "SECONDARY_PREDECLARED" }));
    recordLook(look({ probeId: "V01", statisticId: "negNormal", role: "SECONDARY_PREDECLARED", hacT: 3.01 }));
    recordLook(look({ probeId: "V01", statisticId: "control-null", role: "CONTROL" }));

    const state = programmeState();
    expect(state.registeredTrialCount).toBe(0);
    expect(state.probeDiscoveryLooks, "controls excluded").toBe(3);
    expect(state.controlsRun).toBe(1);
    expect(state.probes).toEqual(["M02", "V01"]);
  });

  it("filters by family", () => {
    recordLook(look({ probeId: "S01", statisticId: "other", familyId: "other-family" }));
    expect(allLooks("other-family")).toHaveLength(1);
    expect(allLooks("foundry-2026").every((l) => l.familyId === "foundry-2026")).toBe(true);
  });

  it("marks a non-promotable look as a limited decision in the audit trail", () => {
    // So the audit column reads correctly without anyone parsing the JSON detail.
    recordLook(look({ probeId: "X01", statisticId: "spread" }));
    const recorded = allLooks().find((l) => l.probeId === "X01");
    expect(recorded).toBeDefined();
    expect(canPromote(recorded!)).toBe(false);
  });
});
