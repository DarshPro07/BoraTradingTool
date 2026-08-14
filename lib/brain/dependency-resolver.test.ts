import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { claimNextJob, enqueue, failJob, queueStats, REVIVAL_COOLDOWN_MS } from "@/lib/research/queue";
import { runWorker } from "@/lib/research/worker";
import { instrumentReadiness } from "@/lib/market/ingest";
import { registerCapability, updateCapabilityHealth } from "@/lib/brain/capability-registry";
import {
  assessPrerequisite,
  assessRequirements,
  dedupeKeyFor,
  resolveDataRequirement,
  resolveUniverseDataGaps,
} from "./dependency-resolver";

/**
 * The self-resolution loop — the actual autonomy test.
 *
 * The product contract under test, in the owner's words: *every blocked workflow either knows
 * what will wake it, creates the required remediation automatically, or declares a truthful
 * external/permanent blocker.* Not "ingestion works" (v1 proved that) — the LOOP:
 *
 *   requirement unsatisfied
 *     → remediation auto-created            (REMEDIATION_QUEUED)
 *     → asking again stacks nothing         (REMEDIATION_ACTIVE)
 *     → the durable worker executes it
 *     → the SAME question now answers       SATISFIED
 *   — with no owner action at any step.
 *
 * And the failure side, which is what separates "keep progressing" from "retry forever":
 * a transient death answers COOLING_DOWN then revives; a permanent one answers
 * BLOCKED_PERMANENT and stays dead.
 *
 * TEST_MODE serves deterministic fixture candles; the machinery, not the feed, is under test.
 */

let previousTestMode: string | undefined;

beforeAll(() => {
  previousTestMode = process.env.MARKETPULSE_TEST_MODE;
  process.env.MARKETPULSE_TEST_MODE = "1";
});

afterAll(() => {
  if (previousTestMode === undefined) delete process.env.MARKETPULSE_TEST_MODE;
  else process.env.MARKETPULSE_TEST_MODE = previousTestMode;
});

describe("the self-resolution loop", () => {
  useTemporaryDatabase();

  it("blocked → remediation auto-created → worker runs → the same question answers SATISFIED", async () => {
    const instrumentId = "IN:XNSE:RELIANCE";
    expect(instrumentReadiness(instrumentId).ready, "precondition: fresh store").toBe(false);

    // 1. Stating the requirement CREATES the remediation.
    const first = await resolveDataRequirement({ instrumentId, purpose: "rehearsal" });
    expect(first.state).toBe("REMEDIATION_QUEUED");
    expect(first.jobId).not.toBeNull();

    // 2. Stating it again stacks nothing — the durable job answers for it.
    const second = await resolveDataRequirement({ instrumentId, purpose: "rehearsal" });
    expect(second.state).toBe("REMEDIATION_ACTIVE");
    expect(second.jobId).toBe(first.jobId);
    expect(queueStats().queued).toBe(1);

    // 3. The worker — the research lane in production — executes it. No owner anywhere.
    const drained = await runWorker("loop-test", 5);
    expect(drained.succeeded).toBeGreaterThanOrEqual(1);

    // 4. The prerequisite the blocker named is now satisfied, and the resolver says so.
    const third = await resolveDataRequirement({ instrumentId, purpose: "rehearsal" });
    expect(third.state, "the loop must close: blocked work re-asks and proceeds").toBe("SATISFIED");
    expect(third.jobId).toBeNull();
    expect(instrumentReadiness(instrumentId).ready).toBe(true);
  });

  it("a satisfied requirement never creates work", async () => {
    // RELIANCE was ingested by the loop test above? No — each test shares this suite's temporary
    // database, so ingest it here explicitly to make the test self-sufficient.
    const instrumentId = "IN:XNSE:RELIANCE";
    if (!instrumentReadiness(instrumentId).ready) {
      enqueue({ kind: "ingest_history", payload: { instrumentId } });
      await runWorker("loop-test", 5);
    }
    const before = queueStats();
    const resolution = await resolveDataRequirement({ instrumentId, purpose: "research" });
    expect(resolution.state).toBe("SATISFIED");
    expect(queueStats().queued).toBe(before.queued);
  });

  it("an instrument the exchange never listed is refused before any job exists", async () => {
    const resolution = await resolveDataRequirement({
      instrumentId: "IN:XNSE:NOT-A-REAL-ZZZ",
      purpose: "research",
    });
    expect(resolution.state).toBe("UNKNOWN_INSTRUMENT");
    expect(resolution.jobId).toBeNull();
  });
});

