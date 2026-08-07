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

  it("treats an unreadable lease as expired", () => {
    // A lease nobody can parse is not evidence that somebody holds it. Trusting it would wedge
    // autonomy permanently on a single truncated write.
    const file = leaseFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{not json", "utf8");
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
