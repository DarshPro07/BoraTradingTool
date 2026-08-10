import { createHash } from "node:crypto";
import { snapshotFromStore } from "@/lib/research-data/snapshot";
import { recordAudit } from "@/lib/knowledge/repository";
import { FEE_MODEL_ID } from "@/lib/paper/cost-model";
import { COMPILER_VERSION } from "@/lib/strategy/dsl";
import { mean, standardDeviation } from "@/lib/strategy/statistics";
import { rollingCorrelation } from "./indicator-registry";
import { assumptionFingerprint, type AssumptionFingerprint } from "./model-assumptions";

/**
 * Statistical arbitrage — FORMATION stage (mission phase F).
 *
 * Research-grade means the traps are engineered out, not warned about:
 * - Pair mining IS strategy search: every tested pair counts in `candidatesTested`, which is
 *   persisted in the manifest and MUST feed the gauntlet's `screenedCandidates` when a pair
 *   strategy is ever validated. 5,000 attempts that keep five pretty survivors are 5,000 trials.
 * - Correlation is a screen, never the thesis. The thesis is cointegration, and the
 *   Engle-Granger machinery here carries its own registered assumption record naming its
 *   approximations (fixed-lag DF, asymptotic critical values) and its upgrade path.
 * - I(1) is CHECKED per series and recorded, because the EG test presumes it.
 * - "Cointegrated once" is not "cointegrated"; rolling re-tests produce a stability fraction.
 * - Half-life is an estimated property of a fitted model, recorded with the OU assumption
 *   fingerprint — never a promise of reversion.
 * - Trading-stage economics (two-leg costs, shortability, bid/ask) are NOT computed here; the
 *   manifest records them as stated assumptions for the trading stage to satisfy.
 */

/** Augmented Dickey-Fuller (fixed lag 1, constant). Returns the test t-statistic. */
export function adfStatistic(series: readonly number[]): number | null {
  const n = series.length;
  if (n < 25) return null;
  // Regression: Δy_t = α + β·y_{t−1} + γ·Δy_{t−1} + ε. OLS via normal equations (3 params).
  const dy: number[] = [];
  const yLag: number[] = [];
  const dyLag: number[] = [];
  for (let index = 2; index < n; index += 1) {
    dy.push(series[index] - series[index - 1]);
    yLag.push(series[index - 1]);
    dyLag.push(series[index - 1] - series[index - 2]);
  }
  const m = dy.length;
  // Design matrix columns: [1, yLag, dyLag]
  const X = [new Array(m).fill(1), yLag, dyLag];
  // Normal equations XtX b = Xty, 3x3 solved by Cramer.
  const XtX: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const Xty = [0, 0, 0];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      let sum = 0;
      for (let k = 0; k < m; k += 1) sum += X[row][k] * X[col][k];
      XtX[row][col] = sum;
    }
    let sy = 0;
    for (let k = 0; k < m; k += 1) sy += X[row][k] * dy[k];
    Xty[row] = sy;
  }
  const det = (a: number[][]) =>
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) -
    a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
    a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const D = det(XtX);
  if (Math.abs(D) < 1e-12) return null;
  const replace = (a: number[][], column: number, v: number[]) =>
    a.map((row, i) => row.map((value, j) => (j === column ? v[i] : value)));
  const beta = [det(replace(XtX, 0, Xty)) / D, det(replace(XtX, 1, Xty)) / D, det(replace(XtX, 2, Xty)) / D];
  // Residual variance and standard error of β (the y_{t−1} coefficient).
  let sse = 0;
  for (let k = 0; k < m; k += 1) {
    const fitted = beta[0] + beta[1] * yLag[k] + beta[2] * dyLag[k];
    sse += (dy[k] - fitted) ** 2;
  }
  const sigma2 = sse / (m - 3);
  // Var(β) = σ²·(XtX)^{-1}[1][1] via Cramer on the inverse element.
  const cofactor = XtX[0][0] * XtX[2][2] - XtX[0][2] * XtX[2][0];
  const inv11 = cofactor / D;
  const se = Math.sqrt(Math.max(sigma2 * inv11, 1e-18));
  return beta[1] / se;
}

/**
 * Plain ADF critical values (constant, no trend) — for testing a RAW series for a unit root,
 * e.g. the I(1) integration checks. Correct there, and wrong for cointegration residuals.
 */
