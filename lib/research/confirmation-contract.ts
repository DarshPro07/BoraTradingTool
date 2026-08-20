/**
 * Confirmation contracts — frozen before the confirming data exists.
 *
 * ## Why this is written now, while there is nothing to run it on
 *
 * V01 was discovered, then re-analysed after an implementation bug was found, by an analyst who had
 * already seen the first result. Pre-registration only confers confirmatory value while analytic
 * choices stay independent of observed outcomes; once a rerun happens after results were seen, the
 * correction is legitimate and the *confirmatory status* is gone.
 *
 * The only way to get it back is to freeze the next test before its data exists. Writing this while
 * the cupboard is bare is the entire point — every field below was chosen with no ability to peek.
 *
 * ```
 * DISCOVERY                     2000-2026 cohort, 18 looks
 *   V01 discovered, corrected
 *   confirmation contract frozen and hashed
 * =====================================================
 *   NO INFORMATION CROSSES THIS LINE
 * =====================================================
 * CONFIRMATION                  data that took no part in the above
 *   confirm / reject
 * ```
 *
 * ## A different provider is NOT independent evidence
 *
 * The distinction that matters most here, and the easiest one to get wrong. If an authenticated
 * Upstox account later supplies the same stocks over the same dates, comparing it against the
 * existing candles is excellent **source replication** — it raises confidence that the numbers are
 * the numbers. It is still the *same realised market history*, so it cannot re-test a hypothesis
 * that history already produced.
 *
 * ```
 * different provider, same market observations   -> SOURCE_REPLICATION
 * market data that did not exist at discovery    -> INDEPENDENT_ALPHA_CONFIRMATION
 * ```
 *
 * Prospective data is the clean case. A never-touched historical cohort is weaker — same regimes,
 * same dates — and is admissible only if it demonstrably never influenced the Foundry.
 */
import { createHash } from "node:crypto";

/** What kind of independence a candidate confirmation dataset actually offers. */
export type EvidenceIndependence =
  | "SOURCE_REPLICATION"
  | "WEAK_CROSS_SECTIONAL_REPLICATION"
  | "INDEPENDENT_ALPHA_CONFIRMATION";

/** Where a result sits once exploration has touched it. */
export type ProbeStatus =
  | "INVALIDATED_BY_IMPLEMENTATION_BUG"
  | "EXPLORATORY_CORRECTED_REANALYSIS"
  | "REJECTED"
  | "AWAITING_INDEPENDENT_CONFIRMATION"
  | "PARKED";

/**
 * Only prospective data — or a cohort proven never to have influenced the Foundry — can confirm.
 *
 * Deliberately a function rather than a flag on the dataset, so the question "is this actually
 * independent?" has to be answered rather than inherited.
 */
export function canConfirm(independence: EvidenceIndependence): boolean {
  return independence === "INDEPENDENT_ALPHA_CONFIRMATION";
}

export const V01_CONFIRM_001 = Object.freeze({
  id: "V01-CONFIRM-001",
  origin: "V01r",
  originContractHash: "v01",
  status: "WAITING_FOR_INDEPENDENT_DATA" as const,

  // ---- everything below is frozen. Changing any of it makes a DIFFERENT contract. ----
  formationSessions: 5,
  volumeBaselineSessions: 20,
  holdingSessions: 21,
  rebalance: "MONTHLY" as const,
  extremeFraction: 0.20,
  volumeSplit: "COHORT_MEDIAN" as const,
  liquidityCohortPct: 0.30,
  liquidityLookbackSessions: 20,
  liquidityProxy: "MEDIAN_RUPEE_TRADED_VALUE" as const,
  costBpsPerLeg: 38,
  minCohortSize: 40,
  cohortConstruction: "TOP_30PCT_BY_MEDIAN_RUPEE_TRADED_VALUE_POINT_IN_TIME_ELIGIBLE" as const,
  decisionUnit: "ONE_OBSERVATION_PER_MONTHLY_REBALANCE" as const,
  inference: "NEWEY_WEST_HAC_BARTLETT_PLUS_STATIONARY_BLOCK_BOOTSTRAP" as const,

  /**
   * ONE statistic decides this. No cell may be substituted for it after the fact — that is exactly
   * how V01's negNormal became a post-hoc lead rather than a result.
   */
  primaryStatistic: "interaction" as const,
  secondarySubstitutionAllowed: false,

  /**
   * Direction is frozen from V01r rather than left open. V01 was registered direction-neutral
   * because the literature disagreed; that question has now been asked of this data and answered
   * +127 bps. A confirmation test that would accept either sign is not a test of that answer.
   */
  directionUnderTest: "POSITIVE" as const,

  /** Predeclared minimum evidence. Stated as a conjunction so no single number can carry it. */
  minimumEvidence: Object.freeze({
    hacTAtLeast: 2.0,
    signMatchesDirectionUnderTest: true,
    grossExceedsTwoLegCostBps: 76,
    minimumDecisionUnits: 60,
    signStableAcrossMeasuredEras: true,
  }),

  requiredIndependence: "INDEPENDENT_ALPHA_CONFIRMATION" as const,
  parameterChangesAllowed: false,
  frozenAt: "2026-08-17",
  note:
    "Frozen while no confirmation data existed, which is what makes it confirmatory. The 2000-2026 " +
    "358-name cohort is permanently DISCOVERY_DATA for V01 and may never satisfy this contract, " +
    "however it is re-sliced.",
});

export const V01_CONFIRM_001_HASH = createHash("sha256")
  .update(JSON.stringify(V01_CONFIRM_001))
  .digest("hex")
  .slice(0, 16);

