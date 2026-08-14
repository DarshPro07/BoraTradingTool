import { getMarketPhase } from "@/lib/market/phases";
import type { Market } from "@/lib/market/types";

/**
 * Typed reasons — health semantics that survive rewording.
 *
 * ## Why the catch-block rule was not enough
 *
 * A7 v1 fixed the always-DEGRADED machine with a mechanical rule: a reason recorded from a catch
 * block is impairment, a reason recorded on a normal path is eligibility. That rule is immune to
 * rewording — and blind to every infrastructure failure that does not throw. A provider that
 * returns HTTP 200 with empty candles does not throw. A quant core that answers a structured
 * `{ reachable: false }` does not throw. A feed whose last tick is twelve minutes old does not
 * throw. Under the v1 rule, all of those read as a healthy machine with notes.
 *
 * A typed reason carries its own classification, so the DECISION (does this degrade the run?) is
 * made where the knowledge is (the site that observed the condition), not inferred from how the
 * message happened to be recorded. The catch-block rule survives as one PRODUCER of reasons —
 * every catch still yields INFRASTRUCTURE/DEGRADED — it is just no longer the only voice.
 *
 * Categories answer "what kind of fact is this":
 *   ELIGIBILITY     the machine is fine; the work is not ready (warm-up, no candidates, awaiting bars)
 *   DEPENDENCY      a prerequisite is missing and remediation is owned (see dependency-resolver)
 *   INFRASTRUCTURE  something this system depends on is impaired
 *
 * Severities answer "what should the supervisor do about it":
 *   INFO      nothing — normal operation
 *   WARNING   surface it; do not degrade the run
 *   DEGRADED  the run is DEGRADED while this holds
 *   FAILED    reserved for conditions that stop the run (nothing emits it yet; the scale exists
 *             so DEGRADED is not forced to mean two different things later)
 */

export type ReasonCategory = "ELIGIBILITY" | "DEPENDENCY" | "INFRASTRUCTURE";
export type ReasonSeverity = "INFO" | "WARNING" | "DEGRADED" | "FAILED";

export interface CycleReason {
  /** Stable machine-readable code, e.g. "QUANT_CORE_UNREACHABLE". Never derived from wording. */
  code: string;
  category: ReasonCategory;
  severity: ReasonSeverity;
  /** The human sentence — the same text that lands in the report's `skipped`/`impaired` lists. */
  message: string;
  /**
   * When this state can next change, for waiting-class reasons. Either an exact ISO instant
   * (derived from a minute delta, so DST-safe) or an exchange-local descriptor like
   * "2026-08-14 09:00 Asia/Kolkata" when only a zoned local time is knowable — a plainly-labelled
   * local time over a quietly-wrong UTC conversion, per the market clock's own doctrine.
   */
  resumeAt?: string;
  /** The same wake as an instant, for anything that schedules. Never derived from `resumeAt`'s text. */
  resumeAtMs?: number;
  /** The remediation that owns this gap, e.g. "ingest_history", for DEPENDENCY reasons. */
  dependency?: string;
  /** Which prerequisite kind blocks (DATA/TIME/PROVIDER/…), when the reason maps to the grammar. */
  dependencyType?: string;
  /** PERMANENT vs RETRYABLE, when the reason describes a terminal failure. */
  retryClass?: string;
  /** The instrument this reason is about, when it is about one. */
  instrument?: string;
  /** The durable job answering for this reason, when one exists. */
  jobId?: number;
}

/** The messages of every reason whose own classification degrades the run. */
export function degradingMessages(reasons: readonly CycleReason[]): string[] {
  return reasons
    .filter((reason) => reason.severity === "DEGRADED" || reason.severity === "FAILED")
    .map((reason) => reason.message);
}

/** Does any reason, on its own classification, degrade the run? */
export function degradesRun(reasons: readonly CycleReason[]): boolean {
  return degradingMessages(reasons).length > 0;
}

/**
 * A wake time carries its INSTANT and its DISPLAY separately, always.
 *
 * The lesson behind the split (owner directive after an independent-verification find): a
 * scheduler once min-selected wake times by comparing STRINGS, and `' '` < `'T'` let a same-day
 * exchange-local descriptor beat an earlier ISO instant. Local date-time strings carry no
 * timezone information and formats do not sort together — so scheduling and comparison use ONLY
 * `epochMs`, and the human/audit form rides beside it as presentation.
 */
export interface WakeInstant {
  /** The instant, for every comparison and schedule. The only field logic may consume. */
  epochMs: number;
  /** ISO instant or exchange-local descriptor — presentation and audit evidence, never compared. */
  display: string;
}

/**
 * The earliest moment new bars can exist that do not exist now — the eligibility clock for
 * waiting-class reasons (forecast awaiting bars, feature warm-up).
 *
 * Waiting states used to be re-checked blindly: "am I ready? am I ready?" every cycle with no
 * statement of when the answer could change. The Market Clock already knows: while a session is
 * running, the state can change at the next phase boundary (a daily bar settles at the close);
 * while the market is shut, nothing changes before the next session opens.
 */
export function nextBarWake(market: Market, at = new Date()): WakeInstant | null {
  const phase = getMarketPhase(market, at);
  if (phase.minutesToNextBoundary !== null) {
    // A minute delta from `at` is DST-safe by construction.
    const epochMs = at.getTime() + phase.minutesToNextBoundary * 60_000;
    return { epochMs, display: new Date(epochMs).toISOString() };
  }
  const next = phase.nextSessionOpen;
  if (!next) return null;
  const epochMs = zonedEpoch(next.date, next.localTime, phase.timezone);
  if (epochMs === null) return null;
  // The display keeps the plainly-right local form — the instant beside it is what schedules.
  return { epochMs, display: `${next.date} ${next.localTime} ${phase.timezone}` };
}

/** Display-only form of `nextBarWake`, for reasons that carry no schedule. */
export function nextBarOpportunity(market: Market, at = new Date()): string | null {
  return nextBarWake(market, at)?.display ?? null;
}

/**
 * A zone-local wall time as an epoch millisecond, through the zone's OWN rules via Intl:
 * guess the instant as if UTC, measure what wall-clock that guess shows in the zone, correct by
 * the difference. DST-correct because the zone database supplies the offset for THAT date —
 * exact everywhere except inside a DST transition hour itself, where no exchange opens.
 */
export function zonedEpoch(date: string, time: string, timeZone: string): number | null {
  const guess = Date.parse(`${date}T${time}:00Z`);
  if (!Number.isFinite(guess)) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(guess));
    const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
    // Intl can render midnight as "24" under hour12:false; normalize so Date.parse accepts it.
    const hour = read("hour") === "24" ? "00" : read("hour");
    const wallAsUtc = Date.parse(`${read("year")}-${read("month")}-${read("day")}T${hour}:${read("minute")}:00Z`);
    if (!Number.isFinite(wallAsUtc)) return null;
    return guess - (wallAsUtc - guess);
  } catch {
    // An unknown zone name yields no instant rather than a wrong one.
    return null;
  }
}
