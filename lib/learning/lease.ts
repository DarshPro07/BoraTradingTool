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
 * A live cycle renews the lease on a heartbeat (`withCycleLease`), so the TTL now bounds only how
 * long a CRASHED holder blocks others. Observed 2026-09-19: a cycle ran 14.8 minutes, and without
 * the heartbeat another driver could take the lease mid-cycle.
 */
export const LEASE_TTL_MS = 10 * 60_000;

/**
 * The heartbeat stops after this long, so a hung-but-alive driver loses the lease within
 * MAX_CYCLE_MS + LEASE_TTL_MS instead of holding it forever. Well above the slowest cycle observed.
 */
export const MAX_CYCLE_MS = 45 * 60_000;

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

/**
 * The RESEARCH lane's lease — a DIFFERENT file, and that is the entire point.
 *
 * One lease file means one lane. While every driver shared `leasePath()`, the research worker
 * could only ever run as a phase inside the learning cycle, because the cycle held the only lease
 * for its whole duration. That is what made AUTO strictly sequential: not an accident of
 * scheduling, but a mutex that admitted one lane at a time.
 *
 * A separate file lets OBSERVE/LEARN (the cycle) and RESEARCH (the queue worker) hold their own
 * mutexes and overlap in wall-clock time, while each remains singly-held — so the original defect
 * this lock was written for (twenty-one cycles racing through one queue) still cannot recur, and
 * neither can two workers draining the queue twice.
 *
 * Concurrency across the two lanes is safe at the storage layer: SQLite runs in WAL mode with a
 * 5s busy_timeout (lib/db/index.ts), and `claimNextJob` takes each job inside a transaction with
 * a `lockedUntil` lease, so a job can never be claimed twice.
 */
export function researchLeasePath(databaseFile = databasePath()): string {
  return `${databaseFile}.research-lease`;
}

function fileMtime(file: string): number {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0; // gone: nothing holds it
  }
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
    // An unreadable lease is judged by the file's own age. Young, it is almost certainly a holder
    // caught between `wx` creating it and the write landing — treating that as expired handed the
    // lease to a second driver. Old, it is a corrupt write, and waiting out the TTL un-wedges it.
    const expired = current === null ? now - fileMtime(file) >= ttlMs : now - current.acquiredAt >= ttlMs;
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

/**
 * Extend a lease we still hold. Returns the new stamp, or null when it is no longer ours.
 *
 * Written to a temporary file and renamed over the lease: a reader that caught a half-written
 * lease would parse nothing, treat it as expired, and take it — the exact steal this prevents.
 */
export function renewLease(holder: string, acquiredAt: number, file = leasePath(), now = Date.now()): number | null {
  const current = readHolder(file);
  if (current === null || current.holder !== holder || current.acquiredAt !== acquiredAt) return null;
  const temporary = `${file}.${process.pid}.renew`;
  fs.writeFileSync(temporary, JSON.stringify({ holder, acquiredAt: now }), "utf8");
  fs.renameSync(temporary, file);
  return now;
}

/**
 * Run under the cycle lease, renewing it while the run is in flight.
 *
 * Without renewal the lease is only as long as `LEASE_TTL_MS`, and on 2026-09-19 a scheduled cycle
 * took 14.8 minutes against a 10-minute TTL: any other driver (the in-app supervisor polls every
 * minute) could take the "expired" lease and run a second cycle alongside the first. A heartbeat
 * keeps the TTL as crash recovery — a dead driver stops renewing — without capping cycle length.
 */
export async function withCycleLease<T>(
  holder: string,
  run: () => Promise<T>,
  file = leasePath(),
  // Every user of one lease file must pass the same ttlMs: expiry is judged by the reader.
  { ttlMs = LEASE_TTL_MS, heartbeatMs = ttlMs / 3, maxCycleMs = MAX_CYCLE_MS }: { ttlMs?: number; heartbeatMs?: number; maxCycleMs?: number } = {},
): Promise<LeaseOutcome<T>> {
  const lease = acquireLease(holder, file, Date.now(), ttlMs);
  if (lease === null) {
    return { acquired: false, blockedBy: currentLease(file, Date.now(), ttlMs), result: null };
  }
  let stamp = lease.acquiredAt;
  const heartbeat = setInterval(() => {
    if (Date.now() - lease.acquiredAt >= maxCycleMs) {
      clearInterval(heartbeat); // hung: let the TTL hand the lease on
      return;
    }
    try {
      stamp = renewLease(holder, stamp, file) ?? stamp;
    } catch {
      // A failed renewal leaves the old stamp, which still expires on its own schedule.
    }
  }, heartbeatMs);
  heartbeat.unref?.();
  try {
    return { acquired: true, blockedBy: null, result: await run() };
  } finally {
    clearInterval(heartbeat);
    releaseLease(lease.holder, stamp, file);
  }
}
