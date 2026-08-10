import { blockBootstrapSimulation, monteCarloSimulation } from "@/lib/simulation/battery";
import { createRandom, mean, standardDeviation } from "@/lib/strategy/statistics";
import { assumptionFingerprint, type AssumptionFingerprint } from "./model-assumptions";

/**
 * The ScenarioEngine (mission phase E): several models over the same inputs, each labelled with
 * what it assumes — GBM is Model #1, explicitly a simplification, never "the market".
 *
 * Reuse-first: the resample and block-bootstrap machinery is the battery's (seeded, proven);
 * this module adds the GBM generator, a unified result shape, and assumption pinning. Extension
 * contracts exist for GARCH / stochastic-vol / jump / regime models — registered assumptions
 * first, implementations when they earn their place against these baselines.
 */

export type ScenarioModelId = "gbm" | "historical_bootstrap" | "block_bootstrap";

export interface ScenarioRequest {
  model: ScenarioModelId;
  /** Per-period returns the scenario is conditioned on. */
  returns: readonly number[];
  horizonPeriods: number;
  paths: number;
  seed: number;
}

export interface ScenarioResult {
  model: ScenarioModelId;
  seed: number;
  paths: number;
  horizonPeriods: number;
  /** Terminal compounded-return distribution. */
  terminal: { p05: number; p25: number; p50: number; p75: number; p95: number };
  probabilityOfLoss: number;
  /** Worst peak-to-trough drawdown per path, summarized. */
  maxDrawdown: { p50: number; p95: number };
  assumption: AssumptionFingerprint;
  /** Model parameters that shaped the paths — provenance, never invisible constants. */
  parameters: Record<string, number | string>;
  note: string;
}

export type ScenarioRefusal = { ok: false; code: "INSUFFICIENT_SAMPLE"; message: string };

/** Deterministic quantile on a sorted copy. */
function quantile(sorted: readonly number[], q: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[index];
}

function summarize(
  model: ScenarioModelId,
  seed: number,
  horizonPeriods: number,
  perPathReturns: number[][],
  note: string,
  parameters: Record<string, number | string> = {},
): ScenarioResult {
  const terminals: number[] = [];
  const drawdowns: number[] = [];
  for (const path of perPathReturns) {
    let equity = 1;
    let peak = 1;
    let maxDrawdown = 0;
    for (const value of path) {
      equity *= 1 + value;
      peak = Math.max(peak, equity);
      maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak);
    }
    terminals.push(equity - 1);
    drawdowns.push(maxDrawdown);
  }
  terminals.sort((a, b) => a - b);
  drawdowns.sort((a, b) => a - b);
  return {
    model,
    seed,
    paths: perPathReturns.length,
    horizonPeriods,
    terminal: {
      p05: quantile(terminals, 0.05),
      p25: quantile(terminals, 0.25),
      p50: quantile(terminals, 0.5),
      p75: quantile(terminals, 0.75),
      p95: quantile(terminals, 0.95),
    },
    probabilityOfLoss: terminals.filter((value) => value < 0).length / terminals.length,
    maxDrawdown: { p50: quantile(drawdowns, 0.5), p95: quantile(drawdowns, 0.95) },
    assumption: assumptionFingerprint(model === "gbm" ? "gbm" : "historical_var"),
    parameters,
    note,
  };
}

/** Minimum conditioning sample — same spirit as the risk policy: stated, not assumed. */
const MIN_SCENARIO_SAMPLE = 30;

/**
 * Block-length policy for the block bootstrap — provenance, not an invisible constant.
 * sqrt(n) with a floor of 5 is a stated simple choice; stationary/circular bootstraps and
 * optimal block-length estimation (Politis-White style, as exposed by e.g. the arch library)
 * are the recorded upgrade path when dependence structure warrants them.
 */
export const SCENARIO_BLOCK_POLICY = Object.freeze({
  version: "sbp-2026-08-10.1",
  method: "sqrt_n" as const,
  floor: 5,
  upgradePath: "stationary/circular bootstrap with optimal block-length estimation",
});

