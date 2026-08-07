import { desc } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getLearningMode } from "@/lib/governance/runtime";
import { quantCoreStatus } from "@/lib/quantcore/client";
import { generateQuantCoreArtifacts } from "@/lib/quantcore/generate";
import { runFactoryGeneration } from "@/lib/factory/generation";
import { INSTRUMENT_CATALOG } from "@/lib/market/catalog";
import type { Candle } from "@/lib/providers/types";
import { queueStats } from "@/lib/research/queue";
import { runWorker } from "@/lib/research/worker";
import { nextCurriculum, masteryByPlane } from "./curriculum";
import { seedQuizBank } from "./quiz-bank";
import { proposalStats } from "./evolution";
import { inspectMemory, type IntrospectionReport } from "./introspection";
import { runValidationRehearsal, type CandleLoader, type RehearsalReport } from "./rehearsal";
import { fetchInstrumentBars, fetchMarketSample, marketCandleLoader } from "./dataset";
import { recordCycleRun } from "./run-log";
import { withCycleLease, type LeaseHolder } from "./lease";
import { promotionPass } from "@/lib/strategy/promotion";

export interface CycleReport {
  mode: string;
  ranAt: string;
  worker: { processed: number; succeeded: number; failed: number; dead: number } | null;
  queue: Record<string, number>;
  proposals: Record<string, number>;
  studyQueue: { conceptId: string; name: string; reason: string }[];
  mastery: { plane: string; studied: number; concepts: number; averageScore: number }[];
  // Null when the cycle did not run. Zero would be a measurement, and a refused cycle measured
  // nothing — reporting "0 open failures" or "quant core unreachable" from a call that never
  // looked is exactly the fabrication this system refuses everywhere else.
  openFailures: number | null;
  quantCore: { reachable: boolean; stale: boolean; mode: string | null } | null;
  /** What the system found wrong with its own memory. Null when the cycle did not run. */
  introspection: IntrospectionReport | null;
  /** What the gauntlet *would* say. Records nothing; null below `learning`. */
  rehearsal: RehearsalReport | null;
  actions: string[];
  skipped: string[];
  /**
   * Set when another driver already held the cycle lease, so this call did nothing.
   *
   * Null is the normal case and means "this call ran". A refused cycle is not a failure and not
   * an idle cycle — it is the lease working — but it must be distinguishable from both, or a
   * driver that never wins will look identical to a driver that runs and finds nothing to do.
   */
  blockedBy?: LeaseHolder | null;
}

/**
 * One learning-mode iteration. Each mode does strictly more than the one below it:
 *
 *   off        nothing runs
 *   observing  read-only: gather state, surface what is due, propose nothing
 *   learning   plus: drain the research queue and extract knowledge
 *   evolving   plus: raise code and strategy proposals for human review
 *
 * Nothing here can approve or merge anything — that requires the owner.
 */
export async function runLearningCycle(
  workerId = "learning-cycle",
  // Defaults to the real provider. A null-returning default would have made every rehearsal
  // report "no data" in production while passing every test that injected a loader.
  loadCandles: CandleLoader = marketCandleLoader(),
  /**
   * Bars for the quant-core generation pass. Injectable for the same reason `loadCandles` is:
   * without it a cycle test reaches the network, which made the suite depend on a provider being
   * up and turned a queue-draining assertion into a five-second timeout under parallel load.
   */
  loadEvidence: EvidenceLoader = marketEvidence,
): Promise<CycleReport> {
  // The lease is taken here rather than in each driver. The browser path runs through
  // `app/api/learning/cycle/`, which is owner-reviewed and cannot be edited by an agent — so a
  // guard placed in the drivers would cover the scheduler and the daemon and silently miss the
  // one driver that is open all day. There is exactly one body, so there is exactly one lease.
  const outcome = await withCycleLease(workerId, async () => {
    // The body has four exits, one per mode tier. Recording inside it would mean four call sites
    // and, eventually, one of them forgotten — which is precisely how a loop ends up running with
    // no trace that it ran.
    const startedAt = Date.now();
    const report = await runCycleBody(workerId, loadCandles, loadEvidence);
    try {
      recordCycleRun(report, Date.now() - startedAt, workerId);
    } catch {
      // A failure to write the log must not fail the cycle. The work already happened; losing the
      // record of it is worse than not doing the work only if it silently loses the work too.
    }
    return report;
  });

  if (outcome.result !== null) return outcome.result;

  // Refused. Deliberately *not* written to the run log: a no-op recorded as a cycle would inflate
  // "cycles today" with work that never happened, which is the exact dishonesty the run log was
  // built to end.
  const holder = outcome.blockedBy;
  return {
    ...emptyReport(getLearningMode()),
    blockedBy: holder,
    skipped: [
      holder
        ? `Another driver (${holder.holder}) has been running a cycle since ${new Date(holder.acquiredAt).toISOString()}. This call did nothing.`
        : "Another driver holds the cycle lease. This call did nothing.",
    ],
  };
}

