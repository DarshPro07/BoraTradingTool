/**
 * When a cloud clock run does what (docs/plans/cloud-clock).
 *
 * GitHub runs a scheduled workflow at most every 5 minutes and caps a job at 6 hours, while IN1
 * needs every minute from 09:14 to 15:39 IST. So a run started in the session window loops itself
 * for at most 5 h 25 min, and a queued run continues where it stopped. A run started outside the
 * window does the slim cycle once and exits.
 */
import { isPlausibleSessionDate } from "@/lib/market/session-calendar";

const IST_MS = 330 * 60_000;
/**
 * GitHub starts this repository's crons 2-2.6 hours late (2026-10-24..26: the 08:13 run had not begun
 * at 09:11), so the session starts from the first run after 03:30. An early run idles harmlessly:
 * IN1 returns before the session opens (lib/intraday/orb.ts:210).
 */
export const LOOP_FROM_IST_MINUTES = 3 * 60 + 30;
/** After IN1's window (15:39) and the 15:31 coverage step. */
export const LOOP_UNTIL_IST_MINUTES = 15 * 60 + 42;
/** Inside the 6-hour job limit, with room for setup and the final save. */
export const MAX_LOOP_MS = (5 * 60 + 25) * 60_000;

export const istParts = (at: Date) => {
  const ist = new Date(at.getTime() + IST_MS);
  return { day: ist.toISOString().slice(0, 10), minute: ist.getUTCHours() * 60 + ist.getUTCMinutes() };
};

/** Weekend special sessions (Muhurat) are closed for IN1 (EC-7). */
export const isSessionDay = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay() % 6 !== 0 && isPlausibleSessionDate(day);

/**
 * Hand-overs one lineage of runs may chain; a cron start begins a new lineage at 0. A lineage needs at
 * most three (a start at 03:30-03:44 ends before 09:10, then 09:10, then ~14:36), so four leaves one
 * spare. Past it a run queues none.
 */
export const MAX_HANDOVERS = 4;
export const nextChain = (chain: number): number | null => (chain < MAX_HANDOVERS ? chain + 1 : null);

/** handOver: the run stops at its cap before the close, so it must start its successor itself. */
export function clockPlan(start: Date): { mode: "session" | "once"; deadline: Date; handOver: boolean } {
  const { day, minute } = istParts(start);
  if (!isSessionDay(day) || minute < LOOP_FROM_IST_MINUTES || minute >= LOOP_UNTIL_IST_MINUTES) return { mode: "once", deadline: start, handOver: false };
  const close = Date.parse(`${day}T15:42:00+05:30`);
  // A run from before 09:10 hands over by then, outside 09:20-15:30: the session (6 h 20 min) is longer
  // than GitHub's 6-hour job, so one hand-over inside it is unavoidable, but never two.
  const preOpen = minute < 9 * 60 + 10 ? Date.parse(`${day}T09:10:00+05:30`) : Infinity;
  const deadline = Math.min(start.getTime() + MAX_LOOP_MS, preOpen, close);
  return { mode: "session", deadline: new Date(deadline), handOver: deadline < close };
}

/**
 * When the next minute pass runs (one second past the next minute), or null when that is past the
 * deadline: the run then hands over at once, right after its last pass. Idling to the deadline added
 * up to 60 s to the gap between runs, against coverage's 120 s rule (review 2026-10-24).
 */
export function nextPassAt(now: number, deadline: number): number | null {
  const next = (Math.floor(now / 60_000) + 1) * 60_000 + 1_000;
  return next <= deadline ? next : null;
}

/** Market hours, when a quote must be live: a stale one then means the data source stopped answering. */
export const inMarketHours = (at: Date) => {
  const { day, minute } = istParts(at);
  return isSessionDay(day) && minute >= 9 * 60 + 16 && minute <= 15 * 60 + 29;
};

/** After the session's coverage row (written by the 15:31 step, checked by the watchdog from 15:50): the day's record is complete. */
export const daySnapshotDue = (at: Date) => {
  const { day, minute } = istParts(at);
  return isSessionDay(day) && minute >= 15 * 60 + 50;
};