export function runScenario(request: ScenarioRequest): ScenarioResult | ScenarioRefusal {
  const { returns, horizonPeriods, paths, seed } = request;
  if (returns.length < MIN_SCENARIO_SAMPLE) {
    return {
      ok: false,
      code: "INSUFFICIENT_SAMPLE",
      message: `${returns.length} conditioning return(s); ${MIN_SCENARIO_SAMPLE} is the stated floor. A scenario conditioned on almost nothing is a random-number generator wearing a chart.`,
    };
  }

  if (request.model === "gbm") {
    // GBM in discrete per-period form: r ~ exp((μ − σ²/2) + σ·Z) − 1, Z standard normal via
    // Box-Muller on the seeded generator. The assumption record carries what this ignores.
    const mu = mean(returns);
    const sigma = standardDeviation(returns);
    const random = createRandom(seed);
    const normal = () => {
      const u1 = Math.max(random(), 1e-12);
      const u2 = random();
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    };
    const drift = Math.log(1 + mu) - (sigma * sigma) / 2;
    const perPath: number[][] = [];
    for (let path = 0; path < paths; path += 1) {
      const series: number[] = [];
      for (let step = 0; step < horizonPeriods; step += 1) {
        series.push(Math.exp(drift + sigma * normal()) - 1);
      }
      perPath.push(series);
    }
    return summarize("gbm", seed, horizonPeriods, perPath, "GBM is Model #1, a stated simplification: constant volatility, no jumps, no clustering, no regimes.", {
      mu: mean(returns),
      sigma: standardDeviation(returns),
    });
  }

  if (request.model === "block_bootstrap") {
    // The battery's block bootstrap preserves short-range dependence; reused, not re-derived.
    const result = blockBootstrapSimulation(returns, paths, seed);
    // The battery returns summary stats; for path-level drawdowns we resample here with the same
    // seeded generator and block discipline, keeping its parameters authoritative.
    const random = createRandom(seed);
    const block = Math.max(5, Math.round(Math.sqrt(returns.length)));
    const perPath: number[][] = [];
    for (let path = 0; path < paths; path += 1) {
      const series: number[] = [];
      while (series.length < horizonPeriods) {
        const start = Math.floor(random() * Math.max(1, returns.length - block));
        for (let offset = 0; offset < block && series.length < horizonPeriods; offset += 1) {
          series.push(returns[start + offset]);
        }
      }
      perPath.push(series);
    }
    const summary = summarize(
      "block_bootstrap",
      seed,
      horizonPeriods,
      perPath,
      `Block bootstrap (${SCENARIO_BLOCK_POLICY.version}: ${SCENARIO_BLOCK_POLICY.method}, block=${block}) preserves short-range dependence; regimes outside the sample stay invisible. Battery cross-ref: ${result.reason.split(String.fromCharCode(46))[0]}.`,
      { blockLength: block, blockPolicy: SCENARIO_BLOCK_POLICY.version },
    );
    return summary;
  }

  // Historical bootstrap: i.i.d. resample of observed returns — the battery's own primitive.
  const battery = monteCarloSimulation(returns);
  const random = createRandom(seed);
  const perPath: number[][] = [];
  for (let path = 0; path < paths; path += 1) {
    const series: number[] = [];
    for (let step = 0; step < horizonPeriods; step += 1) {
      series.push(returns[Math.floor(random() * returns.length)]);
    }
    perPath.push(series);
  }
  return summarize(
    "historical_bootstrap",
    seed,
    horizonPeriods,
    perPath,
    `I.i.d. resample of the observed window — dependence and unseen tails are not modelled. Battery cross-ref: ${battery.reason.split(String.fromCharCode(46))[0]}.`,
    { resampling: "iid" },
  );
}

/**
 * Extension contract (registered here, implemented when they beat these baselines on prospective
 * evidence): GARCH, stochastic volatility, jump diffusion, regime-conditioned simulation. Each
 * needs a ModelAssumptionRegistry entry BEFORE its first result can be displayed.
 */
export const SCENARIO_EXTENSIONS_PLANNED = Object.freeze(["garch", "stochastic_vol", "jump_diffusion", "regime_conditioned"] as const);
