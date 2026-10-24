/**
 * EC-1 and EC-2 (PRD v2 §5.1): one log line for every run of the minute task, and one coverage row
 * per NSE session computed from those lines. A session with no evidence that the clock ran is
 * CENSORED, never silently absent: that is how 2026-10-23 12:07-15:30 (charger out, then a flat
 * battery) would otherwise have looked like a quiet afternoon.
 */
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { LeaseOutcome } from "@/lib/learning/lease";
import { isPlausibleSessionDate } from "@/lib/market/session-calendar";
import type { IntradayPass } from "./orb";

export type Coverage = "COVERED" | "PARTIAL" | "CENSORED";

/** The first session whose every run writes a line (S1.b go-live). Earlier days have no evidence either way. */
export const COVERAGE_FROM = "2026-10-26";

/** The log entry for one run. Always at least one line: a run that did nothing is the heartbeat. */
export function runLog(holder: string, at: Date, outcome: LeaseOutcome<IntradayPass[]>): string {
  const head = `[${holder}] ${at.toISOString()}`;
  if (!outcome.acquired) return `${head} skipped: ${outcome.blockedBy?.holder ?? "another run"} holds the intraday lease\n`;
  const result = outcome.result ?? [];
  // A minute whose every instrument failed did no clock work: an error, which is not a heartbeat
  // (review 2026-10-24: a dead feed otherwise read COVERED).
  const status = result.length > 0 && result.every((r) => r.action.startsWith("failed:")) ? "error: every instrument failed" : "ran";
  return [`${head} ${status}`, ...result.map((r) => `  ${r.instrumentId}: ${r.action}`)].join("\n") + "\n";
}

/** Heartbeat times (ms) from the log. An `error` line is a run that did not work, so it does not count. */
export function heartbeats(log: string): number[] {
  return [...log.matchAll(/^\[[^\]]+\] (\d{4}-\d\d-\d\dT[\d:.]+Z) (?:ran|skipped)/gm)].map((m) => Date.parse(m[1]!));
}

/** COVERED: no gap over 120 s within 09:20:00-15:30:00 IST. PARTIAL: some heartbeat, some gap. CENSORED: none. */
export function coverageFor(day: string, beats: readonly number[]): { coverage: Coverage; heartbeats: number; maxGapSeconds: number | null } {
  const from = Date.parse(`${day}T09:20:00+05:30`);
  const to = Date.parse(`${day}T15:30:00+05:30`);
  const inside = beats.filter((t) => t >= from && t <= to).sort((a, b) => a - b);
  if (inside.length === 0) return { coverage: "CENSORED", heartbeats: 0, maxGapSeconds: null };
  const edges = [from, ...inside, to];
  let gap = 0;
  for (let i = 1; i < edges.length; i += 1) gap = Math.max(gap, edges[i]! - edges[i - 1]!);
  const maxGapSeconds = Math.round(gap / 1000);
  return { coverage: maxGapSeconds <= 120 ? "COVERED" : "PARTIAL", heartbeats: inside.length, maxGapSeconds };
}

/**
 * The cycle's post-session step: one `session_coverage` audit row per session day from `from`
 * through the last closed session (today only from 15:31 IST). Idempotent by `coverage:<day>`.
 */
export function recordSessionCoverage(log: string, now = new Date(), from = COVERAGE_FROM): string[] {
  const ist = new Date(now.getTime() + 330 * 60_000);
  const closedToday = ist.getUTCHours() * 60 + ist.getUTCMinutes() >= 15 * 60 + 31;
  const last = new Date(Date.parse(ist.toISOString().slice(0, 10)) - (closedToday ? 0 : 86_400_000)).toISOString().slice(0, 10);
  const db = getDb();
  const done = new Set(
    db.select({ subject: schema.auditEvents.subject }).from(schema.auditEvents)
      .where(and(inArray(schema.auditEvents.decision, ["allowed"]), eq(schema.auditEvents.action, "session_coverage")))
      .all().map((r) => r.subject),
  );
  const beats = heartbeats(log);
  // A log with no heartbeat at all is a missing or replaced file, not evidence about any day.
  if (beats.length === 0) return [];
  const written: string[] = [];
  for (let t = Date.parse(from); t <= Date.parse(last); t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    const weekday = new Date(t).getUTCDay() % 6 !== 0;
    // Weekend special sessions (Muhurat) are closed for IN1 (EC-7).
    if (!weekday || !isPlausibleSessionDate(day) || done.has(`coverage:${day}`)) continue;
    const result = coverageFor(day, beats);
    db.insert(schema.auditEvents).values({
      actor: "intraday", action: "session_coverage", decision: "allowed", subject: `coverage:${day}`,
      detail: JSON.stringify({ day, ...result }), createdAt: now,
    }).run();
    written.push(`${day} ${result.coverage}`);
  }
  return written;
}