/** Cohorts that have already taught the Foundry, and can therefore never confirm anything. */
export const BURNED_FOR_DISCOVERY: ReadonlySet<string> = new Set([
  "deep-358-recent-liquidity-selected",
]);

export interface ConfirmationAdmission {
  admitted: boolean;
  reason: string;
}

/**
 * May this dataset be used to run a confirmation contract?
 *
 * Fails closed on every axis: a burned cohort, insufficient independence, or a dataset whose
 * observations predate the discovery it would confirm.
 */
export function admitForConfirmation(
  cohortFingerprint: string,
  independence: EvidenceIndependence,
  observationsBeginAfter: string,
  discoveryFrozenAt: string,
): ConfirmationAdmission {
  if (BURNED_FOR_DISCOVERY.has(cohortFingerprint)) {
    return {
      admitted: false,
      reason:
        `${cohortFingerprint} is DISCOVERY_DATA: it produced the hypothesis and cannot also test ` +
        `it. Re-slicing it by date, sector or subset does not change that.`,
    };
  }
  if (!canConfirm(independence)) {
    return {
      admitted: false,
      reason:
        `${independence} is not confirmation. A second vendor reporting the same market history ` +
        `verifies the DATA, not the hypothesis — the observations are the same realised past.`,
    };
  }
  if (observationsBeginAfter <= discoveryFrozenAt) {
    return {
      admitted: false,
      reason:
        `Observations begin ${observationsBeginAfter}, at or before the contract was frozen ` +
        `(${discoveryFrozenAt}). Confirmation needs market data that did not exist at discovery.`,
    };
  }
  return { admitted: true, reason: "Prospective, independent, and on an unburned cohort." };
}

/**
 * Where every probe stands, in the vocabulary that distinguishes a bug from a rejection.
 *
 * The labels matter because "REJECTED" would flatten three different things: a hypothesis the data
 * refuted, a run whose implementation was wrong, and a re-analysis that is legitimate but no longer
 * confirmatory. A reader a year from now needs to tell them apart.
 */
export const PROBE_STATUS: Readonly<Record<string, { status: ProbeStatus; note: string }>> =
  Object.freeze({
    M02: {
      status: "REJECTED",
      note: "Factor spread negative before friction. Unaffected by the runner extraction — reproduces byte-for-byte.",
    },
    X01: {
      status: "INVALIDATED_BY_IMPLEMENTATION_BUG",
      note: "Original run measured liquidity over 22 formation sessions, not the 20 its contract declared.",
    },
    X01r: {
      status: "REJECTED",
      note: "Corrected re-analysis: spread 83.4 bps, t 1.87, sign still flips across eras, net ~7 bps.",
    },
    V01: {
      status: "INVALIDATED_BY_IMPLEMENTATION_BUG",
      note: "Original run paired each bar's volume with a different bar's close in the liquidity proxy.",
    },
    V01r: {
      status: "EXPLORATORY_CORRECTED_REANALYSIS",
      note: "Interaction 127.0 bps, t 2.12, sign stable 4/4. Corrected after results were seen, so not confirmatory.",
    },
    "V01-hypothesis": {
      status: "AWAITING_INDEPENDENT_CONFIRMATION",
      note: "Parked behind V01-CONFIRM-001. The 2000-2026 cohort is burned for it, permanently.",
    },
    H08: {
      status: "AWAITING_INDEPENDENT_CONFIRMATION",
      note: "Post-hoc lead from V01's negNormal cell. postHoc is immutable; only confirmationStatus may move.",
    },
    S01: {
      status: "REJECTED",
      note: "Spread 53.4 bps against 76 bps friction, t 1.65. Effect halves and loses significance once MAX-extreme names are removed.",
    },
  });

/**
 * Recording the future without pretending it validates anything yet.
 *
 * V01's confirmation needs market data that did not exist on 2026-08-17, and that clock only runs
 * forward. So recording prospectively from today is worth doing — every day not recorded is
 * confirmation data that cannot be bought back later.
 *
 * But a record made under an unconfirmed access basis is not evidence, and the two must not blur:
 *
 * ```
 * PROSPECTIVE_SHADOW_RECORD   timestamped decisions, inputs available at decision time,
 *                             no outcome attached yet.        canPromote = false, always.
 *
 * FORWARD_VALIDATION          the same decisions, later reconstructed against an AUTHORISED
 *                             source, with outcomes.          the only one that can bear evidence.
 * ```
 *
 * The chronology is what a shadow record preserves — that a decision was committed before its
 * outcome existed. That property is real and valuable and survives the rights question. What it
 * cannot do is confer validation rights the current access basis has not earned.
 */
export type ProspectiveRecordKind = "PROSPECTIVE_SHADOW_RECORD" | "FORWARD_VALIDATION";

export interface ProspectiveRecord {
  kind: ProspectiveRecordKind;
  contractId: string;
  contractHash: string;
  /** When the decision was committed — before any outcome existed. */
  decidedAt: string;
  /** The state the contract read, as it stood at decision time. */
  inputsAtDecisionTime: Readonly<Record<string, number | string>>;
  /** Deliberately absent on a shadow record. A record with an outcome is a different object. */
  outcome?: never;
  sourceAccessBasis: "UNCONFIRMED" | "AUTHORISED";
}

/**
 * A shadow record can never promote, and an authorised source is necessary but not sufficient.
 *
 * Necessary because evidence may not rest on an unconfirmed access basis; not sufficient because a
 * shadow record still carries no outcome — reconstruction against the authorised source is what
 * turns chronology into evidence.
 */
export function shadowRecordCanPromote(record: ProspectiveRecord): boolean {
  if (record.kind === "PROSPECTIVE_SHADOW_RECORD") return false;
  return record.sourceAccessBasis === "AUTHORISED";
}
