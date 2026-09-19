import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LEASE_TTL_MS, acquireLease, currentLease, releaseLease, withCycleLease } from "./lease";

// One root, subdivided per case. `mkdtempSync` per test is a synchronous round trip each time,
// and on Windows with a scanner watching the temp tree that is enough to matter.
const SUITE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "lease-test-"));
let caseCounter = 0;

function leaseFile(): string {
  return path.join(SUITE_ROOT, `case-${(caseCounter += 1)}`, "marketpulse.db.cycle-lease");
}

const T0 = 1_780_000_000_000;

describe("only one driver runs a cycle", () => {
  it("grants the lease to the first caller and refuses the second", () => {
    const file = leaseFile();
    expect(acquireLease("scheduler", file, T0)).not.toBeNull();
    expect(acquireLease("browser", file, T0)).toBeNull();
  });

  it("names who is holding it, so a refusal is diagnosable", () => {
    const file = leaseFile();
    acquireLease("scheduler", file, T0);
    const held = currentLease(file, T0);
    expect(held?.holder).toBe("scheduler");
    expect(held?.acquiredAt).toBe(T0);
  });

  it("frees the lease on release", () => {
    const file = leaseFile();
    const lease = acquireLease("daemon", file, T0);
    releaseLease(lease!.holder, lease!.acquiredAt, file);
    expect(acquireLease("browser", file, T0)).not.toBeNull();
  });
});

