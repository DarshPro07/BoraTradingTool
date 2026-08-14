import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getLearningMode } from "@/lib/governance/runtime";
import { quantCoreStatus } from "@/lib/quantcore/client";
import { generateQuantCoreArtifacts } from "@/lib/quantcore/generate";
import { runFactoryGeneration } from "@/lib/factory/generation";
import { findCurrentInstrument, listCurrentInstruments } from "@/lib/market/catalog";
import { accumulateIntraday, accumulationDue, markAccumulated } from "@/lib/market/intraday-accumulator";
import { loadStoredCandles } from "@/lib/market/candle-store";
import type { Market } from "@/lib/market/types";
import { breedingBasis, OWNER_CAPITAL } from "@/lib/paper/capital";
import type { Candle } from "@/lib/providers/types";
import { produceResearchJobs, type ProduceResult } from "@/lib/research/producer";
import { queueStats } from "@/lib/research/queue";
import { runWorker } from "@/lib/research/worker";
import { nextCurriculum, masteryByPlane } from "./curriculum";
import { seedQuizBank } from "./quiz-bank";
import { proposalStats } from "./evolution";
import { inspectMemory, type IntrospectionReport } from "./introspection";
import { runValidationRehearsal, storeDatasetSource, type RehearsalReport } from "./rehearsal";
import { runShadowPass } from "@/lib/forward/shadow";
import { evaluateAutonomousAction } from "@/lib/governance/policy";
import { archiveCurrentForecasts, scoreDueForecasts } from "@/lib/forecast/live";
import { fetchInstrumentBars, fetchMarketSample, marketCandleLoader, type CandleLoader } from "./dataset";
import { recordCycleRun } from "./run-log";
import { runSelfRepair } from "./self-repair";
import { withCycleLease, type LeaseHolder } from "./lease";
import { emit } from "@/lib/brain/event-bus";
import { promotionPass } from "@/lib/strategy/promotion";
import { runAutonomousGauntlet } from "@/lib/strategy/auto-gauntlet";
import { isIntradayResolution } from "@/lib/strategy/dsl";
import { authorFromHypotheses } from "@/lib/research/hypothesis-author";
import { learningMetrics, type LearningMetrics } from "./metrics";
import { nextBarWake, type CycleReason } from "./reasons";
import { runForwardDriver } from "@/lib/strategy/forward-driver";
import { boardSummary, buildTradeBoard } from "@/lib/execution/board";

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
  /**
   * Today's trade board. Null when the cycle did not run, and `{ eligible: 0 }` when it ran and
   * found nothing at owner review — the same distinction every other field here makes.
   */
  board: { eligible: number; proposals: number; awaitingConfirmation: number; summary: string } | null;
  /**
   * The guarded trial pass. Null when the cycle did not reach it.
   *
   * `spent: false` with `recommended` set is the normal state and is not a failure — it is the
   * governance allowlist refusing an autonomous trial, which is what it exists to do.
   */
  autoGauntlet: {
    policyAllowed: boolean;
    eligible: number;
    spent: boolean;
    recommended: string | null;
    summary: string;
  } | null;
  /**
   * Is the system getting anywhere? Null when the cycle did not run.
   *
   * Separate from `actions`, which records what happened. This records what it *established* —
   * the two rise independently, and a loop that confuses them looks healthy while stalled.
   */
  metrics: LearningMetrics | null;
  actions: string[];
  skipped: string[];
  /**
   * The subset of `skipped` that is INFRASTRUCTURE IMPAIRMENT — a step that crashed, a store
   * write that failed, a subsystem that threw — as opposed to a workflow that is merely waiting
   * or ineligible.
   *
   * The distinction exists because the supervisor used to derive run health from
   * `skipped.length > 0`, and `skipped` mixes both kinds: "No strategy exists to consider" and
   * "Quant core is switched off (QUANT_CORE_URL=off)" sat beside "Rehearsal verdicts could not
   * be recorded: <db error>". The owner's machine therefore reported DEGRADED on every single
   * tick of a perfectly healthy install, which teaches the operator to ignore DEGRADED — the
   * one state that must never become background noise.
   *
   * Membership is mechanical, not editorial: a reason recorded from a `catch` block is
   * impairment; a reason recorded on a normal code path is eligibility. That rule needs no
   * judgement calls about wording and cannot drift as messages are reworded.
   */
  impaired: string[];
  /**
   * Typed reasons — the classification made where the knowledge is.
   *
   * The mechanical catch-rule above is blind to impairments that do not throw: a quant core that
   * answers a structured "not reachable", a provider that returns 200 with nothing in it. Those
   * sites now record a typed reason carrying category and severity, and the supervisor derives
   * health from THIS list (plus `impaired`, which every catch block also mirrors here). The
   * string lists stay — they feed the UI and the run log — reasons ride beside them.
   */
  reasons: CycleReason[];
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
  /**
   * Research intake. Injectable for the same reason the two loaders above are: it reaches arXiv,
   * and a cycle test that quietly fetches five real papers stops testing the cycle and starts
   * testing the network — which is exactly how `drains the queue in learning mode` began
   * reporting six processed jobs instead of the one it enqueued.
   */
  produce: ResearchProducer = produceResearchJobs,
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
    const report = await runCycleBody(workerId, loadCandles, loadEvidence, produce);
    try {
      recordCycleRun(report, Date.now() - startedAt, workerId);
    } catch {
      // A failure to write the log must not fail the cycle. The work already happened; losing the
      // record of it is worse than not doing the work only if it silently loses the work too.
    }
    emit({ kind: "LEARNING_CYCLE_COMPLETED", cycleId: `lc_${Date.now()}`, actions: report.actions.length, skipped: report.skipped.length });
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
/** Every market the loop is responsible for. India first: it is the one the owner trades. */
export const MARKETS = ["IN", "US"] as const satisfies readonly Market[];

