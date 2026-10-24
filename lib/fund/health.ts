/**
 * The Fund OS watchdog (S6): is every autonomous layer actually running?
 *
 * Read-only. It reports and never repairs — `self-repair.ts` owns the narrow set of provable fixes.
 * Each check reads the ledger a layer writes, so "the badge says running" can never stand in for
 * "the work happened" (the lesson of the scheduled path that stayed dead while its units passed).
 */
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { CALENDAR_DERIVED_THROUGH } from "@/lib/market/nse-calendar-data";
import { isPlausibleSessionDate } from "@/lib/market/session-calendar";
import { latestExpectedSession } from "@/lib/market/universe-coverage";
import { ORB_CONTRACT, readOrb } from "@/lib/intraday/orb";

export interface HealthCheck {
  name: string;
  ok: boolean;
  detail: string;
}

const MIN = 60_000;

export function fundOsHealth(now = new Date()): HealthCheck[] {
  const db = getDb();
  const checks: HealthCheck[] = [];
  const age = (at: Date | undefined) => (at ? Math.round((now.getTime() - at.getTime()) / MIN) : null);

  // L3/L4 driver: the scheduled cycle. Cycles take up to ~15 min on a 15-min cadence.
  const cycle = db.select().from(schema.auditEvents).where(eq(schema.auditEvents.action, "learning_cycle")).orderBy(desc(schema.auditEvents.id)).limit(1).get();
  const cycleAge = age(cycle?.createdAt);
  checks.push({ name: "cycle", ok: cycleAge !== null && cycleAge <= 45, detail: cycleAge === null ? "no completed cycle on record" : `last completed ${cycleAge} min ago` });

  // L1/L2/L4: the agent conductor. A success within 6h, or the reason it has none.
  const lastOk = db.select().from(schema.agentRuns).where(and(eq(schema.agentRuns.trigger, "SCHEDULED"), eq(schema.agentRuns.status, "SUCCEEDED"))).orderBy(desc(schema.agentRuns.startedAt)).limit(1).get();
  const deferred = db.select({ n: sql<number>`count(*)` }).from(schema.auditEvents).where(and(eq(schema.auditEvents.action, "agent_pass_deferred"), gt(schema.auditEvents.createdAt, new Date(now.getTime() - 6 * 60 * MIN)))).get()?.n ?? 0;
  const agentAge = age(lastOk?.startedAt);
  checks.push({
    name: "agents",
    ok: agentAge !== null && agentAge <= 6 * 60,
    detail: `${agentAge === null ? "no successful agent run" : `last success ${agentAge} min ago (${lastOk!.capability} on ${lastOk!.model})`}; ${deferred} pass(es) deferred for memory in 6h`,
  });

  // L3 intraday: on a session day after 09:25 IST, today's first-candle decisions must exist.
  const ist = new Date(now.getTime() + 330 * MIN);
  const day = ist.toISOString().slice(0, 10);
  const minute = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  // readOrb goes through idx_audit_decision; the old filter scanned all of audit_events (EC-9).
  const session = isPlausibleSessionDate(day);
  if (session && minute >= 9 * 60 + 25) {
    const decided = readOrb("decision").filter((d) => d.day === day).length;
    checks.push({ name: "intraday", ok: decided >= ORB_CONTRACT.universe.length, detail: `${decided}/${ORB_CONTRACT.universe.length} first-candle decisions recorded today` });
  }

  // EC-13: outside the session window IN1 holds nothing. Shares here mean an exit and the square-off
  // both missed, or the square-off was not booked to IN1, and tomorrow would start with a carry.
  if (!session || minute >= 15 * 60 + 40) {
    const held = readOrb("execution").filter((e) => e.status === "FILLED").reduce((q, e) => q + (e.side === "BUY" ? e.quantity : -e.quantity), 0);
    checks.push({ name: "intraday-flat", ok: held <= 1e-9, detail: held <= 1e-9 ? "IN1 flat" : `IN1 holds ${held} share(s) after the close` });
  }

  // Research sees only sessions the calendar vouches for.
  const expected = latestExpectedSession(now.getTime());
  const lagDays = Math.round((Date.parse(expected) - Date.parse(CALENDAR_DERIVED_THROUGH)) / 86_400_000);
  checks.push({ name: "calendar", ok: lagDays <= 5, detail: `derived through ${CALENDAR_DERIVED_THROUGH}; latest session ${expected} (${lagDays} day(s) behind)` });

  // Data: share of NSE instruments holding the latest expected session. One aggregate query.
  const row = db.get<{ current: number; total: number }>(sql`
    SELECT sum(CASE WHEN date(last + 19800, 'unixepoch') >= ${expected} THEN 1 ELSE 0 END) AS current, count(*) AS total
    FROM (SELECT max(time) AS last FROM price_candles WHERE resolution = 'D' AND ticker LIKE 'IN:XNSE:%' GROUP BY ticker)`);
  const share = row && row.total > 0 ? row.current / row.total : 0;
  checks.push({ name: "data", ok: share >= 0.9, detail: `${row?.current ?? 0}/${row?.total ?? 0} NSE instruments hold the ${expected} session` });

  return checks;
}
