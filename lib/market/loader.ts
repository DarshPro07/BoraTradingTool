import { getDb, schema } from "@/lib/db";
import type { Candle } from "@/lib/providers/types";
import { contractAsOf, type InstrumentSnapshot } from "./contract-master";
import {
  assertDomainForPurpose,
  priceFrame,
  type LoadPurpose,
  type PriceDomain,
  type PriceFrame,
} from "./price-domain";

/**
 * The causal loader — one door every strategy goes through.
 *
 * ## Why it exists
 *
 * `price-domain.ts` and `contract-master.ts` were both built, tested and then imported by nothing,
 * while eight production modules kept reading `INSTRUMENT_CATALOG` and raw bars directly. A guard
 * nothing calls is documentation. This module is the seam that makes them bind, and it adds the
 * one control neither covers: the holdout boundary.
 *
 * ## Four gates, in order
 *
 *   1. **Domain** — the purpose must be servable by the requested price domain. Execution and
 *      reconciliation take `RAW_TRADED` only; returns refuse `CONTINUOUS_ADDITIVE`.
 *   2. **As-of** — no bar later than the simulated present, and the *source is not trusted* to
 *      have honoured that. If a provider or a parquet file hands back more than it was asked for,
 *      the leak stops here rather than downstream.
 *   3. **Universe** — the instrument must have existed and been observed by `asOf`. Point-in-time
 *      lot and tick size travel onto the frame, because pricing a 2024 trade with today's lot
 *      misstates every rupee of its P&L.
 *   4. **Holdout** — excluded by default, override requires a stated reason, every crossing is
 *      written to the audit trail.
 *
 * ## What it deliberately does not do
 *
 * It does not fetch. The bar source is a parameter, so this stays a policy layer over whatever
 * already supplies data — `fetchMarketSample`, stored candles, a future parquet reader — instead
 * of becoming a second data path beside the one that works.
 */

/**
 * The protected holdout, pinned rather than computed.
 *
 * A boundary derived from "today minus two years" slides every time it is read, which quietly
 * converts holdout into training data one day at a time — the exact failure the firewall exists to
 * prevent. It is a constant, and moving it is a deliberate, reviewable edit.
 */
export const HOLDOUT = Object.freeze({
  enabled: true,
  /** Everything at or after this instant is protected. */
  start: "2024-08-08T00:00:00.000Z",
  defaultAccess: "denied" as const,
  pinnedOn: "2026-08-08",
  reason: "Final two years of available history at the time of pinning.",
});

export type LoaderErrorCode = "HOLDOUT_REASON_REQUIRED" | "HOLDOUT_DISABLED";

export class LoaderError extends Error {
  constructor(
    readonly code: LoaderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LoaderError";
  }
}

export interface LoadedFrame extends PriceFrame {
  instrumentKey: string;
  /** Point-in-time, from the contract master — never today's value. */
  lotSize: number;
  tickSize: number;
}

export interface HoldoutAccess {
  reason: string;
  purpose: LoadPurpose;
  instruments: readonly string[];
  asOf: string;
  boundary: string;
}

/** Written to `audit_events`. A crossing nobody can find later is not a record. */
export function recordHoldoutAccess(access: HoldoutAccess): void {
  getDb()
    .insert(schema.auditEvents)
    .values({
      actor: "research_loader",
      action: "holdout_access",
      decision: "allowed",
      subject: access.instruments.join(","),
      detail: JSON.stringify(access),
      createdAt: new Date(),
    })
    .run();
}

export interface LoadRequest {
  instruments: readonly string[];
  start: Date;
  end: Date;
  purpose: LoadPurpose;
  priceDomain: PriceDomain;
  /** Dated instrument observations. The point-in-time universe is resolved from these. */
  snapshots: readonly InstrumentSnapshot[];
  /** Supplies bars for one instrument. Its output is validated, never trusted. */
  source: (instrumentKey: string) => readonly Candle[];
  /** Defaults to `end`. Nothing later than this is visible. */
  asOf?: Date;
  includeHoldout?: boolean;
  holdoutReason?: string;
  audit?: (access: HoldoutAccess) => void;
}

