/**
 * Remove daily bars for days the exchange was shut.
 *
 * The store held **6,435 such bars on four dates** — 1,972 instruments carried one for Muharram
 * (2026-06-26), 1,966 for Bakri Id, and over 1,200 each for Maharashtra Day and the Municipal
 * Corporation Election. All four are confirmed NSE-closed by the Upstox market-holidays API.
 *
 * These are not stale or imprecise bars. The exchange did not trade, so no such price exists; a
 * backtest reading them fills at a quote for a session that never happened, and a return series
 * gains a fabricated observation between two real ones.
 *
 * `persistCandles` now refuses them at the write funnel, but a write-time guard cannot reach what
 * is already stored. This does, and records the decision in `audit_events` so the removal is itself
 * evidence rather than an unexplained drop in row count.
 *
 * Usage:
 *   npx tsx scripts/purge-impossible-bars.mts            # report only
 *   npx tsx scripts/purge-impossible-bars.mts --apply    # delete and record
 */
import { sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { auditAgainstCalendar } from "@/lib/market/session-calendar";
import { CALENDAR_DERIVED_THROUGH } from "@/lib/market/nse-calendar-data";

const apply = process.argv.includes("--apply");
const db = getDb();

const rows = db
  .all<{ date: string; instruments: number }>(
    sql`SELECT date(time + 19800, 'unixepoch') AS date, count(*) AS instruments
        FROM price_candles WHERE resolution = 'D' GROUP BY date ORDER BY date`,
  )
  .map((r) => ({ date: r.date, instruments: Number(r.instruments) }));

const audit = auditAgainstCalendar(rows);

console.log(`Daily dates in store : ${rows.length}`);
console.log(`Calendar derived through: ${CALENDAR_DERIVED_THROUGH}`);
console.log(`Impossible dates     : ${audit.impossibleDates.length}`);
console.log(`Bars affected        : ${audit.barsAffected}\n`);

for (const row of audit.impossibleDates) {
  console.log(`  ${row.date}  ${String(row.instruments).padStart(6)} instruments`);
}

if (audit.impossibleDates.length === 0) {
  console.log("\nNothing to purge — every stored daily bar falls on a real session.");
  process.exit(0);
}

if (!apply) {
  console.log("\nReport only. Re-run with --apply to delete these bars.");
  process.exit(0);
}

const dates = audit.impossibleDates.map((r) => r.date);
const deleted = db.run(
  sql`DELETE FROM price_candles WHERE resolution = 'D'
      AND date(time + 19800, 'unixepoch') IN (${sql.join(dates.map((d) => sql`${d}`), sql`, `)})`,
).changes;

db.insert(schema.auditEvents)
  .values({
    actor: "purge-impossible-bars",
    action: "dataset_purge",
    decision: "allowed",
    subject: "price_candles:D",
    // The dates and counts are kept so the removal can be audited without re-deriving it.
    detail: JSON.stringify({
      reason: "NSE closed — bars for sessions that did not happen",
      calendarDerivedThrough: CALENDAR_DERIVED_THROUGH,
      dates: audit.impossibleDates,
      barsDeleted: deleted,
    }),
    createdAt: new Date(),
  })
  .run();

console.log(`\nDeleted ${deleted} bars and recorded the decision in audit_events.`);
