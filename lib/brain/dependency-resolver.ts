import { enqueue, failureClass, getJob, REVIVAL_COOLDOWN_MS } from "@/lib/research/queue";
import { getCapability } from "@/lib/brain/capability-registry";
import { getMarketPhase } from "@/lib/market/phases";
import { nextBarWake } from "@/lib/learning/reasons";
import type { Market } from "@/lib/market/types";

/**
 * The generic prerequisite/wake model — Dependency Resolver v2.
 *
 * ## From one remediation to a model
 *
 * v1 taught the system its first remediation: a rehearsal blocked on missing bars enqueues the
 * `ingest_history` job that unblocks it. That logic lived inline in the learning cycle, so it was
 * the ONLY blocked workflow that could act on its blocker — every other surface (research
 * refusals, the scanner, a future backtest queue) would have had to re-implement the same
 * enqueue/dedupe/refusal dance or go back to printing warnings.
 *
 * This module is that dance, named. A caller states a requirement; the resolver answers with the
 * truthful state of the world:
 *
 *   SATISFIED           the prerequisite already holds — no work created
 *   REMEDIATION_QUEUED  work was created (or revived) this call; the durable queue owns it now
 *   REMEDIATION_ACTIVE  work already exists and is queued/running — nothing stacked on top
 *   COOLING_DOWN        the last attempt died of a transient cause; revival waits out the cooldown
 *   BLOCKED_PERMANENT   the last attempt died of a cause waiting cannot change — a truthful dead end
 *   UNKNOWN_INSTRUMENT  the exchange's master has no such security — remediation would ingest a phantom
 *
 * Every state is derived from durable rows (`research_jobs` + the canonical store), never from
 * module memory, so the answer survives restarts and is the same from every caller.
 *
 * ## What deliberately stays out
 *
 * The resolver creates work; it never performs it. Fetching bars inside the asking codepath is
 * the mid-evaluation fetch the rehearsal forbids — a verdict must pin to a recorded snapshot,
 * not to whatever the network returned mid-judgement. Remediation is asynchronous by design and
 * the NEXT pass finds the satisfied prerequisite.
 */

export interface DataRequirement {
  instrumentId: string;
  /** What the bars are for. Sets queue priority — an active strategy's gap outranks exploration. */
  purpose: "rehearsal" | "research" | "backtest";
}

export type ResolutionState =
  | "SATISFIED"
  | "REMEDIATION_QUEUED"
  | "REMEDIATION_ACTIVE"
  | "COOLING_DOWN"
  | "BLOCKED_PERMANENT"
  | "UNKNOWN_INSTRUMENT";

export interface Resolution {
  state: ResolutionState;
  /** The durable job answering for this requirement, when one exists. */
  jobId: number | null;
  detail: string;
}

/**
 * Lower number = claimed first. Research intake enqueues at 100, so every remediation sits below
 * human-queued work; within remediation, a rehearsal gap (an active strategy that cannot be
 * judged) outranks research breadth.
 */
const PRIORITY: Record<DataRequirement["purpose"], number> = {
  rehearsal: 140,
  research: 150,
  backtest: 150,
};

export function dedupeKeyFor(instrumentId: string): string {
  return `ingest-history-${instrumentId}`;
}

/**
 * State a data requirement; receive the truthful state of it, creating the remediation job when
 * — and only when — one is needed and possible.
 */
