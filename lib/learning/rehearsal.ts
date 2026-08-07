import { getDb, schema } from "@/lib/db";
import { evaluateAutonomousAction, type LearningMode } from "@/lib/governance/policy";
import { StrategyDslSchema, type StrategyDsl } from "@/lib/strategy/dsl";
import { checkRediscovery, listGraveyard } from "@/lib/strategy/graveyard";
import { runPortfolioBacktest } from "@/lib/backtest/portfolio";
import { collectFeatures } from "@/lib/backtest/engine";
import { isDerivable } from "@/lib/backtest/features";
import { runSimulationBattery, type BatteryReport } from "@/lib/simulation/battery";
import type { Candle } from "@/lib/providers/types";

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
 * The dataset for one strategy, keyed by instrument id.
 *
 * A dataset rather than one series, because the DSL's universe is a *market*, not a symbol.
 * Replaying a market-wide strategy against a single instrument gives it unlimited position
 * slots, so `maxPositions` never binds and the strategy looks like it had capacity it never
 * had. The portfolio engine exists precisely to make that constraint observable.
 *
 * Injected, and async, so this stays testable without a provider or a network.
 */
export type CandleLoader = (
  specId: string,
  dsl: StrategyDsl,
) => Promise<Readonly<Record<string, readonly Candle[]>>>;

const MAX_PER_CYCLE = 10;

function empty(ranAt: string, skipped: string[], summary: string): RehearsalReport {
  return { recordedNothing: true, ranAt, evaluated: 0, outcomes: [], skipped, summary };
}

export async function runValidationRehearsal(
  loadCandles: CandleLoader,
  mode: LearningMode,
  now = new Date(),
): Promise<RehearsalReport> {
  const ranAt = now.toISOString();
  const skipped: string[] = [];

  // Both gates, separately, because they fail for different reasons and the report should say
  // which. Asking the policy rather than re-implementing the mode ladder means this cannot
  // drift from what /learning displays as enabled.
  const replay = evaluateAutonomousAction("run_historical_replay", "autonomous_worker", mode);
  const simulate = evaluateAutonomousAction("run_monte_carlo", "autonomous_worker", mode);
  if (!replay.allowed) return empty(ranAt, [replay.reason], "Historical replay is not permitted at this mode.");
  if (!simulate.allowed) return empty(ranAt, [simulate.reason], "Simulation is not permitted at this mode.");

  const specs = getDb()
    .select()
    .from(schema.strategySpecs)
    .all()
    .filter((row) => row.status === "draft" || row.status === "validating")
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
      });
      continue;
    }

    const dataset = await loadDataset(loadCandles, spec.id, parsedDsl);
    if (!dataset || Object.keys(dataset).length === 0) {
      outcomes.push({
        specId: spec.id,
        name: spec.name,
        status: spec.status,
        verdict: "not_evaluable",
        reason: "No stored candles for this strategy's universe. Missing data is reported, never replaced with a default series.",
        trades: 0,
        instrumentsEvaluated: 0,
        signalsRejectedForCapacity: 0,
        battery: null,
      });
      continue;
    }

    const backtest = runPortfolioBacktest(parsedDsl, dataset);
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
    });
  }

  const wouldPass = outcomes.filter((outcome) => outcome.verdict === "would_pass").length;
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
        : `Rehearsed ${outcomes.length} candidate(s); ${wouldPass} would survive the battery and may be worth a real trial. A rehearsal is not evidence — the gauntlet still has to be run deliberately.${buried}`,
  };
}

/**
 * A loader that throws costs that one candidate, not the cycle. A provider outage during an
 * idle pass must not take down the pass — and must not be reported as "no data" either, which
 * is why the message distinguishes them.
 */
async function loadDataset(
  loadCandles: CandleLoader,
  specId: string,
  dsl: StrategyDsl,
): Promise<Readonly<Record<string, readonly Candle[]>> | null> {
  try {
    return await loadCandles(specId, dsl);
  } catch {
    return null;
  }
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
