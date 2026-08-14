import { getDb, schema } from "@/lib/db";
import { evaluateAutonomousAction, type LearningMode } from "@/lib/governance/policy";
import { COMPILER_VERSION, StrategyDslSchema, type StrategyDsl } from "@/lib/strategy/dsl";
import { checkRediscovery, listGraveyard } from "@/lib/strategy/graveyard";
import { runPortfolioBacktest } from "@/lib/backtest/portfolio";
import { collectFeatures } from "@/lib/backtest/engine";
import { isDerivable } from "@/lib/backtest/features";
import { runSimulationBattery, type BatteryReport } from "@/lib/simulation/battery";
import { buildManifest, BATTERY_SEED } from "@/lib/research-data/manifest";
import {
  recordExperiment,
  snapshotFromStore,
  type SnapshotRefusal,
  type SnapshotResult,
} from "@/lib/research-data/snapshot";

/**
 * Validation *rehearsal* — what the gauntlet would say, without spending a trial.
 *
 * This is the part of learning mode that evaluates strategies, and the reason it is a rehearsal
 * rather than a validation run is a hard constraint, not caution:
 *
 *   Every trial permanently raises the statistical bar for that strategy, and `runGauntlet`
 *   consumes the locked holdout budget on entry. An idle loop that re-validated candidates on a
 *   timer would burn the only unbiased estimate the system has, on nobody's instruction, and
 *   the damage is irreversible — a holdout queried twice is not a holdout.
 *
 * So this runs the two things that cost nothing to repeat: a historical replay and the
 * simulation battery, both permitted READ actions at `learning`. It records no trial, writes no
 * row, and touches no holdout. Its output tells the owner *which candidates are worth spending
 * a trial on* — which is the decision that was previously being made blind.
 */

/**
 * The one `not_evaluable` reason that says nothing about the strategy.
 *
 * A feature gap ("no engine derives market_cap") is a durable fact about this deployment. A data
 * outage is a fact about the last ten seconds — the provider rate-limits, the loader returns
 * empty, and every candidate on that market reports it. Exported so the cycle can tell the two
 * apart before persisting a verdict, rather than matching on prose that would drift.
 */
export const NO_DATA_REASON =
  "No stored candles for this strategy's universe. Missing data is reported, never replaced with a default series.";

export interface RehearsalOutcome {
  specId: string;
  name: string;
  status: string;
  verdict: "would_pass" | "would_fail" | "not_evaluable" | "rediscovered";
  reason: string;
  trades: number;
  /** Instruments the rehearsal actually walked. A market-wide DSL judged on one is not judged. */
  instrumentsEvaluated: number;
  /** Signals dropped because every position slot was full — the strategy's real capacity. */
  signalsRejectedForCapacity: number;
  battery: BatteryReport | null;
  /** 13b: the snapshot this verdict was judged on. Null when the candidate never reached data. */
  datasetSnapshotId: string | null;
  datasetFingerprint: string | null;
  /** True when the verdict is only "the store has no bars" — an ingestion fact, not a judgement. */
  dataMissing?: boolean;
}

export interface RehearsalReport {
  /** Always true, in the payload, so no consumer can mistake this report for a trial record. */
  recordedNothing: true;
  ranAt: string;
  evaluated: number;
  outcomes: RehearsalOutcome[];
  skipped: string[];
  summary: string;
}

/**
 * Where rehearsal data comes from (13b): a snapshot source, never a provider.
 *
 * The signature is the contract. A source must answer with a *recorded snapshot* — dataset plus
 * snapshot id plus fingerprint — or a refusal that names what is missing. There is no shape here
 * a provider window can satisfy honestly, which is what closed the silent-fallback path: the old
 * injectable loader returned bare bars, and bare bars carry no identity to pin a verdict to.
 *
 * Injected so tests can seed synthetic snapshots; defaults to the canonical store.
 */
export type ResearchDatasetSource = (
  market: StrategyDsl["universe"]["market"],
  resolution: string,
) => SnapshotResult | SnapshotRefusal;

export const storeDatasetSource: ResearchDatasetSource = (market, resolution) =>
  snapshotFromStore(market, resolution, "rehearsal");

const MAX_PER_CYCLE = 10;

function empty(ranAt: string, skipped: string[], summary: string): RehearsalReport {
  return { recordedNothing: true, ranAt, evaluated: 0, outcomes: [], skipped, summary };
}