export async function resolveDataRequirement(requirement: DataRequirement): Promise<Resolution> {
  // Dynamic import, matching the worker and the cycle: `lib/market/ingest` pulls the provider
  // chain and the research bridge behind it, and this module must stay importable from anything
  // that talks to the brain without dragging that graph in at module-load time.
  const { instrumentReadiness } = await import("@/lib/market/ingest");
  const readiness = instrumentReadiness(requirement.instrumentId);

  if (!readiness.known) {
    return {
      state: "UNKNOWN_INSTRUMENT",
      jobId: null,
      detail:
        `${requirement.instrumentId} is not in the exchange's security master; ingesting history ` +
        "for it would create a phantom instrument. Nothing was queued.",
    };
  }
  if (readiness.ready) {
    return {
      state: "SATISFIED",
      jobId: null,
      detail: `${readiness.stored} of ${readiness.required} required bars already stored.`,
    };
  }

  const instrumentId = readiness.instrumentId ?? requirement.instrumentId;
  const queued = enqueue({
    kind: "ingest_history",
    payload: { instrumentId },
    dedupeKey: dedupeKeyFor(instrumentId),
    priority: PRIORITY[requirement.purpose],
  });

  if (!queued.deduped) {
    return {
      state: "REMEDIATION_QUEUED",
      jobId: queued.id,
      detail: queued.revived
        ? `Job ${queued.id} revived after its cooldown; attempts reset.`
        : `Job ${queued.id} queued (${readiness.stored}/${readiness.required} bars stored).`,
    };
  }

  // Deduped: an existing durable row answers for this requirement. Say which kind of answer.
  const job = getJob(queued.id);
  if (job?.status === "dead") {
    return failureClass(job.lastError) === "PERMANENT"
      ? {
          state: "BLOCKED_PERMANENT",
          jobId: job.id,
          detail: `Remediation cannot succeed: ${job.lastError ?? "unknown failure"}`,
        }
      : {
          state: "COOLING_DOWN",
          jobId: job.id,
          detail:
            `Last attempt failed transiently (${job.lastError?.slice(0, 200) ?? "unknown"}); ` +
            `revival after ${Math.round(REVIVAL_COOLDOWN_MS / 60_000)}m cooldown.`,
        };
  }
  return {
    state: "REMEDIATION_ACTIVE",
    jobId: queued.id,
    detail: `Job ${queued.id} is ${job?.status ?? "queued"}; nothing stacked on top of it.`,
  };
}

export interface UniverseGapReport {
  considered: number;
  queued: number;
  revived: number;
  active: number;
  cooling: number;
  blocked: number;
  unknown: number;
  summary: string;
}

/**
 * Resolve data gaps across the acceptance universe — the cycle's rehearsal-outage remediation,
 * relocated here so any blocked surface can invoke the same machinery.
 *
 * `quota` bounds how many instruments are even READINESS-CHECKED per pass, not just how many
 * jobs are created: `instrumentReadiness` loads the instrument's stored bars, and the NSE master
 * holds 3,314 securities.
 */
// ponytail: alphabetical head of the master, as v1 had — a readiness index / batch planner is the
// upgrade path when full-universe coverage matters.
export async function resolveUniverseDataGaps(
  options: { quota?: number } = {},
): Promise<UniverseGapReport> {
  const quota = options.quota ?? 30;
  const { searchInstruments } = await import("@/lib/market/catalog");

  const report: UniverseGapReport = {
    considered: 0,
    queued: 0,
    revived: 0,
    active: 0,
    cooling: 0,
    blocked: 0,
    unknown: 0,
    summary: "",
  };

  for (const instrument of searchInstruments("", "XNSE").slice(0, quota)) {
    report.considered += 1;
    const resolution = await resolveDataRequirement({ instrumentId: instrument.id, purpose: "rehearsal" });
    switch (resolution.state) {
      case "SATISFIED":
        break;
      case "REMEDIATION_QUEUED":
        report.queued += 1;
        if (resolution.detail.includes("revived")) report.revived += 1;
        break;
      case "REMEDIATION_ACTIVE":
        report.active += 1;
        break;
      case "COOLING_DOWN":
        report.cooling += 1;
        break;
      case "BLOCKED_PERMANENT":
        report.blocked += 1;
        break;
      case "UNKNOWN_INSTRUMENT":
        report.unknown += 1;
        break;
    }
  }

  const parts: string[] = [];
  if (report.queued > 0) parts.push(`enqueued ${report.queued} ingest_history job(s)`);
  if (report.revived > 0) parts.push(`${report.revived} revived after cooldown`);
  if (report.active > 0) parts.push(`${report.active} already queued or running`);
  if (report.cooling > 0) parts.push(`${report.cooling} cooling down after transient failure`);
  if (report.blocked > 0) parts.push(`${report.blocked} permanently unresolvable`);
  report.summary =
    parts.length > 0 ? `Data gaps: ${parts.join(", ")}.` : "No data gaps needed remediation.";
  return report;
}

