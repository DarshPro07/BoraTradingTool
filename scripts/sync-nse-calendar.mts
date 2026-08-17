/**
 * Regenerate `lib/market/nse-calendar-data.ts` — the NSE trading calendar.
 *
 * ## Why the calendar is generated rather than written
 *
 * The store held **6,435 daily bars on four days the NSE was closed**; 1,972 instruments carried a
 * bar for Muharram (2026-06-26) alone. A weekday-only rule cannot see that. Nor can a hand-curated
 * exception list be trusted: an earlier guard in this repository asserted "NSE has no Sunday
 * session" and silently deleted real Muhurat trading.
 *
 * ## Two sources, each covering what the other cannot
 *
 * 1. **Derived from price data.** The instruments backfilled from Upstox span 2000-01-03 onward. A
 *    weekday on which not one of them traded is a day the exchange was shut. This is the only
 *    source reaching back to 2000 — the holidays API holds no record before roughly 2023.
 * 2. **The Upstox market-holidays API**, authoritative for the current year, which supplies dates
 *    beyond where price data yet exists (six 2026 holidays the data could not know).
 *
 * Where both speak they agree: on a 29-date sample, 5 confirmed NSE-closed and **0 contradictions**.
 *
 * A date is only called a holiday if the reference instruments are deep enough to have an opinion,
 * so `MIN_REFERENCE` guards against declaring a holiday from an empty universe.
 *
 * Usage:  npx tsx scripts/sync-nse-calendar.mts [--min-bars 750]
 */
import fs from "node:fs";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";

const MIN_BARS = Number(process.argv[process.argv.indexOf("--min-bars") + 1]) || 750;
/** Below this, "no reference instrument traded" means nothing about the exchange. */
const MIN_REFERENCE = 10;
const OUT = "lib/market/nse-calendar-data.ts";

const db = getDb();

const reference = db
  .all<{ ticker: string }>(
    sql`SELECT ticker FROM price_candles WHERE resolution = 'D'
        GROUP BY ticker HAVING count(*) >= ${MIN_BARS}`,
  )
  .map((r) => r.ticker);

if (reference.length < MIN_REFERENCE) {
  console.error(
    `Only ${reference.length} instruments have >= ${MIN_BARS} daily bars. A calendar derived from ` +
      `fewer than ${MIN_REFERENCE} would assert holidays it cannot know. Backfill first.`,
  );
  process.exit(2);
}

const sessions = db
  .all<{ d: string }>(
    sql`SELECT DISTINCT date(time + 19800, 'unixepoch') AS d FROM price_candles
        WHERE resolution = 'D' AND ticker IN (${sql.join(reference.map((t) => sql`${t}`), sql`, `)})
        ORDER BY d`,
  )
  .map((r) => r.d);

const sessionSet = new Set(sessions);
const first = sessions[0]!;
const last = sessions.at(-1)!;

// getUTCDay() is Sun=0 .. Sat=6, so the weekend is 0 and 6 — NOT ">= 5", which would select
// Friday. The first version of this script did exactly that and claimed 1,306 weekend sessions.
const isWeekend = (iso: string) => {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
};

// Every weekday inside the covered span on which no reference instrument traded.
const holidays: string[] = [];
for (const cursor = new Date(`${first}T00:00:00Z`); cursor <= new Date(`${last}T00:00:00Z`); ) {
  const iso = cursor.toISOString().slice(0, 10);
  const day = cursor.getUTCDay();
  if (day !== 0 && day !== 6 && !sessionSet.has(iso)) holidays.push(iso);
  cursor.setUTCDate(cursor.getUTCDate() + 1);
}
const weekendSessions = sessions.filter(isWeekend);

// The API extends the calendar past where price data reaches.
interface Holiday {
  date: string;
  description: string;
  closed_exchanges?: string[];
  open_exchanges?: { exchange: string }[];
}
const apiAdded: string[] = [];
const apiDeclared: string[] = [];
try {
  const response = await fetch("https://api.upstox.com/v2/market/holidays", {
    headers: { Accept: "application/json", "User-Agent": "MarketPulse/1.0 (research)" },
  });
  const payload = (await response.json()) as { data?: Holiday[] };
  for (const entry of payload.data ?? []) {
    if ((entry.closed_exchanges ?? []).includes("NSE")) {
      // Declared by the exchange's own API, whatever the price data does or does not show.
      apiDeclared.push(entry.date);
      if (!holidays.includes(entry.date)) {
        holidays.push(entry.date);
        apiAdded.push(entry.date);
      }
    }
    const special = (entry.open_exchanges ?? []).some((e) => e.exchange === "NSE");
    if (special) apiDeclared.push(entry.date);
    if (special && isWeekend(entry.date) && !weekendSessions.includes(entry.date)) {
      weekendSessions.push(entry.date);
    }
  }
} catch (error) {
  // The derived calendar is still valid without it; only the forward window is short. Say so
  // rather than writing a file that quietly covers less than the last one did.
  console.warn(`Holidays API unavailable (${(error as Error).message}). Derived dates only.`);
}
holidays.sort();
weekendSessions.sort();
apiDeclared.sort();

const list = (dates: string[]) => dates.map((d) => `  "${d}",`).join("\n");
fs.writeFileSync(
  OUT,
  `/**
 * The NSE trading calendar — GENERATED. Do not edit by hand.
 *
 * Regenerate with \`npx tsx scripts/sync-nse-calendar.mts\`, which documents the two sources and
 * why neither alone is sufficient.
 *
 * Derived from ${reference.length} instruments spanning ${first}..${last} (${sessions.length} real sessions),
 * extended by the Upstox market-holidays API.
 */

/** Weekdays the NSE was closed. */
export const NSE_TRADING_HOLIDAYS: ReadonlySet<string> = new Set([
${list(holidays)}
]);

/** Weekend days the NSE really did trade — Muhurat sessions and Union Budget Saturdays. */
export const NSE_WEEKEND_SESSIONS: ReadonlySet<string> = new Set([
${list(weekendSessions)}
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
${list(apiDeclared)}
]);

/** The calendar is derived from data up to here; past it, only the holidays API has spoken. */
export const CALENDAR_DERIVED_THROUGH = "${last}";
`,
  "utf8",
);

console.log(`${OUT} written`);
console.log(`  reference instruments : ${reference.length} (>= ${MIN_BARS} bars)`);
console.log(`  sessions              : ${sessions.length}  ${first}..${last}`);
console.log(`  trading holidays      : ${holidays.length} (${apiAdded.length} from the API alone)`);
console.log(`  weekend sessions      : ${weekendSessions.length}`);