/**
 * The broad instrument whose volatility stands for each market's regime.
 *
 * NIFTYBEES tracks the NIFTY 50; QQQ tracks the Nasdaq 100. Reading a regime off one company
 * measures that company.
 */
export const REGIME_PROXIES: Readonly<Record<Market, string>> = Object.freeze({
  IN: "NIFTYBEES",
  US: "QQQ",
});

export interface MarketEvidence {
  /** Both markets, merged. Ids are market-prefixed, so keys never collide. */
  dataset: Readonly<Record<string, readonly Candle[]>>;
  /**
   * The US proxy, kept for callers that predate multi-market evidence.
   *
   * @deprecated Read `references[market]` instead — this one silently answers "US" for a system
   * whose owner trades NSE.
   */
  reference: readonly Candle[];
  /** Regime proxy bars per market. Absent means the fetch failed, not that volatility was zero. */
  references: Partial<Record<Market, readonly Candle[]>>;
}

export type EvidenceLoader = () => Promise<MarketEvidence>;

/** Fills the research queue. See `lib/research/producer.ts`. */
export type ResearchProducer = () => Promise<ProduceResult>;

/**
 * Realised bars for grading a forecast, resolved through the catalog.
 *
 * Returns empty for an instrument the catalog does not know rather than throwing: a forecast for
 * a delisted or renamed symbol should stay pending and visible, not take the whole validation
 * pass down with it.
 */
async function forecastBars(instrumentId: string): Promise<readonly { time: number; close: number }[]> {
  const instrument = findCurrentInstrument(instrumentId);
  if (!instrument) return [];
  const bars = await fetchInstrumentBars(instrument, "D");
  return bars.map((bar) => ({ time: bar.time, close: bar.close }));
}

async function marketEvidence(): Promise<MarketEvidence> {
  // Both markets, every cycle.
  //
  // This fetched only "US". The catalog holds 30 Indian instruments against 22 American ones, the
  // owner trades NSE with rupees through Zerodha, and the entire autonomous loop — quant-core
  // artifacts, the factory's population, the rehearsal, the trade board — was reading a market
  // they do not trade. India was absent from everything autonomous while being the whole point.
  //
  // Instrument ids are market-prefixed (`IN:XNSE:RELIANCE`, `US:XNAS:AAPL`), so one merged map
  // serves both without collision and every downstream consumer filters by `universe.market`
  // already.
  const dataset: Record<string, readonly Candle[]> = {};
  const references: Partial<Record<Market, readonly Candle[]>> = {};

  // A failure in one market must not cost the other its evidence. Fetched independently for that
  // reason rather than in one try block.
  for (const market of MARKETS) {
    try {
      Object.assign(dataset, await fetchMarketSample(market, "D"));
    } catch {
      // Left absent rather than defaulted. A market with no bars is reported as such downstream.
    }
  }

  for (const [market, symbol] of Object.entries(REGIME_PROXIES) as [Market, string][]) {
    try {
      const proxy = listCurrentInstruments({ market }).find((instrument) => instrument.symbol === symbol);
      if (!proxy) continue;
      // A broad ETF, not a single company: a regime read off one name's volatility is that name's
      // regime, not the market's.
      references[market] = dataset[proxy.id] ?? (await fetchInstrumentBars(proxy, "D"));
    } catch {
      // Same reasoning — one market's proxy failing must not blank the other's regime.
    }
  }

  return { dataset, reference: references.US ?? [], references };
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
    board: null,
    autoGauntlet: null,
    metrics: null,
    actions: [],
    skipped: [],
    impaired: [],
    reasons: [],
    blockedBy: null,
  };
}