export const ADF_CRITICAL = Object.freeze({ p01: -3.43, p05: -2.86, p10: -2.57 });

/**
 * Engle-Granger critical values for a residual from an ESTIMATED cointegrating regression
 * (2 variables, constant, no trend). More negative than plain ADF because the regression
 * consumed a degree of freedom in fitting the very spread being tested.
 *
 * FOUND BY THE PARITY CORPUS, 2026-08-10: this module previously tested cointegration residuals
 * against the plain ADF −2.86, giving a **13.9% false-positive rate on independent random walks**
 * against a nominal 5% (5 of 36 unrelated pairs declared cointegrated). Test statistics agreed
 * with statsmodels to ~0.01; only the threshold was wrong — the exact class of defect that looks
 * correct in every unit test written against its own arithmetic. statsmodels used −3.348..−3.388
 * on this corpus; the asymptotic MacKinnon values below are the honest fixed approximation, and
 * sample-size-dependent values remain the recorded upgrade.
 */
export const ENGLE_GRANGER_CRITICAL = Object.freeze({ p01: -3.9, p05: -3.34, p10: -3.04 });

/**
 * The methodology label that travels with every cointegration verdict this module produces.
 *
 * APPROXIMATE, and it says so everywhere: fixed lag 1 (no AIC/BIC/t-stat lag selection),
 * asymptotic critical values (not sample-size-dependent MacKinnon), no p-value surface. It can
 * disagree with statsmodels.coint on borderline pairs — which is exactly where pair selection
 * lives. Nothing may present this as textbook-grade econometrics until the parity corpus runs.
 */
export const COINTEGRATION_METHOD_STATUS = Object.freeze({
  methodStatus: "APPROXIMATE_PARITY_MEASURED" as const,
  label:
    "Engle-Granger/ADF approximation — 99.1% classification agreement with statsmodels.coint " +
    "over a 108-case synthetic corpus (2026-08-10); still an approximation, now a measured one",
  parityResult: {
    corpusCases: 108,
    agreement: 0.9907,
    reference: "statsmodels.tsa.stattools.coint(trend='c', maxlag=1, autolag=None)",
    meanAbsStatisticDelta: 0.01,
    falsePositiveRateOnIndependentWalks: 0.056,
    measuredOn: "2026-08-10",
    corpusScript: "scripts/statarb-parity-corpus.mts + scripts/statarb_parity.py",
  },
  approximations: [
    "fixed lag 1 (no AIC/BIC/t-stat lag selection)",
    "asymptotic Engle-Granger critical values (2 variables, constant); not sample-size-dependent MacKinnon",
    "no p-values reported (a threshold classification only)",
  ],
  parityPlan:
    "statsmodels.tsa.stattools.coint over a synthetic corpus (cointegrated / non-cointegrated / " +
    "near-threshold / varied lengths and lag structures / nearly-collinear), tracking statistic " +
    "difference, classification agreement and threshold agreement. Runs in the Python quant core.",
});

export interface IntegrationCheck {
  levelsAdf: number | null;
  differencesAdf: number | null;
  /** I(1) = levels NON-stationary (adf > 5% critical) AND differences stationary. */
  isI1: boolean;
}

export function integrationOrderCheck(series: readonly number[]): IntegrationCheck {
  const levels = adfStatistic(series);
  const diffs = adfStatistic(series.slice(1).map((value, index) => value - series[index]));
  return {
    levelsAdf: levels,
    differencesAdf: diffs,
    isI1: levels !== null && diffs !== null && levels > ADF_CRITICAL.p05 && diffs < ADF_CRITICAL.p05,
  };
}

export interface PairFormation {
  a: string;
  b: string;
  correlation: number;
  integrationA: IntegrationCheck;
  integrationB: IntegrationCheck;
  hedgeRatio: number;
  spreadAdf: number | null;
  cointegrated: boolean;
  ouKappa: number | null;
  halfLifeBars: number | null;
  spreadZLast: number | null;
  /** Fraction of rolling windows in which the spread re-tests stationary. */
  rollingStability: number | null;
}