describe("failure without infinite looping", () => {
  useTemporaryDatabase();

  /** Kill the resolver's own job for an instrument with the given terminal error. */
  function killRemediation(instrumentId: string, error: string): number {
    const { id } = enqueue({
      kind: "ingest_history",
      payload: { instrumentId },
      dedupeKey: dedupeKeyFor(instrumentId),
      maxAttempts: 1,
    });
    claimNextJob("killer");
    failJob(id, error);
    return id;
  }

  it("a transient death answers COOLING_DOWN, then revives once the cooldown passes", async () => {
    const instrumentId = "IN:XNSE:TCS";
    const jobId = killRemediation(instrumentId, "SOURCE_UNAVAILABLE: provider outage");

    const cooling = await resolveDataRequirement({ instrumentId, purpose: "rehearsal" });
    expect(cooling.state, "re-asking during the cooldown must not enqueue a doomed duplicate").toBe("COOLING_DOWN");
    expect(cooling.jobId).toBe(jobId);

    getDb()
      .update(schema.researchJobs)
      .set({ updatedAt: new Date(Date.now() - REVIVAL_COOLDOWN_MS - 1_000) })
      .where(eq(schema.researchJobs.id, jobId))
      .run();

    const revived = await resolveDataRequirement({ instrumentId, purpose: "rehearsal" });
    expect(revived.state).toBe("REMEDIATION_QUEUED");
    expect(revived.jobId, "revival reuses the durable row").toBe(jobId);
    expect(revived.detail).toContain("revived");
  });

  it("a permanent death answers BLOCKED_PERMANENT forever — a truthful dead end, not a loop", async () => {
    const instrumentId = "IN:XNSE:TCS";
    const jobId = killRemediation(instrumentId, "INSTRUMENT_UNKNOWN: synthetic permanent failure");

    getDb()
      .update(schema.researchJobs)
      .set({ updatedAt: new Date(Date.now() - REVIVAL_COOLDOWN_MS * 100) })
      .where(eq(schema.researchJobs.id, jobId))
      .run();

    const blocked = await resolveDataRequirement({ instrumentId, purpose: "rehearsal" });
    expect(blocked.state).toBe("BLOCKED_PERMANENT");
    expect(blocked.jobId).toBe(jobId);
    expect(blocked.detail).toContain("INSTRUMENT_UNKNOWN");
    expect(queueStats().dead, "the corpse stays visible on /jobs").toBe(1);
  });
});