describe("a crashed holder does not wedge autonomy forever", () => {
  it("lets another driver take an expired lease", () => {
    const file = leaseFile();
    acquireLease("scheduler", file, T0);
    // The holder never released — the process died mid-cycle.
    expect(acquireLease("daemon", file, T0 + LEASE_TTL_MS)).not.toBeNull();
  });

  it("still refuses one millisecond before expiry", () => {
    const file = leaseFile();
    acquireLease("scheduler", file, T0);
    expect(acquireLease("daemon", file, T0 + LEASE_TTL_MS - 1)).toBeNull();
  });

  it("reports an expired lease as free rather than as held", () => {
    const file = leaseFile();
    acquireLease("scheduler", file, T0);
    expect(currentLease(file, T0 + LEASE_TTL_MS)).toBeNull();
  });

  it("never lets an unreadable lease wedge autonomy: it expires once older than the TTL", () => {
    // Trusting a corrupt lease forever would wedge autonomy on a single truncated write. It used to
    // count as expired IMMEDIATELY, which also handed a lease caught mid-write to a second driver
    // (review finding 2026-09-19); it is now judged by the file's age, so the wedge still cannot
    // happen and the race cannot either.
    const file = leaseFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{not json", "utf8");
    const aged = new Date(T0 - LEASE_TTL_MS - 1_000);
    fs.utimesSync(file, aged, aged);
    expect(acquireLease("scheduler", file, T0)).not.toBeNull();
  });
});

describe("release is not a licence to delete somebody else's lease", () => {
  it("ignores a release from a driver that no longer holds it", () => {
    const file = leaseFile();
    const first = acquireLease("scheduler", file, T0)!;
    // The scheduler stalled past the TTL and the daemon took over.
    acquireLease("daemon", file, T0 + LEASE_TTL_MS);
    // The scheduler finally finishes and releases — it must not free the daemon's lease.
    releaseLease(first.holder, first.acquiredAt, file);
    expect(currentLease(file, T0 + LEASE_TTL_MS)?.holder).toBe("daemon");
  });

  it("ignores a release carrying a stale acquisition time from the same driver", () => {
    const file = leaseFile();
    const first = acquireLease("scheduler", file, T0)!;
    releaseLease(first.holder, first.acquiredAt, file);
    const second = acquireLease("scheduler", file, T0 + 1)!;
    releaseLease(first.holder, first.acquiredAt, file);
    expect(currentLease(file, T0 + 1)?.acquiredAt).toBe(second.acquiredAt);
  });
});

describe("withCycleLease", () => {
  it("runs the work and reports the result", async () => {
    const outcome = await withCycleLease("scheduler", async () => "ran", leaseFile());
    expect(outcome.acquired).toBe(true);
    expect(outcome.result).toBe("ran");
    expect(outcome.blockedBy).toBeNull();
  });

  it("does not run the work when another driver holds the lease", async () => {
    const file = leaseFile();
    acquireLease("scheduler", file);
    let ran = false;
    const outcome = await withCycleLease("browser", async () => {
      ran = true;
      return "ran";
    }, file);
    expect(ran).toBe(false);
    expect(outcome.acquired).toBe(false);
    expect(outcome.blockedBy?.holder).toBe("scheduler");
  });

  it("releases the lease even when the work throws", async () => {
    const file = leaseFile();
    await expect(
      withCycleLease("scheduler", async () => {
        throw new Error("cycle failed");
      }, file),
    ).rejects.toThrow("cycle failed");
    // A cycle that throws must not lock every future cycle out for ten minutes.
    expect(acquireLease("daemon", file)).not.toBeNull();
  });

  it("serialises concurrent drivers: exactly one runs", async () => {
    const file = leaseFile();
    let concurrent = 0;
    let peak = 0;
    const drivers = ["scheduler", "daemon", "browser"].map((holder) =>
      withCycleLease(holder, async () => {
        concurrent += 1;
        peak = Math.max(peak, concurrent);
        await new Promise((resolve) => setTimeout(resolve, 10));
        concurrent -= 1;
        return holder;
      }, file),
    );
    const outcomes = await Promise.all(drivers);
    expect(peak).toBe(1);
    expect(outcomes.filter((outcome) => outcome.acquired)).toHaveLength(1);
  });
});

describe("a long cycle keeps its lease", () => {
  it("renews while the run is in flight, so no other driver can take it mid-cycle", async () => {
    // Measured 2026-09-19: a scheduled cycle ran 14.8 minutes against a 10-minute TTL.
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lease-renew-")), "cycle-lease");
    let rivalGotIt = true;
    const outcome = await withCycleLease(
      "scheduler",
      async () => {
        const first = JSON.parse(fs.readFileSync(file, "utf8")).acquiredAt as number;
        await new Promise((resolve) => setTimeout(resolve, 120));
        const renewed = JSON.parse(fs.readFileSync(file, "utf8")).acquiredAt as number;
        // A rival judging expiry as of (renewed stamp + TTL - 1ms) must still be refused.
        rivalGotIt = acquireLease("supervisor", file, renewed + LEASE_TTL_MS - 1) !== null;
        return renewed > first;
      },
      file,
      20,
    );
    expect(outcome.result, "the heartbeat moved the stamp forward").toBe(true);
    expect(rivalGotIt).toBe(false);
    expect(currentLease(file), "released at the end").toBeNull();
  });
});

describe("the lease under review findings (2026-09-19)", () => {
  it("treats a lease file caught mid-write as HELD until it is older than the TTL", () => {
    // `wx` creates the file before its contents land. A rival reading it in that window used to
    // see "unparseable -> expired", delete it and take the lease: two holders.
    const file = leaseFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "", "utf8"); // exists, not yet written
    expect(acquireLease("rival", file), "a fresh empty lease is somebody's").toBeNull();

    const old = new Date(Date.now() - LEASE_TTL_MS - 1_000);
    fs.utimesSync(file, old, old);
    expect(acquireLease("rival", file), "an empty lease older than the TTL is garbage").not.toBeNull();
  });

  it("stops renewing a run that exceeds the maximum cycle length", async () => {
    // A hung-but-alive driver must not hold the lease forever through its own heartbeat.
    const file = leaseFile();
    await withCycleLease(
      "scheduler",
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        const stampAtCap = JSON.parse(fs.readFileSync(file, "utf8")).acquiredAt as number;
        await new Promise((resolve) => setTimeout(resolve, 80));
        const later = JSON.parse(fs.readFileSync(file, "utf8")).acquiredAt as number;
        expect(later, "no renewal after the cap").toBe(stampAtCap);
      },
      file,
      10,
      50,
    );
  });
});
