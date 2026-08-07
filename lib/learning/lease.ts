import fs from "node:fs";
import path from "node:path";
import { databasePath } from "@/lib/db";

/**
 * One cycle at a time, across every driver.
 *
 * Three things can start a learning cycle: the Windows Task Scheduler (`scripts/cycle.mjs`),
 * a long-running daemon (`scripts/daemon.mjs`), and an open browser tab (`SystemPulse` →
 * `/api/learning/cycle`). Each is useful — the scheduler survives a reboot, the daemon is
 * convenient during development, the tab reacts to the operator stepping away — but all three
 * drain the same research queue against the same database.
 *
 * Two drivers running at once is not hypothetical. It already happened: `AutonomyTicker` was
 * added alongside the existing `SystemPulse` without reading what was there, and the result was
 * twenty-one cycles in a day racing each other through one queue.
 *
 * ## Why a lock file rather than a table
 *
 * A single-row table with a conditional `UPDATE` would be the textbook answer, and SQLite would
 * make it atomic. But `migrateDatabase` reads a hardcoded `MIGRATIONS` array in `lib/db/migrate.ts`,
 * which is owner-reviewed — a new `drizzle/*.sql` file would sit there unread. `open(…, "wx")` is
 * atomic on both Windows and POSIX and needs no schema change at all.
 *
 * ## Why it expires
 *
 * A holder that crashes never releases. Rather than a cleanup path that must itself be correct,
 * the lease simply goes stale: past the TTL any driver may take it. That converts "recover from a
 * crash" into "wait", which has no failure mode of its own.
 */

/**
 * Long enough that a genuinely slow cycle is never interrupted — the first cycle of a session
 * measured 10.1s, and a cold candle fetch across twelve instruments is the slow path.
 *
 * ponytail: a cycle that hangs past this (a socket with no timeout) will have its lease taken
 * while it is still running. The cost is one duplicated read-only cycle, not corruption. Add a
 * mid-cycle heartbeat only if that is ever actually observed.
 */
export const LEASE_TTL_MS = 10 * 60_000;

export interface LeaseHolder {
  holder: string;
  acquiredAt: number;
}

export interface LeaseOutcome<T> {
  acquired: boolean;
  /** Present when the lease was refused: who was holding it, and since when. */
  blockedBy: LeaseHolder | null;
  result: T | null;
}

/** Beside the database, so an isolated test database gets an isolated lease for free. */
export function leasePath(databaseFile = databasePath()): string {
  return `${databaseFile}.cycle-lease`;
}

function readHolder(file: string): LeaseHolder | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Partial<LeaseHolder>;
    if (typeof record.holder !== "string" || typeof record.acquiredAt !== "number") return null;
    return { holder: record.holder, acquiredAt: record.acquiredAt };
  } catch {
    // A truncated or unparseable lease is treated as expired below rather than trusted. A lease
    // nobody can read is not evidence that somebody holds it.
    return null;
  }
}

/**
 * Take the lease, or report who has it.
 *
 * `wx` is the whole mutex: it creates the file only if it does not exist, atomically. Removing a
 * stale file is garbage collection, not locking — two drivers that both decide a lease is stale
 * will both unlink, but only one can then win the `wx`, and the other is refused.
 */
export function acquireLease(
  holder: string,
  file = leasePath(),
  now = Date.now(),
  ttlMs = LEASE_TTL_MS,
): LeaseHolder | null {
  const record: LeaseHolder = { holder, acquiredAt: now };
  const payload = JSON.stringify(record);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const handle = fs.openSync(file, "wx");
      try {
        fs.writeFileSync(handle, payload, "utf8");
      } finally {
        fs.closeSync(handle);
      }
      return record;
    } catch (caught) {
      if ((caught as NodeJS.ErrnoException).code !== "EEXIST") throw caught;
    }

    const current = readHolder(file);
    // An unreadable lease has no acquisition time, so it cannot be shown to be live. Treating it
    // as held forever would wedge autonomy permanently on one corrupt write.
    const expired = current === null || now - current.acquiredAt >= ttlMs;
    if (!expired) return null;

    try {
      fs.rmSync(file, { force: true });
    } catch {
      // Another driver removed it first, which is the outcome we wanted anyway.
    }
  }

  return null;
}

/** Release only if still ours. A driver whose lease expired must not delete its successor's. */
export function releaseLease(holder: string, acquiredAt: number, file = leasePath()): void {
  const current = readHolder(file);
  if (current === null || current.holder !== holder || current.acquiredAt !== acquiredAt) return;
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // Failing to release leaves a lease that expires on its own. Not worth failing the cycle for.
  }
}

/** Who holds it right now, for display. Null when free or expired. */
export function currentLease(file = leasePath(), now = Date.now(), ttlMs = LEASE_TTL_MS): LeaseHolder | null {
  const current = readHolder(file);
  if (current === null || now - current.acquiredAt >= ttlMs) return null;
  return current;
}

export async function withCycleLease<T>(
  holder: string,
  run: () => Promise<T>,
  file = leasePath(),
): Promise<LeaseOutcome<T>> {
  const lease = acquireLease(holder, file);
  if (lease === null) {
    return { acquired: false, blockedBy: currentLease(file), result: null };
  }
  try {
    return { acquired: true, blockedBy: null, result: await run() };
  } finally {
    releaseLease(lease.holder, lease.acquiredAt, file);
  }
}