describe("the grammar — every prerequisite kind answers with one of six classes", () => {
  // Wednesday 2026-08-12, 10:00 IST — mid NSE regular session. Frozen so the market clock is a
  // fact of the test, not of the wall clock.
  const OPEN = new Date("2026-08-12T04:30:00Z");
  const SHUT_SATURDAY = new Date("2026-08-15T05:00:00Z");

  it("TIME: waits with its own resumeAt, then satisfies once the clock passes it", async () => {
    const waiting = await assessPrerequisite(
      { kind: "TIME", resumeAt: "2026-08-12T05:00:00Z", what: "opening window" },
      OPEN,
    );
    expect(waiting.satisfied).toBe(false);
    expect(waiting.blockedClass).toBe("RESOLVABLE_LATER");
    expect(waiting.resumeAt).toBe("2026-08-12T05:00:00Z");

    const reached = await assessPrerequisite(
      { kind: "TIME", resumeAt: "2026-08-12T04:00:00Z", what: "opening window" },
      OPEN,
    );
    expect(reached.satisfied).toBe(true);
    expect(reached.blockedClass).toBeNull();
  });

  it("MARKET_STATE: satisfied mid-session; RESOLVABLE_LATER with the next open when shut", async () => {
    const open = await assessPrerequisite({ kind: "MARKET_STATE", market: "IN", needs: "REGULAR", what: "ORB" }, OPEN);
    expect(open.satisfied).toBe(true);

    const shut = await assessPrerequisite(
      { kind: "MARKET_STATE", market: "IN", needs: "REGULAR", what: "ORB" },
      SHUT_SATURDAY,
    );
    expect(shut.satisfied).toBe(false);
    expect(shut.blockedClass).toBe("RESOLVABLE_LATER");
    expect(shut.resumeAt, "the market clock names the wake").toBe("2026-08-17 09:00 Asia/Kolkata");
  });

  it("FUTURE_EVENT: never satisfied by asking — it names what wakes it", async () => {
    const assessment = await assessPrerequisite(
      { kind: "FUTURE_EVENT", wakeEvent: "DATA_INGESTED", what: "forecast outcome" },
      OPEN,
    );
    expect(assessment.blockedClass).toBe("RESOLVABLE_ON_EVENT");
    expect(assessment.wakeEvent).toBe("DATA_INGESTED");
  });

  it("PROVIDER: ready / needs-credentials / unavailable map to satisfied / EXTERNAL_REQUIRED / VIA_ALTERNATIVE", async () => {
    const ready = await assessPrerequisite({ kind: "PROVIDER", providerId: "claude-code", status: "READY" }, OPEN);
    expect(ready.satisfied).toBe(true);

    const auth = await assessPrerequisite(
      { kind: "PROVIDER", providerId: "upstox", status: "AUTH_REQUIRED", reason: "token expired" },
      OPEN,
    );
    expect(auth.blockedClass).toBe("EXTERNAL_REQUIRED");

    const down = await assessPrerequisite({ kind: "PROVIDER", providerId: "codex", status: "UNAVAILABLE" }, OPEN);
    expect(down.blockedClass).toBe("RESOLVABLE_VIA_ALTERNATIVE");
  });

  it("CAPABILITY: healthy satisfies; degraded wakes on health change; unregistered is IMPOSSIBLE", async () => {
    registerCapability({
      capabilityId: "test.grammar",
      name: "Grammar test capability",
      domain: "test",
      description: "",
      implementation: "here",
      health: "READY",
      healthReason: "registered by test",
      deterministic: true,
      requiresLLM: false,
      requiresMarketData: false,
      lastSuccessfulRun: null,
      lastFailure: null,
      metrics: { totalRuns: 0, successfulRuns: 0, failedRuns: 0 },
    });

    const healthy = await assessPrerequisite({ kind: "CAPABILITY", capabilityId: "test.grammar", what: "review" }, OPEN);
    expect(healthy.satisfied).toBe(true);

    updateCapabilityHealth("test.grammar", "DEGRADED", "made unhealthy by test");
    const degraded = await assessPrerequisite({ kind: "CAPABILITY", capabilityId: "test.grammar", what: "review" }, OPEN);
    expect(degraded.blockedClass).toBe("RESOLVABLE_ON_EVENT");
    expect(degraded.wakeEvent).toBe("CAPABILITY_HEALTH_CHANGED");

    const missing = await assessPrerequisite({ kind: "CAPABILITY", capabilityId: "test.never-registered", what: "x" }, OPEN);
    expect(missing.blockedClass).toBe("IMPOSSIBLE");
  });

  it("EXTERNAL_AUTH and PERMANENT_FACT are the two honest dead ends — one the owner's, one nobody's", async () => {
    const auth = await assessPrerequisite({ kind: "EXTERNAL_AUTH", what: "Kite login requires the owner" }, OPEN);
    expect(auth.blockedClass).toBe("EXTERNAL_REQUIRED");

    const fact = await assessPrerequisite({ kind: "PERMANENT_FACT", why: "NSE never listed this symbol" }, OPEN);
    expect(fact.blockedClass).toBe("IMPOSSIBLE");
  });

  it("dominance: IMPOSSIBLE outranks EXTERNAL_REQUIRED outranks autonomous work", async () => {
    const worst = await assessRequirements(
      [
        { kind: "PERMANENT_FACT", why: "delisted" },
        { kind: "EXTERNAL_AUTH", what: "credentials" },
        { kind: "FUTURE_EVENT", wakeEvent: "DATA_INGESTED", what: "bar" },
      ],
      OPEN,
    );
    expect(worst.classification).toBe("IMPOSSIBLE");

    const external = await assessRequirements(
      [
        { kind: "EXTERNAL_AUTH", what: "credentials" },
        { kind: "TIME", resumeAt: "2026-08-12T05:00:00Z", what: "later" },
      ],
      OPEN,
    );
    expect(external.classification).toBe("EXTERNAL_REQUIRED");
  });

  it("nextCheckAt compares REAL INSTANTS across mixed formats — a same-day local descriptor must not beat an earlier ISO time by string sort", async () => {
    // Found by independent verification, not production: ' ' (0x20) < 'T' (0x54), so
    // "2026-08-17 09:00 Asia/Kolkata" (= 03:30 UTC) string-sorts BEFORE
    // "2026-08-17T00:28:00.000Z" even though it is three hours LATER in real time. A scheduler
    // trusting that min would under-poll. Frozen Saturday, so MARKET_STATE produces the
    // descriptor and TIME produces the earlier ISO instant. Since the owner's instant/display
    // split, every assessment carries `resumeAtMs` and the min never touches text.
    const composite = await assessRequirements(
      [
        { kind: "TIME", resumeAt: "2026-08-17T00:28:00.000Z", what: "cooldown ends first" },
        { kind: "MARKET_STATE", market: "IN", needs: "REGULAR", what: "ORB" },
      ],
      SHUT_SATURDAY,
    );
    expect(composite.blockers).toHaveLength(2);
    expect(composite.nextCheckAt, "the EARLIER real moment wins, whatever its format").toBe(
      "2026-08-17T00:28:00.000Z",
    );
    expect(composite.nextCheckAtMs, "the scheduler's field is the instant itself").toBe(
      Date.parse("2026-08-17T00:28:00.000Z"),
    );
  });

  it("an exchange-local display always carries its true instant beside it", async () => {
    const shut = await assessPrerequisite(
      { kind: "MARKET_STATE", market: "IN", needs: "REGULAR", what: "ORB" },
      SHUT_SATURDAY,
    );
    expect(shut.resumeAt).toBe("2026-08-17 09:00 Asia/Kolkata");
    // 09:00 IST is 03:30 UTC — the instant is computed through the zone's rules, never by
    // parsing the display text.
    expect(shut.resumeAtMs).toBe(Date.parse("2026-08-17T03:30:00Z"));
  });

  it("nextCheckAt is the EARLIEST moment the answer can change, never a fabricated full-readiness ETA", async () => {
    const composite = await assessRequirements(
      [
        { kind: "TIME", resumeAt: "2026-08-12T06:00:00Z", what: "later" },
        { kind: "TIME", resumeAt: "2026-08-12T05:00:00Z", what: "sooner" },
        { kind: "FUTURE_EVENT", wakeEvent: "DATA_INGESTED", what: "no ETA exists for this one" },
      ],
      OPEN,
    );
    expect(composite.nextCheckAt).toBe("2026-08-12T05:00:00Z");
    expect(composite.wakeEvents).toEqual(["DATA_INGESTED"]);
  });
});