export interface StatArbFormationManifest {
  candidateGenerationMethod: string;
  candidatesTested: number;
  correlationScreen: number;
  cointegrationMethod: string;
  cointegrationParameters: Record<string, number | string>;
  hedgeRatioMethod: string;
  stationarityTest: string;
  entryZ: number;
  exitZ: number;
  stopZ: number;
  formationSnapshotId: string;
  brokerProfileAssumption: string;
  feeModelId: string;
  shortabilityAssumption: string;
  liquidityAssumption: string;
  engineVersion: string;
  codeFingerprint: string;
  assumptionFingerprints: readonly AssumptionFingerprint[];
}

export interface StatArbFormationResult {
  ok: true;
  /** Deterministic id over (snapshot, method, cap) — the same search re-run is the same record. */
  formationId: string;
  formationSnapshotId: string;
  candidatesTested: number;
  survivors: PairFormation[];
  rejectedCounts: Record<string, number>;
  manifest: StatArbFormationManifest;
}

export type StatArbRefusal = { ok: false; code: "NO_STORED_DATA" | "TOO_FEW_INSTRUMENTS"; message: string };

function olsHedgeRatio(y: readonly number[], x: readonly number[]): number {
  const mx = mean(x);
  const my = mean(y);
  let covariance = 0;
  let variance = 0;
  for (let index = 0; index < x.length; index += 1) {
    covariance += (x[index] - mx) * (y[index] - my);
    variance += (x[index] - mx) ** 2;
  }
  return variance > 0 ? covariance / variance : 0;
}

function ouFromSpread(spread: readonly number[]): { kappa: number | null; halfLife: number | null } {
  // AR(1): s_t = c + φ·s_{t−1} + ε; κ = −ln(φ) per bar; half-life = ln2/κ.
  const y = spread.slice(1);
  const x = spread.slice(0, -1);
  const phi = olsHedgeRatio(y, x);
  if (!(phi > 0 && phi < 1)) return { kappa: null, halfLife: null };
  const kappa = -Math.log(phi);
  return { kappa, halfLife: Math.log(2) / kappa };
}

/**
 * Formation over a recorded snapshot. Trading-stage split, walk-forward, costs and forward
 * evidence are the NEXT stages — this records the search honestly so they can be built on it.
 */
