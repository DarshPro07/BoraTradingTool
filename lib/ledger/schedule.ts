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
/** Early enough that a run delayed by GitHub's queue still starts before the 09:20 decision. */
export const LOOP_FROM_IST_MINUTES = 8 * 60 + 10;
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

export function clockPlan(start: Date): { mode: "session" | "once"; deadline: Date } {
  const { day, minute } = istParts(start);
  if (!isSessionDay(day) || minute < LOOP_FROM_IST_MINUTES || minute >= LOOP_UNTIL_IST_MINUTES) return { mode: "once", deadline: start };
  const close = Date.parse(`${day}T15:42:00+05:30`);
  return { mode: "session", deadline: new Date(Math.min(start.getTime() + MAX_LOOP_MS, close)) };
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