/* ────────────────────────────────────────────────────────────────────────────
 * The dependency GRAMMAR — v2.
 *
 * v1 proved one dependency kind (DATA) end to end. The owner's directive for v2: do not write
 * lots of independent special cases — make every blocked workflow speak one grammar:
 *
 *   Why can't I continue?   → a typed Prerequisite
 *   Who owns satisfying it? → the assessment names the owner (a job, a clock, an event, the owner)
 *   What will wake me?      → resumeAt (time-knowable) or wakeEvent (event-knowable)
 *
 * and classify every blocker into exactly one of six answers Brain can always give:
 *
 *   RESOLVABLE_NOW              remediation exists/was created and the machine is progressing it
 *   RESOLVABLE_LATER            a knowable time unblocks it (cooldown, market clock, warm-up)
 *   RESOLVABLE_ON_EVENT         a defined future event wakes it (a bar, a health change)
 *   RESOLVABLE_VIA_ALTERNATIVE  another provider could satisfy it — the router owns fallback
 *   EXTERNAL_REQUIRED           genuinely the owner's: credentials, MFA, a paid decision
 *   IMPOSSIBLE                  a permanent fact; waiting changes nothing, and saying so is the answer
 * ──────────────────────────────────────────────────────────────────────────── */

export type PrerequisiteKind =
  | "DATA"
  | "TIME"
  | "MARKET_STATE"
  | "FUTURE_EVENT"
  | "PROVIDER"
  | "JOB"
  | "CAPABILITY"
  | "EXTERNAL_AUTH"
  | "PERMANENT_FACT";

export type Prerequisite =
  | { kind: "DATA"; requirement: DataRequirement }
  | { kind: "TIME"; resumeAt: string; what: string }
  | { kind: "MARKET_STATE"; market: Market; needs: "REGULAR" | "PRE_OPEN" | "ANY_OPEN"; what: string }
  | { kind: "FUTURE_EVENT"; wakeEvent: string; what: string }
  /**
   * `status` is caller-supplied from a real probe (the gateway's detectProviders, a routing
   * refusal). The assessment deliberately does NOT probe: probing spawns subprocesses, and an
   * assessment that costs a binary launch per question is re-polling wearing a new hat.
   */
  | { kind: "PROVIDER"; providerId: string; status: "READY" | "AUTH_REQUIRED" | "UNAVAILABLE"; reason?: string }
  | { kind: "JOB"; jobId: number; what: string }
  | { kind: "CAPABILITY"; capabilityId: string; what: string }
  | { kind: "EXTERNAL_AUTH"; what: string }
  | { kind: "PERMANENT_FACT"; why: string };

export type BlockedClass =
  | "RESOLVABLE_NOW"
  | "RESOLVABLE_LATER"
  | "RESOLVABLE_ON_EVENT"
  | "RESOLVABLE_VIA_ALTERNATIVE"
  | "EXTERNAL_REQUIRED"
  | "IMPOSSIBLE";

export interface Assessment {
  prerequisite: Prerequisite;
  satisfied: boolean;
  /** Null exactly when satisfied. */
  blockedClass: BlockedClass | null;
  /** When the answer can next change, if a clock knows — DISPLAY form (ISO or exchange-local). */
  resumeAt: string | null;
  /** The same wake as an INSTANT. Scheduling and comparison consume ONLY this field. */
  resumeAtMs: number | null;
  /** The event that wakes it, if one is defined. */
  wakeEvent: string | null;
  detail: string;
}