async function runCycleBody(
  workerId: string,
  loadCandles: CandleLoader,
  loadEvidence: EvidenceLoader,
  produce: ResearchProducer,
): Promise<CycleReport> {
  const mode = getLearningMode();
  const actions: string[] = [];
  const skipped: string[] = [];
  const impaired: string[] = [];
  const reasons: CycleReason[] = [];
  /** A typed note: the reason list gets the classification, `skipped` gets the sentence. */
  const note = (reason: CycleReason) => {
    reasons.push(reason);
    skipped.push(reason.message);
  };
  /** For catch blocks only: the reason lands in every ledger — a note AND an impairment. */
  const impair = (reason: string, code = "STEP_FAILED") => {
    skipped.push(reason);
    impaired.push(reason);
    reasons.push({ code, category: "INFRASTRUCTURE", severity: "DEGRADED", message: reason });
  };

  // Refreshed before the status is read, so a cycle reports the artifacts it just produced rather
  // than the previous pass's. Gated at `learning` because generation writes files, and `observing`
  // is defined as read-only — a mode that quietly wrote to disk would make the ladder a fiction.
  // Hoisted: the quant-core pass and the factory both need bars, and fetching twice in one cycle
  // would double the provider load and let the two artifacts disagree about what "today" is.
  let evidence: MarketEvidence = { dataset: {}, reference: [], references: {} };

  if (mode === "learning" || mode === "evolving") {
    try {
      evidence = await loadEvidence();
      // The owner's market, not "US".
      //
      // `universeArtifact` defaulted to US, so the quant core was handed a universe of 22 American
      // names while the owner trades 30 Indian ones with rupees. The artifact layout holds one
      // universe at a fixed path (`data/universe.json`) and that path is part of the protected
      // quant-core contract, so this names the right market rather than restructuring the seam —
      // a two-market artifact is a contract change, not a cycle change.
      //
      // The regime proxy follows the same market, or a NIFTY regime would be read off the Nasdaq.
      const generated = generateQuantCoreArtifacts({
        market: OWNER_CAPITAL.market,
        referenceCandles: evidence.references[OWNER_CAPITAL.market] ?? evidence.reference,
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
      // Warm-up is a WAITING state with a knowable wake time, not a fault: nothing changes until
      // the market can produce new bars, and the Market Clock knows when that is.
      const warmups = omissions.filter((omission) => /warm-?up/i.test(omission.reason)).length;
      if (warmups > 0) {
        const wake = nextBarWake(OWNER_CAPITAL.market);
        reasons.push({
          code: "STRATEGY_WARMUP",
          category: "ELIGIBILITY",
          severity: "INFO",
          message: `${warmups} strategy×instrument pair(s) inside their warm-up window.`,
          resumeAt: wake?.display,
          resumeAtMs: wake?.epochMs,
        });
      }
    } catch (caught) {
      // Generation failing must not fail the cycle. The reader then finds last pass's artifacts,
      // which are stale and will be badged as such — strictly better than no cycle at all.
      impair(
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
    board: null,
    autoGauntlet: null,
    metrics: null,
    actions,
    skipped,
    impaired,
    reasons,
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
      impair(
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

  // Does the paper account describe the account the owner actually has?
  //
  // It was seeded at ₹1,00,00,000 against a stated ₹1,000 — ten thousand times over. At a crore
  // every position is large enough that costs round to nothing, which is the one regime the owner
  // is not in, so every paper result answered a question about somebody else's account. Checked
  // every cycle rather than fixed once, because a reseed or a restored backup puts it back.
  try {
    const inr = getDb()
      .select()
      .from(schema.paperAccounts)
      .where(eq(schema.paperAccounts.currency, "INR"))
      .get();
    if (inr && Math.abs(inr.startingCash - OWNER_CAPITAL.amount) > 1) {
      skipped.push(
        `The INR paper account starts at ${inr.startingCash.toLocaleString("en-IN")} but the owner's ` +
          `stated capital is ${OWNER_CAPITAL.amount.toLocaleString("en-IN")}. Paper results describe an ` +
          `account that does not exist. Run \`npx tsx scripts/set-paper-capital.mts\` to align them.`,
      );
    }
  } catch {
    // A missing paper account is not a cycle failure; the paper screens report it themselves.
  }

  // Keep the intraday history the provider is about to forget.
  //
  // The one thing that actually removes the intraday ceiling under a free-data constraint. Yahoo
  // serves a sliding window — sixty days at five minutes — and this file's sibling states the
  // consequence: an intraday strategy cannot be validated on sixty days, and waiting never fixes
  // it because the window slides. It stops sliding the moment something keeps what falls off the
  // back. Run daily, the store outgrows the provider's window within a quarter, and the history is
  // assembled rather than purchased.
  //
  // Only settled bars — prior sessions, never today's — so this never becomes a second source of
  // truth about the present. See `lib/market/intraday-accumulator.ts`.
  // Once a session, not once a cycle: 12 instruments × 3 resolutions is 36 requests, and at
  // fifteen-minute intervals that is 96 passes a day to learn that nothing new has settled. That
  // load is what rate-limited the feed earlier and made the rehearsal report "No stored candles"
  // for a market whose data was fine.
  if ((mode === "learning" || mode === "evolving") && accumulationDue()) {
    try {
      const accumulated = await accumulateIntraday(
        listCurrentInstruments({ market: OWNER_CAPITAL.market }).slice(0, 12),
      );
      markAccumulated(accumulated, workerId);
      if (accumulated.inserted > 0) actions.push(accumulated.summary);
      else skipped.push(accumulated.summary);
    } catch (caught) {
      impair(
        `Intraday accumulation did not run: ${caught instanceof Error ? caught.message.split("\n")[0] : String(caught)}`,
      );
    }
  }

  // Fix what is provably broken; report what is the owner's call.
  //
  // At `learning` and above, because it writes. The line it holds matters more than the repairs
  // it makes: a declared cost below the published schedule is wrong by arithmetic and is fixed,
  // while the paper account disagreeing with the owner's stated capital is equally wrong and is
  // only ever reported — nothing here can know which figure the owner means, and a loop that
  // rewrites either has decided how much money they have.
  if (mode === "learning" || mode === "evolving") {
    try {
      const repair = runSelfRepair(workerId);
      if (repair.repairs.length > 0) actions.push(repair.summary);
      for (const item of repair.repairs) {
        if (item.outcome === "repaired") actions.push(`Self-repair · ${item.subject}: ${item.detail}`);
        else skipped.push(`Self-repair · ${item.subject}: ${item.detail}`);
      }
    } catch (caught) {
      impair(
        `Self-repair did not run: ${caught instanceof Error ? caught.message.split("\n")[0] : String(caught)}`,
      );
    }
  }

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
  // The NAMED next action for gauntlet survivors. Reported, never enqueued: the governance
  // table has no autonomous action for challenger activation, so the paper stage starts only by
  // an explicit owner/API enqueue of the durable `forward_enroll` kind (confirmed:true) — this
  // line is what turns a silent stall into a stated path.
  for (const entry of promotion.forwardEnrollable) {
    actions.push(
      `${entry.name} is enrollable for forward observation — enqueue forward_enroll {specId: "${entry.specId}", confirmed: true} to start the paper stage.`,
    );
  }
  // The sealed-holdout path, STATED per universe whenever validated strategies are waiting on it.
  // Reported, never enqueued — sealing and authorizing are owner acts, and the machine's job is
  // to make the next one obvious rather than to take it.
  if (promotion.advanced.some((entry) => entry.stage === "validated")) {
    const { listSeals } = await import("@/lib/research-data/holdout-seal");
    const seals = listSeals();
    const live = seals.filter((seal) => seal.state === "SEALED" || seal.state === "AUTHORIZED_FOR_EVALUATION");
    if (live.length === 0) {
      actions.push(
        "Validated strategies await the sealed holdout, and no live seal exists — POST /api/strategy/holdout to seal a window (generation " +
          `${1 + seals.reduce((max, seal) => Math.max(max, seal.generation), 0)}).`,
      );
    } else {
      for (const seal of live) {
        actions.push(
          seal.state === "SEALED"
            ? `Holdout ${seal.id} (${seal.market}/${seal.resolution}, gen ${seal.generation}) is SEALED — authorize it (confirm) to permit its one evaluation.`
            : `Holdout ${seal.id} (${seal.market}/${seal.resolution}, gen ${seal.generation}) is AUTHORIZED — enqueue holdout_decision {specId, confirmed: true} for the chosen validated strategy.`,
        );
      }
    }
  }

  // Named precisely, because these three states have three different remedies and the loop used
  // to print "unreachable" for all of them. On a machine with no quant core installed that reads
  // as a fault repeating every cycle forever, when in fact nothing is wrong: the quant core is a
  // separate Python service, owned by a different agent, and this system is fully functional
  // without it. It contributes candidate review — one optional input, not the loop itself.
  if (quantCore.disabled) {
    note({
      code: "QUANT_CORE_DISABLED",
      category: "ELIGIBILITY",
      severity: "INFO",
      message: "Quant core is switched off (QUANT_CORE_URL=off). Candidate review is not part of this install.",
    });
  } else if (!quantCore.reachable) {
    // A structured "did not answer" is an impairment that never throws — the exact class the
    // catch-block rule is blind to. A CONFIGURED quant core that is not answering degrades the
    // run; a deliberately disabled one (above) is eligibility.
    note({
      code: "QUANT_CORE_UNREACHABLE",
      category: "INFRASTRUCTURE",
      severity: "DEGRADED",
      message:
        `Quant core did not answer, so candidate review was skipped rather than guessed. ${quantCore.message ?? ""}`.trim(),
    });
  } else if (quantCore.stale) {
    note({
      code: "QUANT_CORE_STALE",
      category: "INFRASTRUCTURE",
      severity: "WARNING",
      message: "Quant core data is stale; treat candidates as historical.",
    });
  }

  if (mode === "observing") {
    skipped.push("Observing mode: the research queue was not drained and no proposals were raised.");
    return report;
  }

  // learning and above: do the deterministic work.
  //
  // Production runs *before* draining, so work found this pass is also done this pass rather than
  // waiting fifteen minutes for the next one. This is the arrow that was missing: `runWorker` has
  // always drained correctly, but `enqueue` was reachable only from the MCP server, one API route
  // and a test — every one of which needs a human. The loop turned on schedule with nothing to
  // turn on, which is the whole of "it learns but is not autonomous".
  try {
    const produced = await produce();
    if (produced.failed) skipped.push(produced.reason);
    else actions.push(produced.reason);
  } catch (caught) {
    // Belt and braces: `produceResearchJobs` refuses rather than throwing, but a cycle must not
    // be brought down by its own intake either way.
    impair(
      `Research intake did not run: ${caught instanceof Error ? caught.message.split("\n")[0] : String(caught)}`,
    );
  }

  // Grade yesterday's forecasts against what actually happened.
  //
  // The only unbiased evidence this system can produce cheaply: the prediction was on disk before
  // the outcome existed, so lookahead is structurally impossible rather than merely guarded. It
  // costs no capital and places no order, which is why it belongs at `learning` rather than
  // higher. `scoreForecast` had been correct and uncalled since it was written — the runner
  // overwrote each forecast before it could ever be graded.
  try {
    const archived = archiveCurrentForecasts();
    const scoring = await scoreDueForecasts(forecastBars);
    if (archived > 0) actions.push(`${archived} forecast(s) archived and awaiting a grade.`);
    if (scoring.scored > 0 || scoring.verdict) {
      actions.push(
        `Forecast validation: graded ${scoring.scored}, ${scoring.pending} still awaiting bars. ${scoring.reason}`,
      );
    } else if (scoring.pending > 0) {
      // Awaiting FUTURE bars is the healthiest state a forecast can be in — the prediction was
      // written before its outcome existed, which is the whole evidential point. The reason
      // carries when the next bar can arrive, so waiting names its wake time.
      const wake = nextBarWake(OWNER_CAPITAL.market);
      note({
        code: "FORECAST_AWAITING_BARS",
        category: "ELIGIBILITY",
        severity: "INFO",
        message: `Forecast validation: ${scoring.pending} prediction(s) awaiting bars. ${scoring.reason}`,
        resumeAt: wake?.display,
        resumeAtMs: wake?.epochMs,
      });
    }
  } catch (caught) {
    impair(
      `Forecast validation did not run: ${caught instanceof Error ? caught.message.split("\n")[0] : String(caught)}`,
    );
  }

  const worker = await runWorker(workerId, 10);
  report.worker = worker;
  report.queue = queueStats();
  actions.push(`Processed ${worker.processed} research job(s).`);
  if (worker.dead > 0) {
    actions.push(`${worker.dead} job(s) exhausted retries and were written to failure memory.`);
  }

  // Turn hypotheses into testable strategies — the last break in the research chain.
  //
  // Placed after the worker so a hypothesis formed from a source ingested this pass is considered
  // on the same pass rather than fifteen minutes later. Most hypotheses are refused, and that is
  // the expected output: of the three this system has formed, two are not expressible as strategies
  // at all. See `lib/research/hypothesis-triage.ts`.
  try {
    const authored = await authorFromHypotheses(workerId);
    if (authored.considered > 0) actions.push(`Hypotheses: ${authored.summary}`);
  } catch (caught) {
    impair(
      `Authoring from hypotheses did not run: ${caught instanceof Error ? caught.message.split("\n")[0] : String(caught)}`,
    );
  }

  // Replay and simulation are READ actions permitted at `learning`, and neither costs anything
  // to repeat. Running the gauntlet here instead would spend a trial and consume the holdout
  // budget on every cycle — irreversible, and on nobody's instruction.
  // Serve the rehearsal from bars this cycle already fetched.
  //
  // `loadEvidence` pulls the US daily sample for the quant-core pass, and the rehearsal's own
  // loader then pulled it again a few seconds later — two provider calls for the same twelve
  // series, every fifteen minutes. The second one is what rate-limits: the rehearsal reported
  // "No stored candles" and every US candidate came back `not_evaluable` from a self-inflicted
  // outage.
  //
  // Reusing the fetch also makes the two agree. Fetching twice let the artifacts and the rehearsal
  // straddle a bar close and disagree about what the last bar was.
  //
  // Serves both markets: `evidence.dataset` now merges IN and US, and the rehearsal filters by
  // the strategy's own universe. Checking for "US" here — as this did — meant an NSE candidate
  // fell through to a second provider call for bars already in memory, which is the one that
  // rate-limits.
  // 13b: rehearsal reads recorded snapshots from the canonical store — never the provider, and
  // never the quant-core pass's daily sample (which is live-view data with no snapshot identity).
  // A provider outage now cannot even be *expressed* here; only "the store has no bars", which is
  // an ingestion task the report names.
  report.rehearsal = await runValidationRehearsal(storeDatasetSource, mode);
  actions.push(report.rehearsal.summary);
  skipped.push(...report.rehearsal.skipped);

  // Persist what the rehearsal concluded, so the ladder can act on it.
  //
  // The rehearsal has always produced exactly the four verdicts `advanceStrategy`'s `draft` rung
  // handles, and has always thrown them away — `evidenceFor` read `validation_results`, which only
  // the gauntlet writes. So every strategy reported "Not yet rehearsed" forever while the Strategy
  // Lab funnel counted five rehearsed, and nothing could leave `draft` without a human spending a
  // trial. The loop was autonomous everywhere except the one place that decides anything.
  //
  // This records a verdict, not a trial. Rehearsal still costs nothing and still carries no
  // statistical weight; `rehearsed → validated` continues to require the gauntlet.
  try {
    const rehearsedAt = new Date();
    let outageSkipped = 0;
    for (const outcome of report.rehearsal.outcomes) {
      // A provider outage is not a verdict about the strategy.
      //
      // The loader returns empty when a market is cooling down after a failed fetch, and every
      // candidate on that market then reports `not_evaluable`. Persisting that would overwrite a
      // real "would_pass" with a fact about the last ten seconds of network, and the ladder would
      // report a data blip as though the deployment could not evaluate the idea. The previous
      // verdict is left standing and the outage is reported instead.
      if (outcome.dataMissing) {
        outageSkipped += 1;
        continue;
      }

      getDb()
        .insert(schema.rehearsalOutcomes)
        .values({
          strategySpecId: outcome.specId,
          verdict: outcome.verdict,
          reason: outcome.reason,
          trades: outcome.trades,
          instrumentsEvaluated: outcome.instrumentsEvaluated,
          rehearsedAt,
          datasetSnapshotId: outcome.datasetSnapshotId,
        })
        .onConflictDoUpdate({
          target: schema.rehearsalOutcomes.strategySpecId,
          set: {
            verdict: outcome.verdict,
            reason: outcome.reason,
            trades: outcome.trades,
            instrumentsEvaluated: outcome.instrumentsEvaluated,
            rehearsedAt,
            datasetSnapshotId: outcome.datasetSnapshotId,
          },
        })
        .run();
    }
    if (outageSkipped > 0) {
      /**
       * Dependency resolution, not a dead-end warning.
       *
       * This branch used to push one sentence — "the gap is an ingestion task" — and stop. The
       * sentence was true and nothing owned the task it named, so the same warning reappeared
       * every cycle forever: missing bars → DEGRADED → nothing happens → same warning. Naming a
       * prerequisite without creating it is the difference between a dashboard and an autonomous
       * system.
       *
       * The blocked workflow now enqueues the work that unblocks it: one durable `ingest_history`
       * job per acceptance-universe instrument still short of the research floor. Everything
       * about the loop-prevention lives in the machinery, not in hope:
       *
       *   - dedupe key `ingest-history-<id>` — re-entering this branch next cycle reuses the
       *     existing job instead of stacking a second one;
       *   - `ingestInstrumentHistory` answers ALREADY_READY once the floor is met, so even a
       *     re-run job cannot double-write;
       *   - a source refusal FAILS the job into the queue's retry/dead machinery, where it is
       *     visible on /jobs, rather than being silently re-attempted forever;
       *   - bounded to the market's canonical listing, never "everything the catalog has heard
       *     of".
       *
       * Rehearsal still refuses this cycle — remediation is intentionally asynchronous, and the
       * NEXT pass finds the bars. Mid-evaluation fetches remain forbidden for the reason the old
       * comment gave: a verdict must be pinned to a recorded snapshot, not to whatever the
       * network returned mid-judgement.
       */
      let gapSummary = "Ingestion jobs for the gap are already queued or running.";
      try {
        // The generic resolver, not bespoke enqueueing: the same call any blocked surface makes.
        // It answers with durable truth — queued, revived after cooldown, already active, cooling
        // down, or permanently unresolvable — so this branch can no longer dedupe against a
        // corpse and report it as work in flight.
        const { resolveUniverseDataGaps } = await import("@/lib/brain/dependency-resolver");
        const gaps = await resolveUniverseDataGaps({ quota: 30 });
        gapSummary = gaps.summary;
      } catch (caught) {
        impair(
          `Ingestion remediation could not be enqueued: ${caught instanceof Error ? caught.message.split("\n")[0] : String(caught)}`,
        );
      }
      note({
        code: "DATA_HISTORY_MISSING",
        category: "DEPENDENCY",
        severity: "WARNING",
        dependency: "ingest_history",
        dependencyType: "DATA",
        message:
          `${outageSkipped} candidate(s) could not be rehearsed because the canonical store holds no bars for their ` +
          `universe. Their previous verdicts stand. ${gapSummary}`,
      });
    }
  } catch (caught) {
    impair(
      `Rehearsal verdicts could not be recorded: ${caught instanceof Error ? caught.message.split("\n")[0] : String(caught)}`,
    );
  }

  // The guarded trial. Five selection guards must all hold, and then the deterministic Trial
  // Budget Governor (`lib/strategy/trial-governor.ts`) must authorize the spend — its dedicated
  // lane switch (MARKETPULSE_AUTONOMOUS_TRIALS) is OFF by default, so in practice this reports a
  // fully checked recommendation and spends nothing. `run_gauntlet` is deliberately NOT in the
  // generic autonomous allowlist; the governor is the sole authority so a future Agent/Team layer
  // cannot spend statistical evidence through a coarse permission.
  //
  // Placed after the rehearsal, deliberately: the first guard reads the verdict the rehearsal has
  // just written, and running it earlier would judge every candidate on the previous pass's
  // evidence.
  try {
    const auto = await runAutonomousGauntlet({ mode, researchData: storeDatasetSource });
    report.autoGauntlet = {
      policyAllowed: auto.policyAllowed,
      eligible: auto.candidates.filter((candidate) => candidate.eligible).length,
      spent: auto.spent !== null,
      recommended: auto.recommended?.name ?? null,
      summary: auto.summary,
    };
    (auto.spent !== null ? actions : skipped).push(`Guarded gauntlet: ${auto.summary}`);
  } catch (caught) {
    impair(
      `The guarded gauntlet did not run: ${caught instanceof Error ? caught.message.split("\n")[0] : String(caught)}`,
    );
  }

  // Forward shadow (workstream 1): prospective evidence accumulates whenever the loop breathes.
  // Store-only, spends nothing, and is gated by the same permission as the historical replay —
  // it IS a replay of stored bars; only its timing (before outcomes exist) makes it evidence.
  try {
    const replayPermission = evaluateAutonomousAction("run_historical_replay", "autonomous_worker", mode);
    if (replayPermission.allowed) {
      const shadow = runShadowPass();
      (shadow.signalsEmitted + shadow.outcomesResolved > 0 ? actions : skipped).push(shadow.summary);
      skipped.push(...shadow.skipped);
    } else {
      skipped.push(`Forward shadow did not run: ${replayPermission.reason}`);
    }
  } catch (caught) {
    impair(
      `Forward shadow pass failed: ${caught instanceof Error ? caught.message.split("\n")[0] : String(caught)}`,
    );
  }

  // The loop's last leg, and the only part of it the owner acts on. Derived, never stored: a
  // proposal is a function of a live signal, a live price and the current risk state, and it
  // expires in twenty minutes — a persisted one would be a ticket for a market that has moved.
  //
  // Placed here rather than beside the promotion pass because it needs bars, and `observing` does
  // not fetch any. Reading it at `observing` would report "nothing fired" from a scan that never
  // happened.
  try {
    const board = buildTradeBoard({ dataset: evidence.dataset });
    const awaiting = board.entries.filter(
      (entry) => entry.proposal.decision === "ALLOW_FOR_CONFIRMATION",
    ).length;
    report.board = {
      eligible: board.eligible.length,
      proposals: board.entries.length,
      awaitingConfirmation: awaiting,
      summary: boardSummary(board),
    };
    actions.push(board.eligible.length === 0 ? boardSummary(board) : `Trade board: ${boardSummary(board)}`);
    for (const note of board.notes) skipped.push(note);

    // Record each proposal as a prediction, and resolve whatever the market has since decided.
    //
    // `forward_outcomes` held zero rows because `openForwardObservation` was called by nothing
    // outside tests — so the ladder's last rung waited on evidence that could not be produced.
    // This is the only unbiased measurement here: the prediction is written before the bar that
    // settles it exists, and a resolved observation cannot be revised.
    const forward = await runForwardDriver(
      board.entries.map((entry) => ({
        strategySpecId: entry.proposal.strategyId,
        instrumentId: entry.proposal.instrumentId,
        entryPrice: entry.proposal.entryPrice,
        stopPrice: entry.proposal.stopPrice,
        targetPrice: entry.proposal.targetPrice ?? null,
        side: "BUY" as const,
      })),
      async (instrumentId) => {
        const instrument = findCurrentInstrument(instrumentId);
        return instrument ? fetchInstrumentBars(instrument, "D") : [];
      },
    );
    actions.push(forward.summary);
  } catch (caught) {
    impair(
      `The trade board could not be built: ${caught instanceof Error ? caught.message.split("\n")[0] : String(caught)}`,
    );
  }

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
    // Screen candidates against bars at the resolution they were bred at.
    //
    // `evidence.dataset` is daily — it is fetched for the quant-core pass. The factory now breeds
    // at the resolution the owner's capital can trade, which is 5-minute, so screening against the
    // daily sample rated every intraday candidate on the wrong timeframe: the session logic saw one
    // bar per day, flattened every position immediately, and the generation produced **zero**
    // survivors where it had produced five.
    //
    // This is the same mistake as the loader, the cycle cache and the breeder — a layer that knows
    // the market and assumes that settles the bars. Fourth occurrence; hence the explicit lookup.
    // Read intraday bars from the **store**, not the live feed.
    //
    // `fetchMarketSample` asks the provider, which serves a sliding ~60-day intraday window and
    // returned 73 bars — below the 250 a generation needs. The store holds 30,000 five-minute NSE
    // bars accumulated and imported precisely so the window stops being the ceiling
    // (`lib/market/intraday-accumulator.ts`). Not using them here would leave the factory unable to
    // breed at the only resolution the owner's capital can trade.
    const breedingResolution = breedingBasis().product === "INTRADAY" ? "5" : "D";
    let factoryDataset = evidence.dataset;
    if (breedingResolution !== "D") {
      const stored: Record<string, readonly Candle[]> = {};
      for (const instrument of listCurrentInstruments({ market: OWNER_CAPITAL.market })) {
        const bars = loadStoredCandles(instrument.id, breedingResolution);
        if (bars.length > 0) {
          stored[instrument.id] = bars.map((bar) => ({
            time: bar.time,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            volume: bar.volume ?? 0,
          }));
        }
      }
      // Only if the store actually has history. Falling back to the daily sample would screen
      // 5-minute candidates on daily bars — the defect this whole block exists to avoid — so an
      // empty store leaves the dataset empty and the factory refuses, which is the honest outcome.
      factoryDataset = Object.keys(stored).length > 0 ? stored : {};
    }

    const factory = runFactoryGeneration({ dataset: factoryDataset });
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
    impair(
      `The strategy factory did not run: ${caught instanceof Error ? caught.message.split("\n")[0] : String(caught)}`,
    );
  }

  // Measured last, so it reflects everything this pass did.
  try {
    report.metrics = learningMetrics();
    actions.push(`Learning: ${report.metrics.verdict}`);
  } catch (caught) {
    impair(
      `Learning metrics could not be computed: ${caught instanceof Error ? caught.message.split("\n")[0] : String(caught)}`,
    );
  }

  // evolving: proposals are prepared, never applied.
  report.proposals = proposalStats();
  actions.push(
    "Evolving mode is active. Proposals may be raised and reviewed, but only the owner can approve or merge them.",
  );
  return report;
}