describe("the grammar — durable kinds (JOB) and the two-concept warm-up composition", () => {
  useTemporaryDatabase();

  const OPEN = new Date("2026-08-12T04:30:00Z");

  it("JOB: in-flight is RESOLVABLE_NOW, succeeded satisfies, permanent death is IMPOSSIBLE", async () => {
    const { id } = enqueue({ kind: "ingest_history", payload: { instrumentId: "IN:XNSE:RELIANCE" } });
    const inFlight = await assessPrerequisite({ kind: "JOB", jobId: id, what: "history" }, OPEN);
    expect(inFlight.blockedClass).toBe("RESOLVABLE_NOW");
    expect(inFlight.wakeEvent).toBe("JOB_COMPLETED");

    await runWorker("grammar-test", 5);
    const done = await assessPrerequisite({ kind: "JOB", jobId: id, what: "history" }, OPEN);
    expect(done.satisfied).toBe(true);

    const doomed = enqueue({ kind: "ingest_history", payload: { instrumentId: "IN:XNSE:TCS" }, maxAttempts: 1 });
    claimNextJob("grammar-test");
    failJob(doomed.id, "INSTRUMENT_UNKNOWN: synthetic");
    const dead = await assessPrerequisite({ kind: "JOB", jobId: doomed.id, what: "history" }, OPEN);
    expect(dead.blockedClass).toBe("IMPOSSIBLE");

    const missing = await assessPrerequisite({ kind: "JOB", jobId: 99_999, what: "phantom" }, OPEN);
    expect(missing.blockedClass).toBe("IMPOSSIBLE");
  });

  it("ORB-shaped composition: the clock arriving alone must NEVER read as ready while bars are missing", async () => {
    // Market open ✓, opening window passed ✓ — and the canonical store is empty. Under a
    // one-resumeAt model this strategy would wake at 09:30 and run on bars that do not exist.
    const composite = await assessRequirements(
      [
        { kind: "MARKET_STATE", market: "IN", needs: "REGULAR", what: "ORB session" },
        { kind: "TIME", resumeAt: "2026-08-12T04:00:00Z", what: "15m opening window" },
        { kind: "DATA", requirement: { instrumentId: "IN:XNSE:RELIANCE", purpose: "rehearsal" } },
      ],
      OPEN,
    );

    expect(composite.ready, "TIME_READY alone is not readiness — DATA_READY is a separate concept").toBe(false);
    expect(composite.blockers).toHaveLength(1);
    expect(composite.blockers[0].prerequisite.kind).toBe("DATA");
    // And the DATA blocker is not a complaint: remediation was created by the asking.
    expect(composite.classification).toBe("RESOLVABLE_NOW");

    // Satisfy the data half through the durable queue — no owner anywhere — and the SAME
    // composition becomes ready.
    await runWorker("grammar-test", 5);
    const after = await assessRequirements(
      [
        { kind: "MARKET_STATE", market: "IN", needs: "REGULAR", what: "ORB session" },
        { kind: "TIME", resumeAt: "2026-08-12T04:00:00Z", what: "15m opening window" },
        { kind: "DATA", requirement: { instrumentId: "IN:XNSE:RELIANCE", purpose: "rehearsal" } },
      ],
      OPEN,
    );
    expect(after.ready).toBe(true);
    expect(after.classification).toBeNull();
  });
});

describe("universe-wide resolution", () => {
  useTemporaryDatabase();

  it("bounds its readiness checks by quota and reports every outcome class", async () => {
    const report = await resolveUniverseDataGaps({ quota: 5 });
    expect(report.considered).toBeLessThanOrEqual(5);
    // The TEST_MODE master resolves at least one real instrument with an empty store.
    expect(report.queued).toBeGreaterThanOrEqual(1);
    expect(report.summary).toContain("ingest_history");

    // Second pass: nothing stacks. Whatever was queued is now ACTIVE, not re-queued.
    const again = await resolveUniverseDataGaps({ quota: 5 });
    expect(again.queued).toBe(0);
    expect(again.active).toBeGreaterThanOrEqual(report.queued);
  });
});