/** Assess one prerequisite against durable state. Creates DATA remediation as a side effect — the v1 contract. */
export async function assessPrerequisite(prerequisite: Prerequisite, now = new Date()): Promise<Assessment> {
  const base = {
    prerequisite,
    resumeAt: null as string | null,
    resumeAtMs: null as number | null,
    wakeEvent: null as string | null,
  };

  switch (prerequisite.kind) {
    case "DATA": {
      const resolution = await resolveDataRequirement(prerequisite.requirement);
      switch (resolution.state) {
        case "SATISFIED":
          return { ...base, satisfied: true, blockedClass: null, detail: resolution.detail };
        case "REMEDIATION_QUEUED":
        case "REMEDIATION_ACTIVE":
          return {
            ...base,
            satisfied: false,
            blockedClass: "RESOLVABLE_NOW",
            wakeEvent: "JOB_COMPLETED",
            detail: resolution.detail,
          };
        case "COOLING_DOWN": {
          const job = resolution.jobId === null ? null : getJob(resolution.jobId);
          const revivalMs = job ? job.updatedAt.getTime() + REVIVAL_COOLDOWN_MS : null;
          return {
            ...base,
            satisfied: false,
            blockedClass: "RESOLVABLE_LATER",
            resumeAt: revivalMs === null ? null : new Date(revivalMs).toISOString(),
            resumeAtMs: revivalMs,
            detail: resolution.detail,
          };
        }
        case "BLOCKED_PERMANENT":
        case "UNKNOWN_INSTRUMENT":
          return { ...base, satisfied: false, blockedClass: "IMPOSSIBLE", detail: resolution.detail };
      }
      break;
    }
    case "TIME": {
      const due = Date.parse(prerequisite.resumeAt);
      if (Number.isFinite(due) && now.getTime() >= due) {
        return { ...base, satisfied: true, blockedClass: null, detail: `${prerequisite.what}: time reached.` };
      }
      return {
        ...base,
        satisfied: false,
        blockedClass: "RESOLVABLE_LATER",
        resumeAt: prerequisite.resumeAt,
        resumeAtMs: Number.isFinite(due) ? due : null,
        detail: `${prerequisite.what}: waits until ${prerequisite.resumeAt}.`,
      };
    }
    case "MARKET_STATE": {
      const phase = getMarketPhase(prerequisite.market, now);
      const satisfied =
        prerequisite.needs === "REGULAR"
          ? phase.session === "REGULAR"
          : prerequisite.needs === "PRE_OPEN"
            ? phase.sessionState === "PRE_OPEN"
            : phase.session !== "CLOSED";
      if (satisfied) {
        return { ...base, satisfied: true, blockedClass: null, detail: `${prerequisite.what}: market is ${phase.phase}.` };
      }
      const wake = nextBarWake(prerequisite.market, now);
      return {
        ...base,
        satisfied: false,
        blockedClass: "RESOLVABLE_LATER",
        resumeAt: wake?.display ?? null,
        resumeAtMs: wake?.epochMs ?? null,
        detail: `${prerequisite.what}: needs ${prerequisite.needs}, market is ${phase.phase}.`,
      };
    }
    case "FUTURE_EVENT":
      return {
        ...base,
        satisfied: false,
        blockedClass: "RESOLVABLE_ON_EVENT",
        wakeEvent: prerequisite.wakeEvent,
        detail: `${prerequisite.what}: wakes on ${prerequisite.wakeEvent}.`,
      };
    case "PROVIDER": {
      if (prerequisite.status === "READY") {
        return { ...base, satisfied: true, blockedClass: null, detail: `${prerequisite.providerId} is ready.` };
      }
      if (prerequisite.status === "AUTH_REQUIRED") {
        return {
          ...base,
          satisfied: false,
          blockedClass: "EXTERNAL_REQUIRED",
          detail: `${prerequisite.providerId} needs credentials${prerequisite.reason ? `: ${prerequisite.reason}` : "."}`,
        };
      }
      return {
        ...base,
        satisfied: false,
        blockedClass: "RESOLVABLE_VIA_ALTERNATIVE",
        detail:
          `${prerequisite.providerId} is unavailable${prerequisite.reason ? ` (${prerequisite.reason})` : ""}; ` +
          "the capability router owns fallback to an alternative provider.",
      };
    }
    case "JOB": {
      const job = getJob(prerequisite.jobId);
      if (!job) {
        return { ...base, satisfied: false, blockedClass: "IMPOSSIBLE", detail: `Job ${prerequisite.jobId} does not exist.` };
      }
      if (job.status === "succeeded") {
        return { ...base, satisfied: true, blockedClass: null, detail: `Job ${job.id} succeeded.` };
      }
      if (job.status === "dead") {
        const revivalMs = job.updatedAt.getTime() + REVIVAL_COOLDOWN_MS;
        return failureClass(job.lastError) === "PERMANENT"
          ? { ...base, satisfied: false, blockedClass: "IMPOSSIBLE", detail: `Job ${job.id} died permanently: ${job.lastError ?? "unknown"}` }
          : {
              ...base,
              satisfied: false,
              blockedClass: "RESOLVABLE_LATER",
              resumeAt: new Date(revivalMs).toISOString(),
              resumeAtMs: revivalMs,
              detail: `Job ${job.id} died transiently; revival after cooldown.`,
            };
      }
      if (job.status === "blocked_dependency") {
        return { ...base, satisfied: false, blockedClass: "IMPOSSIBLE", detail: `Job ${job.id} is cascade-blocked: ${job.lastError ?? "a dependency died"}` };
      }
      return {
        ...base,
        satisfied: false,
        blockedClass: "RESOLVABLE_NOW",
        wakeEvent: "JOB_COMPLETED",
        detail: `${prerequisite.what}: job ${job.id} is ${job.status}.`,
      };
    }
    case "CAPABILITY": {
      const capability = getCapability(prerequisite.capabilityId);
      if (!capability) {
        return {
          ...base,
          satisfied: false,
          blockedClass: "IMPOSSIBLE",
          detail: `Capability ${prerequisite.capabilityId} is not registered — nothing can restore what does not exist.`,
        };
      }
      if (capability.health === "READY" || capability.health === "ACTIVE") {
        return { ...base, satisfied: true, blockedClass: null, detail: `${prerequisite.capabilityId} is ${capability.health}.` };
      }
      return {
        ...base,
        satisfied: false,
        blockedClass: "RESOLVABLE_ON_EVENT",
        wakeEvent: "CAPABILITY_HEALTH_CHANGED",
        detail: `${prerequisite.what}: ${prerequisite.capabilityId} is ${capability.health} (${capability.healthReason}).`,
      };
    }
    case "EXTERNAL_AUTH":
      return { ...base, satisfied: false, blockedClass: "EXTERNAL_REQUIRED", detail: prerequisite.what };
    case "PERMANENT_FACT":
      return { ...base, satisfied: false, blockedClass: "IMPOSSIBLE", detail: prerequisite.why };
  }
  // Exhaustive above; TypeScript narrows every case.
  throw new Error("Unreachable prerequisite kind.");
}

