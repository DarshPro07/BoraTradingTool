/**
 * The NSE calendar extends itself from price data, one session at a time, and fails CLOSED.
 *
 * ## Why this exists
 *
 * `verifySessionDate` calls every weekday after `CALENDAR_DERIVED_THROUGH` unverified, and the
 * research snapshot withholds those bars. Rehearsal, the gauntlet, forward shadow and paper all
 * read through that snapshot. So when the manual sync script was not run, research went blind to
 * every new session. It did so from 2026-08-14 for five weeks, starving the forward-evidence clock
 * this system depends on.
 *
 * ## Why it is not just the sync script on a timer
 *
 * The script also calls the unauthenticated Upstox holidays API, and the owner stopped
 * unauthenticated Upstox use on 2026-08-17. This path is derived-only: no network.
 *
 * It judges only dates after the current derived-through date and never rewrites the past.
 * Existing holidays, weekend sessions and exchange-declared dates are kept, and only ever added to.
 *
 * ## Failing closed
 *
 * A date wrongly recorded as a holiday makes the write guard reject that session's real bars.
 * That is data loss. A date left unverified costs only time. So every ambiguity stops the extension,
 * and the stop reason is surfaced in the cycle report for a human to resolve with the full sync.
 */
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { databasePath, getDb } from "@/lib/db";
import {
  CALENDAR_DERIVED_THROUGH,
  EXCHANGE_DECLARED_DATES,
  NSE_TRADING_HOLIDAYS,
  NSE_WEEKEND_SESSIONS,
} from "./nse-calendar-data";
import { sessionOpenEpoch } from "./session-calendar";
import { latestExpectedSession } from "./universe-coverage";

/** An instrument needs this much history to have an opinion about the exchange. Same as the script. */
export const REFERENCE_MIN_BARS = 750;
/** Below this many observers, "nobody traded" means nothing. Same as the script. */
export const MIN_REFERENCE = 10;
/** Share of observers that must agree before a date is vouched for. */
export const QUORUM = 0.5;

export const CALENDAR_FILE = "lib/market/nse-calendar-data.ts";

export interface CalendarState {
  holidays: readonly string[];
  weekendSessions: readonly string[];
  declared: readonly string[];
  derivedThrough: string;
  provenance: string;
}

export interface ExtensionJudgement {
  derivedThrough: string;
  addedHolidays: string[];
  addedWeekendSessions: string[];
  /** The first date that could not be judged, when an anomaly (not the data frontier) stopped it. */
  stoppedAt: string | null;
  stopReason: string | null;
}