export async function runValidationRehearsal(
  source: ResearchDatasetSource,
  mode: LearningMode,
  now = new Date(),
): Promise<RehearsalReport> {
  // One snapshot per (market, resolution) per pass: candidates share markets, and the fingerprint
  // hash over ~30k bars is work worth doing once, not ten times.
  const snapshots = new Map<string, SnapshotResult | SnapshotRefusal>();
  const datasetFor = (dsl: StrategyDsl): SnapshotResult | SnapshotRefusal => {
    const key = `${dsl.universe.market}|${dsl.universe.resolution}`;
    const held = snapshots.get(key);
    if (held) return held;
    let built: SnapshotResult | SnapshotRefusal;
    try {
      built = source(dsl.universe.market, dsl.universe.resolution);
    } catch (caught) {
      // A crashing source costs this candidate, not the cycle — and is reported as unavailable
      // data, never replaced with a default series.
      built = {
        ok: false,
        code: "NO_STORED_DATA",
        message: `Dataset source failed: ${caught instanceof Error ? caught.message : String(caught)}. Treated as unavailable data.`,
      };
    }
    snapshots.set(key, built);
    return built;
  };
  const ranAt = now.toISOString();
  const skipped: string[] = [];

  // Both gates, separately, because they fail for different reasons and the report should say
  // which. Asking the policy rather than re-implementing the mode ladder means this cannot
  // drift from what /learning displays as enabled.
  const replay = evaluateAutonomousAction("run_historical_replay", "autonomous_worker", mode);
  const simulate = evaluateAutonomousAction("run_monte_carlo", "autonomous_worker", mode);
  if (!replay.allowed) return empty(ranAt, [replay.reason], "Historical replay is not permitted at this mode.");
  if (!simulate.allowed) return empty(ranAt, [simulate.reason], "Simulation is not permitted at this mode.");

  /**
   * ROTATION, not truncation. This was `.slice(0, MAX_PER_CYCLE)` with no ordering and no
   * already-rehearsed exclusion — the same first ten rows by insertion order were re-rehearsed
   * every cycle forever, and specs 11+ were structurally invisible (the live funnel's
   * "10 rehearsed" was this cap, not a measurement). The durable verdict ledger
   * (`rehearsal_outcomes`, upserted by the cycle after each pass) is the rotation's memory:
   * never-rehearsed specs first, then the stalest verdicts, so the cap bounds each PASS while
   * every draft is reached across passes — and a verdict still refreshes over time.
   */
  const rehearsedAt = new Map(
    getDb()
      .select({
        specId: schema.rehearsalOutcomes.strategySpecId,
        at: schema.rehearsalOutcomes.rehearsedAt,
      })
      .from(schema.rehearsalOutcomes)
      .all()
      .map((row) => [row.specId, row.at.getTime()]),
  );
  const specs = getDb()
    .select()
    .from(schema.strategySpecs)
    .all()
    .filter((row) => row.status === "draft" || row.status === "validating")
    .sort((left, right) => {
      const leftAt = rehearsedAt.get(left.id) ?? -1;
      const rightAt = rehearsedAt.get(right.id) ?? -1;
      // Ties (two never-rehearsed, or equal timestamps) stay deterministic by id.
      return leftAt - rightAt || left.id.localeCompare(right.id);
    })
    .slice(0, MAX_PER_CYCLE);

  if (specs.length === 0) {
    return empty(ranAt, skipped, "No strategy is waiting in draft or validating.");
  }

  // Read once for the whole pass rather than per candidate.
  const graveyard = listGraveyard();

  const outcomes: RehearsalOutcome[] = [];
  for (const spec of specs) {
    const parsedDsl = parseDsl(spec.dsl);
    if (!parsedDsl) {
      outcomes.push({
        specId: spec.id,
        name: spec.name,
        status: spec.status,
        verdict: "not_evaluable",
        reason: "Stored DSL does not parse against the current compiler. It cannot be replayed until it is recompiled.",
        trades: 0,
        instrumentsEvaluated: 0,
        signalsRejectedForCapacity: 0,
        battery: null,
        datasetSnapshotId: null,
        datasetFingerprint: null,
      });
      continue;
    }

    // Checked before any data is fetched: a strategy needing a feature no engine can derive
    // cannot be replayed however much data arrives. Discovering that *after* pulling twelve
    // instruments × three years — on every cycle, forever — is pure waste, and on a slow or
    // offline connection it is twelve ten-second timeouts to learn something already known.
    const required = new Set<string>();
    collectFeatures(parsedDsl.entry, required);
    if (parsedDsl.exit.condition) collectFeatures(parsedDsl.exit.condition, required);
    const missing = [...required].filter((feature) => !isDerivable(feature));
    if (missing.length > 0) {
      outcomes.push({
        specId: spec.id,
        name: spec.name,
        status: spec.status,
        verdict: "not_evaluable",
        reason: `FEATURE_NOT_AVAILABLE: no engine here derives ${missing.join(", ")}. Checked before fetching data, because no amount of price history supplies them.`,
        trades: 0,
        instrumentsEvaluated: 0,
        signalsRejectedForCapacity: 0,
        battery: null,
        datasetSnapshotId: null,
        datasetFingerprint: null,
      });
      continue;
    }

    // A strategy identical to one already in the graveyard has nothing left to learn from a
    // replay either, and this too is cheaper than fetching.
    const rediscovery = checkRediscovery(parsedDsl, graveyard);
    if (rediscovery.rediscovered) {
      outcomes.push({
        specId: spec.id,
        name: spec.name,
        status: spec.status,
        verdict: "rediscovered",
        reason: rediscovery.message,
        trades: 0,
        instrumentsEvaluated: 0,
        signalsRejectedForCapacity: 0,
        battery: null,
        datasetSnapshotId: null,
        datasetFingerprint: null,
      });
      continue;
    }

    const snapshot = datasetFor(parsedDsl);
    if (!snapshot.ok) {
      // Fail closed, with the gap named. The refusal message identifies market and resolution and
      // classifies the remedy as ingestion — never a provider call inside a running evaluation.
      outcomes.push({
        specId: spec.id,
        name: spec.name,
        status: spec.status,
        verdict: "not_evaluable",
        reason: snapshot.message,
        trades: 0,
        instrumentsEvaluated: 0,
        signalsRejectedForCapacity: 0,
        battery: null,
        datasetSnapshotId: null,
        datasetFingerprint: null,
        dataMissing: true,
      });
      continue;
    }

    const backtest = runPortfolioBacktest(parsedDsl, snapshot.dataset, {
      datasetFingerprint: snapshot.fingerprint,
      datasetSnapshotId: snapshot.snapshotId,
    });
    if (!backtest.ok) {
      outcomes.push({
        specId: spec.id,
        name: spec.name,
        status: spec.status,
        verdict: "not_evaluable",
        reason: `${backtest.code}: ${backtest.message}`,
        trades: 0,
        instrumentsEvaluated: 0,
        signalsRejectedForCapacity: 0,
        battery: null,
        datasetSnapshotId: null,
        datasetFingerprint: null,
      });
      continue;
    }

    // netReturn, not grossReturn: costs are exactly what a rehearsal must not quietly omit.
    const returns = backtest.trades.map((trade) => trade.netReturn);
    // Exit times so the walk-forward slices calendar rather than trade count. The engine has
    // them; not passing them would silently downgrade the test it performs.
    const battery = runSimulationBattery(returns, { times: backtest.trades.map((trade) => trade.exitTime) });
    const capacityNote =
      backtest.signalsRejectedForCapacity > 0
        ? ` ${backtest.signalsRejectedForCapacity} signal(s) were dropped for lack of a free position slot.`
        : "";
    // An inconclusive battery is not a failure. It means the sample was too thin to say
    // anything, and collapsing that into "would fail" would retire candidates for having too
    // few trades rather than for being wrong — the exact error the battery's own gates exist
    // to prevent.
    const verdict =
      battery.verdict === "pass" ? "would_pass" : battery.verdict === "fail" ? "would_fail" : "not_evaluable";

    // 13b: the verdict's reproducibility manifest, in the experiment ledger. Idempotent on
    // (spec, snapshot, kind, engine) — an unchanged store re-rehearsed writes nothing new. This
    // records no trial and touches no holdout; the rehearsal's zero-cost doctrine stands.
    recordExperiment({
      specId: spec.id,
      snapshotId: snapshot.snapshotId,
      kind: "rehearsal",
      engineVersion: COMPILER_VERSION,
      executionProfileId: backtest.execution?.profileId ?? null,
      summary: `${verdict}: ${battery.summary}`,
      trades: [],
      actor: "rehearsal",
      manifest: buildManifest({
        strategyVersionId: spec.id,
        datasetSnapshotId: snapshot.snapshotId,
        datasetFingerprint: snapshot.fingerprint,
        brokerExecutionProfileId: backtest.execution?.profileId ?? null,
        randomSeed: BATTERY_SEED,
      }),
    });

    outcomes.push({
      specId: spec.id,
      name: spec.name,
      status: spec.status,
      verdict,
      reason: `${battery.summary}${capacityNote}`,
      trades: returns.length,
      instrumentsEvaluated: backtest.instrumentsEvaluated,
      signalsRejectedForCapacity: backtest.signalsRejectedForCapacity,
      battery,
      datasetSnapshotId: snapshot.snapshotId,
      datasetFingerprint: snapshot.fingerprint,
    });
  }

  const wouldPass = outcomes.filter((outcome) => outcome.verdict === "would_pass").length;
  const survivors = outcomes.filter((outcome) => outcome.verdict === "would_pass");
  const rediscovered = outcomes.filter((outcome) => outcome.verdict === "rediscovered").length;
  const buried = rediscovered > 0 ? ` ${rediscovered} were already in the graveyard and were not re-tested.` : "";

  return {
    recordedNothing: true,
    ranAt,
    evaluated: outcomes.length,
    outcomes,
    skipped,
    summary:
      wouldPass === 0
        ? `Rehearsed ${outcomes.length} candidate(s); none would survive the simulation battery. No trial was spent finding that out.${buried}`
        // Named, with their numbers. "2 would survive" is a claim the reader has to take on
        // faith, and a loop nobody can check is indistinguishable from a loop that does nothing —
        // which is exactly the doubt this summary kept producing. A name and a trade count can be
        // looked up in the registry; a count cannot.
        : `Rehearsed ${outcomes.length} candidate(s). Would survive the battery: ${survivors
            .map((outcome) => `${outcome.name} (${outcome.trades} trades / ${outcome.instrumentsEvaluated} instruments)`)
            .join(", ")}. A rehearsal is not evidence — the gauntlet still has to be run deliberately.${buried}`,
  };
}

/** A spec stored under an older compiler is a fact to report, not a crash. */
function parseDsl(raw: string): StrategyDsl | null {
  try {
    const parsed = StrategyDslSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