export interface CompositeAssessment {
  ready: boolean;
  blockers: Assessment[];
  /** The dominant class — the single truthful headline Brain gives for the composition. */
  classification: BlockedClass | null;
  /** The MOMENT THE ANSWER CAN NEXT CHANGE, display form of the earliest blocker. Never an ETA for full readiness — event-driven members have none, and one is not invented. */
  nextCheckAt: string | null;
  /** The same moment as an instant — the ONLY field a scheduler may consume. */
  nextCheckAtMs: number | null;
  wakeEvents: string[];
  summary: string;
}

/**
 * Dominance: an impossible member makes the composition impossible; an external need outranks
 * autonomous work; otherwise in-flight remediation is the truest headline, then alternatives,
 * then events, then the clock.
 */
const CLASS_PRECEDENCE: readonly BlockedClass[] = [
  "IMPOSSIBLE",
  "EXTERNAL_REQUIRED",
  "RESOLVABLE_NOW",
  "RESOLVABLE_VIA_ALTERNATIVE",
  "RESOLVABLE_ON_EVENT",
  "RESOLVABLE_LATER",
];

/**
 * Assess a COMPOSITION of prerequisites — the two-concept warm-up rule generalized.
 *
 * An ORB strategy is ready only when the market is open AND the opening window has passed AND
 * the opening bars actually exist. 09:30 arriving alone must never read as ready when the feed
 * missed bars — so readiness is the conjunction, and the report keeps every unsatisfied member
 * visible rather than letting one clock answer for all of them.
 */
export async function assessRequirements(
  prerequisites: readonly Prerequisite[],
  now = new Date(),
): Promise<CompositeAssessment> {
  const assessments: Assessment[] = [];
  for (const prerequisite of prerequisites) {
    assessments.push(await assessPrerequisite(prerequisite, now));
  }
  const blockers = assessments.filter((assessment) => !assessment.satisfied);

  const classification =
    blockers.length === 0
      ? null
      : CLASS_PRECEDENCE.find((cls) => blockers.some((blocker) => blocker.blockedClass === cls)) ?? null;

  // Min over INSTANTS, never over display strings — every assessment carries `resumeAtMs`
  // beside its display form precisely so nothing here ever parses text. (The string-sort bug
  // this replaces: ' ' < 'T', so a same-day exchange-local descriptor beat an earlier ISO
  // instant and a scheduler would have under-polled.)
  const earliest = blockers
    .filter((blocker): blocker is Assessment & { resumeAtMs: number } => blocker.resumeAtMs !== null)
    .sort((a, b) => a.resumeAtMs - b.resumeAtMs)[0] ?? null;

  const wakeEvents = [...new Set(blockers.map((blocker) => blocker.wakeEvent).filter((value): value is string => value !== null))];

  return {
    ready: blockers.length === 0,
    blockers,
    classification,
    nextCheckAt: earliest?.resumeAt ?? null,
    nextCheckAtMs: earliest?.resumeAtMs ?? null,
    wakeEvents,
    summary:
      blockers.length === 0
        ? "All prerequisites satisfied."
        : `${blockers.length} of ${prerequisites.length} prerequisite(s) unsatisfied — ${classification}. ` +
          blockers.map((blocker) => blocker.detail).join(" · "),
  };
}