const nextDay = (iso: string) => {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

/**
 * Walk forward from `derivedThrough`, judging each date from the reference instruments that were
 * observed across it. Pure: the store is read by the caller.
 */
export function judgeCalendarExtension(input: {
  derivedThrough: string;
  holidays: ReadonlySet<string>;
  weekendSessions: ReadonlySet<string>;
  /** IST date of each reference instrument's newest daily bar. */
  referenceLastDates: readonly string[];
  /** Reference instruments holding a bar on each date after `derivedThrough`. */
  participation: ReadonlyMap<string, number>;
}): ExtensionJudgement {
  const judgement: ExtensionJudgement = {
    derivedThrough: input.derivedThrough,
    addedHolidays: [],
    addedWeekendSessions: [],
    stoppedAt: null,
    stopReason: null,
  };
  const reference = input.referenceLastDates.length;
  const observersNeeded = Math.max(MIN_REFERENCE, Math.ceil(QUORUM * reference));
  const stop = (date: string, reason: string) => {
    judgement.stoppedAt = date;
    judgement.stopReason = reason;
    return judgement;
  };

  // ponytail: O(days x reference) scan; a few hundred days x a few thousand names at most.
  for (let date = nextDay(input.derivedThrough), guard = 0; guard < 400; date = nextDay(date), guard += 1) {
    const covering = input.referenceLastDates.filter((last) => last >= date).length;
    // The data frontier: too few instruments observed through this date yet. Normal, not an anomaly.
    if (covering < observersNeeded) return judgement;

    const traded = input.participation.get(date) ?? 0;
    const share = traded / covering;
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    const weekend = day === 0 || day === 6;
    const seen = `${traded} of ${covering} observed reference instruments traded ${date}`;

    if (input.holidays.has(date)) {
      if (traded > 0) return stop(date, `${seen}, which the calendar records as a holiday — the two contradict`);
    } else if (weekend) {
      if (share >= QUORUM) {
        if (!input.weekendSessions.has(date)) judgement.addedWeekendSessions.push(date);
      } else if (traded > 0 || input.weekendSessions.has(date)) {
        return stop(date, `${seen} on a weekend — ambiguous`);
      }
    } else if (share < QUORUM) {
      if (traded > 0) return stop(date, `${seen} — ambiguous, neither a session nor a closure`);
      judgement.addedHolidays.push(date);
    }
    judgement.derivedThrough = date;
  }
  return judgement;
}

export function renderCalendarFile(state: CalendarState): string {
  const list = (dates: readonly string[]) => [...dates].sort().map((d) => `  "${d}",`).join("\n");
  return `/**
 * The NSE trading calendar — GENERATED. Do not edit by hand.
 *
 * Regenerate with \`npx tsx scripts/sync-nse-calendar.mts\`, which documents the two sources and
 * why neither alone is sufficient. Extended session by session, derived-only, by
 * \`lib/market/calendar-extension.ts\` in the scheduled cycle.
 *
 * ${state.provenance}
 */

/** Weekdays the NSE was closed. */
export const NSE_TRADING_HOLIDAYS: ReadonlySet<string> = new Set([
${list(state.holidays)}
]);

/** Weekend days the NSE really did trade — Muhurat sessions and Union Budget Saturdays. */
export const NSE_WEEKEND_SESSIONS: ReadonlySet<string> = new Set([
${list(state.weekendSessions)}
]);

/**
 * Dates the EXCHANGE ITSELF declared, via the Upstox market-holidays API.
 *
 * Everything not listed here carries the weaker authority \`PRICE_CONSENSUS_DERIVED\`: inferred
 * from hundreds of instruments agreeing, which is a good inference and still an inference. A 2004
 * date deduced from price observations must not claim the same standing as a 2026 date the
 * exchange published.
 */
export const EXCHANGE_DECLARED_DATES: ReadonlySet<string> = new Set([
${list(state.declared)}
]);

/** The calendar is derived from data up to here; past it, only the holidays API has spoken. */
export const CALENDAR_DERIVED_THROUGH = "${state.derivedThrough}";
`;
}

/**
 * Extend the on-disk calendar from the canonical store. Takes effect for the next process that
 * loads it: the scheduled cycle re-bundles every run, and a Next.js server on its next restart.
 */
export function extendDerivedCalendar(nowMs = Date.now()): { advanced: boolean; summary: string } {
  // A scratch or test database must never rewrite the canonical calendar.
  if (databasePath() !== path.resolve(process.cwd(), "marketpulse.db")) {
    return { advanced: false, summary: "Calendar extension skipped: not the canonical store." };
  }
  if (latestExpectedSession(nowMs) <= CALENDAR_DERIVED_THROUGH) {
    return { advanced: false, summary: `Calendar current through ${CALENDAR_DERIVED_THROUGH}.` };
  }

  const db = getDb();
  const reference = sql`SELECT ticker FROM price_candles WHERE resolution = 'D' AND ticker LIKE 'IN:XNSE:%'
                        GROUP BY ticker HAVING count(*) >= ${REFERENCE_MIN_BARS}`;
  const referenceLastDates = db
    .all<{ last: string }>(
      sql`SELECT date(max(time) + 19800, 'unixepoch') AS last FROM price_candles
          WHERE resolution = 'D' AND ticker IN (${reference}) GROUP BY ticker`,
    )
    .map((row) => row.last);
  const participation = new Map(
    db
      .all<{ d: string; n: number }>(
        sql`SELECT date(time + 19800, 'unixepoch') AS d, count(DISTINCT ticker) AS n FROM price_candles
            WHERE resolution = 'D' AND time > ${sessionOpenEpoch(CALENDAR_DERIVED_THROUGH)}
              AND ticker IN (${reference}) GROUP BY d`,
      )
      .map((row) => [row.d, Number(row.n)] as const),
  );

  const judgement = judgeCalendarExtension({
    derivedThrough: CALENDAR_DERIVED_THROUGH,
    holidays: NSE_TRADING_HOLIDAYS,
    weekendSessions: NSE_WEEKEND_SESSIONS,
    referenceLastDates,
    participation,
  });
  const anomaly = judgement.stopReason
    ? ` Stopped at ${judgement.stoppedAt}: ${judgement.stopReason}. Resolve with scripts/sync-nse-calendar.mts.`
    : "";

  if (judgement.derivedThrough === CALENDAR_DERIVED_THROUGH) {
    return {
      advanced: false,
      summary: `Calendar held at ${CALENDAR_DERIVED_THROUGH}: too few of ${referenceLastDates.length} reference instruments observed past it.${anomaly}`,
    };
  }

  const file = path.resolve(process.cwd(), CALENDAR_FILE);
  // Keep where the base calendar came from; only the extension line is replaced each time.
  const base = /\* (Derived from [\s\S]*?\.)\n/.exec(fs.readFileSync(file, "utf8"))?.[1];
  fs.writeFileSync(
    file,
    renderCalendarFile({
      holidays: [...NSE_TRADING_HOLIDAYS, ...judgement.addedHolidays],
      weekendSessions: [...NSE_WEEKEND_SESSIONS, ...judgement.addedWeekendSessions],
      declared: [...EXCHANGE_DECLARED_DATES],
      derivedThrough: judgement.derivedThrough,
      provenance:
        `${base ? `${base}\n * ` : ""}Extended to ${judgement.derivedThrough} from ${referenceLastDates.length} ` +
        `reference instruments (>= ${REFERENCE_MIN_BARS} bars, quorum ${QUORUM}), no network.`,
    }),
    "utf8",
  );
  const added = judgement.addedHolidays.length ? ` New holidays: ${judgement.addedHolidays.join(", ")}.` : "";
  return {
    advanced: true,
    summary: `Calendar extended ${CALENDAR_DERIVED_THROUGH} -> ${judgement.derivedThrough}.${added}${anomaly}`,
  };
}