export interface LoadResult {
  frames: LoadedFrame[];
  purpose: LoadPurpose;
  asOf: Date;
  holdout: { boundary: string | null; included: boolean; reason: string | null };
  /** Why an instrument produced nothing. Deduplicated. */
  refusals: string[];
}

export function loadBars(request: LoadRequest): LoadResult {
  const {
    instruments,
    start,
    end,
    purpose,
    priceDomain,
    snapshots,
    source,
    includeHoldout = false,
    holdoutReason,
    audit = recordHoldoutAccess,
  } = request;

  // Gate 1 — domain. Checked before anything is read, so a wrong request costs no work and the
  // error names the mismatch rather than surfacing as a strange number later.
  assertDomainForPurpose(priceDomain, purpose);

  const asOf = request.asOf ?? end;

  // Gate 4a — the override contract, validated up front. A reason supplied after the data is in
  // hand is a justification, not a decision.
  if (includeHoldout) {
    if (!HOLDOUT.enabled) {
      throw new LoaderError("HOLDOUT_DISABLED", "The holdout is disabled; there is nothing to include.");
    }
    if (!holdoutReason || holdoutReason.trim().length === 0) {
      throw new LoaderError(
        "HOLDOUT_REASON_REQUIRED",
        "Including the holdout requires a stated reason. The ledger entry is the point: an access " +
          "with no recorded purpose cannot be distinguished later from an accident.",
      );
    }
  }

  const holdoutStart = HOLDOUT.enabled ? Date.parse(HOLDOUT.start) : Number.POSITIVE_INFINITY;
  const ceiling = includeHoldout ? asOf.getTime() : Math.min(asOf.getTime(), holdoutStart - 1);

  const frames: LoadedFrame[] = [];
  const refusals = new Set<string>();
  let crossed = false;

  for (const instrumentKey of instruments) {
    // Gate 3 — universe. Throws rather than returning nothing: "did not exist yet" and "did not
    // trade" are different facts and must not render alike.
    const contract = contractAsOf(snapshots, instrumentKey, asOf);

    const supplied = source(instrumentKey);
    // Gate 2 — as-of, applied to the supplier's output rather than assumed of it.
    const visible = supplied.filter(
      (bar) => bar.time * 1000 >= start.getTime() && bar.time * 1000 <= ceiling,
    );

    if (supplied.some((bar) => bar.time * 1000 >= holdoutStart && bar.time * 1000 <= asOf.getTime())) {
      crossed = includeHoldout;
    }

    if (visible.length === 0) {
      refusals.add(
        `${instrumentKey}: no bars in ${start.toISOString().slice(0, 10)}..${new Date(ceiling).toISOString().slice(0, 10)}.`,
      );
      continue;
    }

    frames.push({
      ...priceFrame(visible, priceDomain, { instrumentId: contract.instrumentKey }),
      instrumentKey: contract.instrumentKey,
      lotSize: contract.lotSize,
      tickSize: contract.tickSize,
    });
  }

  // Gate 4b — record the crossing, and only a real one. Logging every call would bury the handful
  // of entries that matter in a stream of ordinary loads.
  if (includeHoldout && crossed) {
    audit({
      reason: holdoutReason as string,
      purpose,
      instruments,
      asOf: asOf.toISOString(),
      boundary: HOLDOUT.start,
    });
  }

  return {
    frames,
    purpose,
    asOf,
    holdout: {
      boundary: HOLDOUT.enabled ? HOLDOUT.start : null,
      included: includeHoldout && crossed,
      reason: includeHoldout ? (holdoutReason ?? null) : null,
    },
    refusals: [...refusals],
  };
}