/**
 * One market fetch, serving both the signal scan and the regime read.
 *
 * Deliberately not two calls. The scan needs the universe's bars and the regime needs a broad
 * proxy's bars, and the proxy is *in* the universe — fetching separately would pull QQQ twice per
 * cycle, and worse, would give the two artifacts different as-of dates whenever a fetch landed
 * either side of a bar close.
 *
 * Empty on any failure, and every downstream consumer refuses on empty rather than defaulting:
 * `classifyRegime` returns null, `scanForSignals` evaluates nothing.
 */
export interface MarketEvidence {
  dataset: Readonly<Record<string, readonly Candle[]>>;
  reference: readonly Candle[];
}

export type EvidenceLoader = () => Promise<MarketEvidence>;

async function marketEvidence(): Promise<MarketEvidence> {
  try {
    const dataset = await fetchMarketSample("US", "D");
    // QQQ rather than a single company: a regime read off one name's volatility is that name's
    // regime, not the market's.
    const proxy = INSTRUMENT_CATALOG.find((instrument) => instrument.symbol === "QQQ");
    if (!proxy) return { dataset, reference: [] };

    // Reused when the sample happens to contain it, fetched otherwise. The sample is the first
    // twelve catalog entries and QQQ is the thirteenth, so in practice this is a second call —
    // but written as a lookup first so it costs nothing if the catalog is ever reordered.
    const reference = dataset[proxy.id] ?? (await fetchInstrumentBars(proxy, "D"));
    return { dataset, reference };
  } catch {
    return { dataset: {}, reference: [] };
  }
}

/**
 * The shape of a cycle that did not run.
 *
 * Measurements are `null`, never `0`. Zero is a finding — "the quant core is unreachable", "there
 * are no open failures" — and this call looked at neither. Collections are empty because "none
 * listed" is true of a list nobody built, which is not the same kind of claim.
 *
 * `mode` is genuinely read: it is one indexed row and it is the one fact still worth reporting.
 */
function emptyReport(mode: string): CycleReport {
  return {
    mode,
    ranAt: new Date().toISOString(),
    worker: null,
    queue: {},
    proposals: {},
    studyQueue: [],
    mastery: [],
    openFailures: null,
    quantCore: null,
    introspection: null,
    rehearsal: null,
    actions: [],
    skipped: [],
    blockedBy: null,
  };
}