export function runStatArbFormation(options: {
  market: "NSE" | "US" | "BSE";
  resolution: string;
  correlationScreen?: number;
  entryZ?: number;
  exitZ?: number;
  stopZ?: number;
  maxPairs?: number;
  actor?: string;
}): StatArbFormationResult | StatArbRefusal {
  const correlationScreen = options.correlationScreen ?? 0.6;
  const entryZ = options.entryZ ?? 2;
  const exitZ = options.exitZ ?? 0.5;
  const stopZ = options.stopZ ?? 4;

  const snapshot = snapshotFromStore(options.market, options.resolution, "statarb-formation");
  if (!snapshot.ok) return { ok: false, code: "NO_STORED_DATA", message: snapshot.message };

  const instruments = snapshot.instruments.filter((id) => (snapshot.dataset[id]?.length ?? 0) >= 120);
  if (instruments.length < 2) {
    return {
      ok: false,
      code: "TOO_FEW_INSTRUMENTS",
      message: `${instruments.length} instrument(s) with ≥120 bars; a pair needs two. Point-in-time universe coverage is an ingestion task, not a reason to lower the bar.`,
    };
  }

  const rejectedCounts: Record<string, number> = {};
  const reject = (reason: string) => {
    rejectedCounts[reason] = (rejectedCounts[reason] ?? 0) + 1;
  };
  const survivors: PairFormation[] = [];
  let candidatesTested = 0;
  const maxPairs = options.maxPairs ?? 200;

  outer: for (let i = 0; i < instruments.length; i += 1) {
    for (let j = i + 1; j < instruments.length; j += 1) {
      if (candidatesTested >= maxPairs) break outer;
      candidatesTested += 1; // EVERY attempt counts — pair mining is strategy search.

      const closesA = snapshot.dataset[instruments[i]].map((bar) => bar.close);
      const closesB = snapshot.dataset[instruments[j]].map((bar) => bar.close);
      const length = Math.min(closesA.length, closesB.length);
      const a = closesA.slice(-length);
      const b = closesB.slice(-length);

      const correlationSeries = rollingCorrelation(a, b, Math.min(60, length - 1));
      const correlation = correlationSeries[correlationSeries.length - 1];
      if (correlation === null || Math.abs(correlation) < correlationScreen) {
        reject("CORRELATION_SCREEN");
        continue;
      }

      const integrationA = integrationOrderCheck(a);
      const integrationB = integrationOrderCheck(b);
      if (!integrationA.isI1 || !integrationB.isI1) {
        reject("NOT_I1");
        continue;
      }

      const hedgeRatio = olsHedgeRatio(a, b);
      const spread = a.map((value, index) => value - hedgeRatio * b[index]);
      const spreadAdf = adfStatistic(spread);
      const cointegrated = spreadAdf !== null && spreadAdf < ENGLE_GRANGER_CRITICAL.p05;
      if (!cointegrated) {
        reject("NOT_COINTEGRATED");
        continue;
      }

      const { kappa, halfLife } = ouFromSpread(spread);
      if (halfLife === null || halfLife > length / 4) {
        reject("HALF_LIFE_UNUSABLE");
        continue;
      }

      // Rolling stability: re-test the spread on thirds of the window.
      const windows = 3;
      const step = Math.floor(spread.length / windows);
      let stable = 0;
      for (let w = 0; w < windows; w += 1) {
        const slice = spread.slice(w * step, (w + 1) * step);
        const stat = adfStatistic(slice);
        if (stat !== null && stat < ENGLE_GRANGER_CRITICAL.p10) stable += 1;
      }
      const rollingStability = stable / windows;

      const spreadMean = mean(spread);
      const spreadStd = standardDeviation(spread);
      survivors.push({
        a: instruments[i],
        b: instruments[j],
        correlation,
        integrationA,
        integrationB,
        hedgeRatio,
        spreadAdf,
        cointegrated,
        ouKappa: kappa,
        halfLifeBars: halfLife,
        spreadZLast: spreadStd > 0 ? (spread[spread.length - 1] - spreadMean) / spreadStd : null,
        rollingStability,
      });
    }
  }

  const assumptions = [
    assumptionFingerprint("engle_granger_adf"),
    assumptionFingerprint("ou_process"),
    assumptionFingerprint("pearson_correlation"),
  ];
  const manifest: StatArbFormationManifest = {
    candidateGenerationMethod: `all-pairs over snapshot instruments with ≥120 bars, capped at ${maxPairs}`,
    candidatesTested,
    correlationScreen,
    cointegrationMethod: "engle_granger_adf",
    cointegrationParameters: { adfLag: 1, criticalValue: ENGLE_GRANGER_CRITICAL.p05, criticalValueFamily: "engle_granger_2var_constant", deterministic: "constant" },
    hedgeRatioMethod: "ols_levels",
    stationarityTest: "adf_fixed_lag1_constant",
    entryZ,
    exitZ,
    stopZ,
    formationSnapshotId: snapshot.snapshotId,
    brokerProfileAssumption: "trading stage must resolve a broker profile; formation assumes none",
    feeModelId: FEE_MODEL_ID,
    shortabilityAssumption: "STATED, NOT VERIFIED: the short leg is assumed borrowable; trading stage must check",
    liquidityAssumption: "STATED, NOT VERIFIED: both legs assumed liquid at close; trading stage must check",
    engineVersion: COMPILER_VERSION,
    codeFingerprint: `marketpulse-statarb@1.0`,
    assumptionFingerprints: assumptions,
  };

  // A formation scan has no strategy spec, so it cannot live in the experiments table (real FK).
  // It is recorded in the append-only audit ledger with its FULL manifest; a dedicated
  // statarb_formations table arrives with the trading stage, and the gauntlet of any pair
  // strategy MUST carry candidatesTested as screenedCandidates — the search is never free.
  const formationId = `saf_${createHash("sha256")
    .update(`${snapshot.snapshotId}|${manifest.candidateGenerationMethod}|${candidatesTested}`)
    .digest("hex")
    .slice(0, 16)}`;
  recordAudit({
    actor: options.actor ?? "statarb",
    action: "statarb_formation",
    decision: "allowed",
    detail: JSON.stringify({
      formationId,
      candidatesTested,
      survivors: survivors.map((pair) => ({ a: pair.a, b: pair.b, hedgeRatio: pair.hedgeRatio, halfLifeBars: pair.halfLifeBars, rollingStability: pair.rollingStability })),
      rejectedCounts,
      manifest,
    }),
  });

  return { ok: true, formationId, formationSnapshotId: snapshot.snapshotId, candidatesTested, survivors, rejectedCounts, manifest };
}
