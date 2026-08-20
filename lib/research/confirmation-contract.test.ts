import { describe, expect, it } from "vitest";
import {
  admitForConfirmation,
  canConfirm,
  BURNED_FOR_DISCOVERY,
  V01_CONFIRM_001,
  V01_CONFIRM_001_HASH,
  shadowRecordCanPromote,
} from "./confirmation-contract";

/**
 * The line these tests defend: nothing that already taught the Foundry may later confirm it.
 *
 * Every case below is one that would look reasonable in the moment — a second vendor, a fresh
 * slice, an untouched date range — and each is refused for a reason that survives being wanted.
 */

const DISCOVERY_COHORT = "deep-358-recent-liquidity-selected";

describe("V01-CONFIRM-001 is frozen before its data exists", () => {
  it("hashes, and pins one primary statistic with no substitution", () => {
    expect(V01_CONFIRM_001_HASH).toMatch(/^[0-9a-f]{16}$/);
    expect(V01_CONFIRM_001.primaryStatistic).toBe("interaction");
    expect(V01_CONFIRM_001.secondarySubstitutionAllowed).toBe(false);
    expect(V01_CONFIRM_001.parameterChangesAllowed).toBe(false);
    expect(Object.isFrozen(V01_CONFIRM_001)).toBe(true);
  });

  it("fixes the direction under test rather than accepting either sign", () => {
    // V01 was registered direction-neutral because the literature disagreed. That question has now
    // been asked of this data and answered; a confirmation that would accept either sign would not
    // be testing the answer.
    expect(V01_CONFIRM_001.directionUnderTest).toBe("POSITIVE");
    expect(V01_CONFIRM_001.minimumEvidence.signMatchesDirectionUnderTest).toBe(true);
  });

  it("states minimum evidence as a conjunction, so no single number can carry it", () => {
    const e = V01_CONFIRM_001.minimumEvidence;
    expect(e.hacTAtLeast).toBe(2);
    expect(e.grossExceedsTwoLegCostBps).toBe(76);
    expect(e.minimumDecisionUnits).toBe(60);
    expect(e.signStableAcrossMeasuredEras).toBe(true);
  });
});

describe("a different provider is not independent evidence", () => {
  it("refuses source replication", () => {
    // An authenticated Upstox account supplying the same stocks over the same dates verifies the
    // DATA. The observations are the same realised market history.
    const verdict = admitForConfirmation(
      "upstox-authenticated-same-history",
      "SOURCE_REPLICATION",
      "2027-01-01",
      V01_CONFIRM_001.frozenAt,
    );
    expect(verdict.admitted).toBe(false);
    expect(verdict.reason).toMatch(/verifies the DATA, not the hypothesis/);
  });

  it("refuses weak cross-sectional replication on its own", () => {
    expect(canConfirm("WEAK_CROSS_SECTIONAL_REPLICATION")).toBe(false);
  });

  it("admits only prospective, genuinely independent observations", () => {
    expect(canConfirm("INDEPENDENT_ALPHA_CONFIRMATION")).toBe(true);
  });
});

describe("the discovery cohort is burned, permanently", () => {
  it("refuses the cohort that produced the hypothesis", () => {
    const verdict = admitForConfirmation(
      DISCOVERY_COHORT,
      "INDEPENDENT_ALPHA_CONFIRMATION",
      "2027-01-01",
      V01_CONFIRM_001.frozenAt,
    );
    expect(verdict.admitted).toBe(false);
    expect(verdict.reason).toMatch(/produced the hypothesis and cannot also test it/);
  });

  it("refuses it even when every other axis is impeccable", () => {
    // The trap: a later analyst re-slices the same cohort by date, calls the slice fresh, and the
    // arithmetic all looks right. Burned is burned.
    expect(BURNED_FOR_DISCOVERY.has(DISCOVERY_COHORT)).toBe(true);
    expect(
      admitForConfirmation(DISCOVERY_COHORT, "INDEPENDENT_ALPHA_CONFIRMATION", "2030-06-01", "2026-08-17")
        .admitted,
    ).toBe(false);
  });
});

describe("observations must postdate the freeze", () => {
  it("refuses data that already existed when the contract was written", () => {
    const verdict = admitForConfirmation(
      "some-other-cohort",
      "INDEPENDENT_ALPHA_CONFIRMATION",
      "2026-08-17",
      V01_CONFIRM_001.frozenAt,
    );
    expect(verdict.admitted).toBe(false);
    expect(verdict.reason).toMatch(/did not exist at discovery/);
  });

  it("admits prospective data on an unburned cohort", () => {
    const verdict = admitForConfirmation(
      "nse-prospective-2027",
      "INDEPENDENT_ALPHA_CONFIRMATION",
      "2026-09-01",
      V01_CONFIRM_001.frozenAt,
    );
    expect(verdict.admitted).toBe(true);
  });
});

describe("prospective recording is not forward validation", () => {
  const shadow = {
    kind: "PROSPECTIVE_SHADOW_RECORD",
    contractId: V01_CONFIRM_001.id,
    contractHash: V01_CONFIRM_001_HASH,
    decidedAt: "2026-08-18",
    inputsAtDecisionTime: { cohortSize: 60 },
    sourceAccessBasis: "UNCONFIRMED",
  } as const;

  it("refuses a shadow record even once the source becomes authorised", () => {
    // Chronology is what the shadow record preserves — a decision committed before its outcome
    // existed. That is real and valuable, and it is not evidence.
    expect(shadowRecordCanPromote(shadow)).toBe(false);
    expect(shadowRecordCanPromote({ ...shadow, sourceAccessBasis: "AUTHORISED" })).toBe(false);
  });

  it("refuses forward validation on an unconfirmed access basis", () => {
    expect(
      shadowRecordCanPromote({ ...shadow, kind: "FORWARD_VALIDATION", sourceAccessBasis: "UNCONFIRMED" }),
    ).toBe(false);
  });

  it("admits forward validation only when reconstructed against an authorised source", () => {
    expect(
      shadowRecordCanPromote({ ...shadow, kind: "FORWARD_VALIDATION", sourceAccessBasis: "AUTHORISED" }),
    ).toBe(true);
  });
});