async function runCycleBody(
  workerId: string,
  loadCandles: CandleLoader,
  loadEvidence: EvidenceLoader,
): Promise<CycleReport> {
  const mode = getLearningMode();
  const actions: string[] = [];
  const skipped: string[] = [];

  // Refreshed before the status is read, so a cycle reports the artifacts it just produced rather
  // than the previous pass's. Gated at `learning` because generation writes files, and `observing`
  // is defined as read-only — a mode that quietly wrote to disk would make the ladder a fiction.
  // Hoisted: the quant-core pass and the factory both need bars, and fetching twice in one cycle
  // would double the provider load and let the two artifacts disagree about what "today" is.
  let evidence: MarketEvidence = { dataset: {}, reference: [] };

  if (mode === "learning" || mode === "evolving") {
    try {
      evidence = await loadEvidence();
      const generated = generateQuantCoreArtifacts({
        referenceCandles: evidence.reference,
        dataset: evidence.dataset,
      });
      actions.push(
        `Refreshed ${generated.written.length} quant-core artifact(s) from this system's own evidence.`,
      );
      // Capped: a scan over twelve instruments × several strategies can produce a warm-up refusal
      // for every pair, and a hundred near-identical lines would bury the rest of the report.
      const omissions = generated.skipped;
      for (const omission of omissions.slice(0, 5)) {
        skipped.push(`Quant core "${omission.resource}" — ${omission.reason}`);
      }
      if (omissions.length > 5) {
        skipped.push(`Quant core: ${omissions.length - 5} further refusal(s) not listed here.`);
      }
    } catch (caught) {
      // Generation failing must not fail the cycle. The reader then finds last pass's artifacts,
      // which are stale and will be badged as such — strictly better than no cycle at all.
      skipped.push(
        `Quant-core artifacts could not be regenerated: ${caught instanceof Error ? caught.message.split("\n")[0] : String(caught)}`,
      );
    }
  }

  const quantCore = await quantCoreStatus();
  const failures = getDb()
    .select()
    .from(schema.failureMemory)
    .orderBy(desc(schema.failureMemory.id))
    .all();

  const report: CycleReport = {
    mode,
    ranAt: new Date().toISOString(),
    worker: null,
    queue: queueStats(),
    proposals: proposalStats(),
    studyQueue: [],
    mastery: [],
    openFailures: failures.filter((failure) => !failure.lesson).length,
    quantCore: { reachable: quantCore.reachable, stale: quantCore.stale, mode: quantCore.mode },
    introspection: null,
    rehearsal: null,
    actions,
    skipped,
  };

  if (mode === "off") {
    skipped.push("Learning mode is off; no work was performed.");
    return report;
  }

  // Seeded before the study queue is read, so a first run has something to offer rather than an
  // empty curriculum. Idempotent, and it never rewrites an existing question — an owner who edits
  // one by hand does not have it reverted fifteen minutes later.
  //
  // At `learning` and above only, for the same reason generation is: it writes.
  if (mode === "learning" || mode === "evolving") {
    try {
      const bank = seedQuizBank();
      if (bank.quizzesWritten > 0) {
        actions.push(`Seeded ${bank.quizzesWritten} graded quiz question(s) into the study bank.`);
      }
    } catch (caught) {
      skipped.push(
        `The quiz bank could not be seeded: ${caught instanceof Error ? caught.message.split("\n")[0] : String(caught)}`,
      );
    }
  }

  // observing and above: surface what needs attention.
  report.studyQueue = nextCurriculum(undefined, 5).map((item) => ({
    conceptId: item.conceptId,
    name: item.name,
    reason: item.reason,
  }));
  report.mastery = masteryByPlane().map((entry) => ({
    plane: entry.plane,
    studied: entry.studied,
    concepts: entry.concepts,
    averageScore: entry.averageScore,
  }));
  actions.push("Collected system state, study queue and mastery.");

  // Read-only, so it belongs at observing: the system checking whether its own memory is in
  // order needs no permission beyond looking. Orphaned knowledge and repeated failure modes
  // are invisible in every other view, because nothing links to them.
  report.introspection = inspectMemory();
  actions.push(report.introspection.summary);

  // The promotion ladder, at `observing` because it only reads. Every rung is crossed by evidence
  // written elsewhere, so this persists nothing — it says what the evidence now means, which is
  // exactly what was absent while five strategies sat at `draft` and nothing explained why.
  const promotion = promotionPass();
  actions.push(promotion.summary);
  for (const entry of promotion.advanced) {
    actions.push(`${entry.name} is at ${entry.stage}: ${entry.because}`);
  }

  // Named precisely, because these three states have three different remedies and the loop used
  // to print "unreachable" for all of them. On a machine with no quant core installed that reads
  // as a fault repeating every cycle forever, when in fact nothing is wrong: the quant core is a
  // separate Python service, owned by a different agent, and this system is fully functional
  // without it. It contributes candidate review — one optional input, not the loop itself.
  if (quantCore.disabled) {
    skipped.push("Quant core is switched off (QUANT_CORE_URL=off). Candidate review is not part of this install.");
  } else if (!quantCore.reachable) {
    skipped.push(
      `Quant core did not answer, so candidate review was skipped rather than guessed. ${quantCore.message ?? ""}`.trim(),
    );
  } else if (quantCore.stale) {
    skipped.push("Quant core data is stale; treat candidates as historical.");
  }

  if (mode === "observing") {
    skipped.push("Observing mode: the research queue was not drained and no proposals were raised.");
    return report;
  }

  // learning and above: do the deterministic work.
  const worker = await runWorker(workerId, 10);
  report.worker = worker;
  report.queue = queueStats();
  actions.push(`Processed ${worker.processed} research job(s).`);
  if (worker.dead > 0) {
    actions.push(`${worker.dead} job(s) exhausted retries and were written to failure memory.`);
  }

  // Replay and simulation are READ actions permitted at `learning`, and neither costs anything
  // to repeat. Running the gauntlet here instead would spend a trial and consume the holdout
  // budget on every cycle — irreversible, and on nobody's instruction.
  report.rehearsal = await runValidationRehearsal(loadCandles, mode);
  actions.push(report.rehearsal.summary);
  skipped.push(...report.rehearsal.skipped);

  if (mode === "learning") {
    // Not a defect and not a missing feature — this is the mode ladder doing its job. Worth
    // saying so explicitly: a line that reads like a failure on every single pass trains the
    // owner to ignore the skip list, which is where the real refusals appear.
    skipped.push(
      "Proposals are off at this mode by design, not because anything failed. " +
        "Set the mode to evolving on /learning to let the system draft code and strategy proposals for your review.",
    );
    return report;
  }

  // evolving: the factory breeds. Not at `learning`, because a generation writes strategy specs
  // and spends trial budget for the family it breeds into — that is a proposal in everything but
  // name, and proposals are what `evolving` exists to authorise.
  try {
    const factory = runFactoryGeneration({ dataset: evidence.dataset });
    if (factory.skipped) {
      skipped.push(`Strategy factory generation ${factory.generation} did not run — ${factory.skipped}`);
    } else {
      actions.push(
        `Factory generation ${factory.generation}: bred ${factory.bred}, screened ${factory.screened}, ` +
          `${factory.survivors.length} survivor(s) recorded as draft. Selection cost ${factory.selectionCost} — ` +
          `that is the multiple-testing denominator any gauntlet on these must carry.`,
      );
      if (factory.rediscovered > 0) {
        actions.push(`${factory.rediscovered} bred candidate(s) matched buried strategies and were discarded.`);
      }
    }
  } catch (caught) {
    skipped.push(
      `The strategy factory did not run: ${caught instanceof Error ? caught.message.split("\n")[0] : String(caught)}`,
    );
  }

  // evolving: proposals are prepared, never applied.
  report.proposals = proposalStats();
  actions.push(
    "Evolving mode is active. Proposals may be raised and reviewed, but only the owner can approve or merge them.",
  );
  return report;
}
