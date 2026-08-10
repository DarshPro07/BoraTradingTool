import { createHash } from "node:crypto";

/**
 * The Model Assumption Registry (quant mission WS6) — the owner's strongest insight from the
 * curriculum review: every quantitative result carries the assumptions it stands on, so the UI
 * can say "this simulation used GBM, which does not model volatility clustering or jumps"
 * instead of showing ten thousand colourful paths as if they were the market.
 *
 * Entries are static, versioned facts about MODELS — not about data. A model never wins because
 * it is more complicated; the simplest model that survives prospective evidence is preferred.
 */

export interface ModelAssumptions {
  id: string;
  model: string;
  version: string;
  assumes: readonly string[];
  knownFailureModes: readonly string[];
  validUses: readonly string[];
  invalidUses: readonly string[];
}

const ENTRIES: readonly ModelAssumptions[] = Object.freeze([
  {
    id: "naive_sharpe_annualization",
    model: "Sharpe ratio, √t annualization",
    version: "1.0",
    assumes: ["independent, identically distributed returns (no serial correlation)"],
    knownFailureModes: [
      "overstates (or understates) annualized Sharpe when returns are serially dependent — Lo (2002)",
    ],
    validUses: ["quick comparison of strategies with near-zero autocorrelation"],
    invalidUses: ["promotion decisions on autocorrelated return series without the adjusted figure beside it"],
  },
  {
    id: "serial_adjusted_sharpe",
    model: "Sharpe ratio, Lo (2002) time-aggregation with empirical autocorrelations",
    version: "1.1",
    assumes: ["stationary returns over the sample", "autocorrelations estimable at the lags used (reported in provenance)"],
    knownFailureModes: ["regime-dependent dependence not captured by one sample-wide estimate", "estimation noise at long lags on short samples"],
    validUses: ["annualizing Sharpe on serially dependent return series, with lags_used visible"],
    invalidUses: ["substituting for per-regime analysis when dependence structure shifts"],
  },
  {
    id: "normal_var",
    model: "Parametric VaR, normal distribution",
    version: "1.0",
    assumes: ["Gaussian returns", "stable mean and volatility over the window"],
    knownFailureModes: ["understates tail risk under fat tails, skew, volatility clustering"],
    validUses: ["a labelled baseline beside historical/Monte-Carlo VaR"],
    invalidUses: ["the ONLY risk number for anything that trades"],
  },
  {
    id: "historical_var",
    model: "Historical-simulation VaR",
    version: "1.0",
    assumes: ["the observed window is representative of the near future"],
    knownFailureModes: ["blind to tails worse than anything in the window; window-length sensitive"],
    validUses: ["distribution-free tail estimate on ≥ ~100 observations"],
    invalidUses: ["thin samples (reported as unavailable, never as zero risk)"],
  },
  {
    id: "expected_shortfall",
    model: "Expected Shortfall (historical)",
    version: "1.0",
    assumes: ["as historical VaR"],
    knownFailureModes: ["as historical VaR; higher estimation variance than VaR"],
    validUses: ["average severity beyond VaR — the better tail summary of the two"],
    invalidUses: ["thin samples"],
  },
  {
    id: "gbm",
    model: "Geometric Brownian Motion",
    version: "1.0",
    assumes: ["constant volatility", "lognormal prices", "continuous paths", "independent increments"],
    knownFailureModes: ["fat tails", "volatility clustering", "jumps", "regime changes"],
    validUses: ["a SIMPLIFYING baseline scenario generator, explicitly labelled as Model #1 of several"],
    invalidUses: ["'the market model'; tail-risk estimation; anything sized off its quantiles alone"],
  },
  {
    id: "ou_process",
    model: "Ornstein-Uhlenbeck mean reversion",
    version: "1.0",
    assumes: ["stationary, mean-reverting spread with stable parameters"],
    knownFailureModes: [
      "structural breaks — a pair cointegrated once is not a safe pair forever",
      "misestimated half-life under regime change",
    ],
    validUses: ["spread calibration WITH rolling stability and break detection beside it"],
    invalidUses: ["declaring a strategy market-neutral because a spread was once stationary"],
  },
  {
    id: "black_scholes",
    model: "Black-Scholes-Merton",
    version: "1.0",
    assumes: ["constant volatility", "lognormal underlying", "frictionless continuous hedging", "constant rates"],
    knownFailureModes: ["volatility smile/skew", "jumps", "discrete hedging costs", "liquidity holes"],
    validUses: ["implied-vol quoting convention; Greeks as local sensitivities; parity baseline"],
    invalidUses: ["pricing truth across strikes/tenors without a surface model"],
  },
  {
    id: "engle_granger_adf",
    model: "Engle-Granger two-step cointegration with Dickey-Fuller residual test (in-house approximation)",
    version: "1.0",
    assumes: [
      "both series are I(1) — checked and RECORDED per pair, never presumed",
      "fixed-lag Dickey-Fuller on the residual with asymptotic MacKinnon-style critical values (constant, n>100)",
      "null hypothesis is NO cointegration; a non-rejection is absence of evidence, not evidence of absence",
    ],
    knownFailureModes: [
      "not statsmodels-grade: no automatic lag selection, small-sample critical values approximated — quant-core parity is the recorded upgrade path",
      "pair mining multiplies false positives — every tested pair MUST enter the selection accounting",
      "cointegration today is not cointegration tomorrow (structural breaks)",
    ],
    validUses: ["formation-stage screening WITH candidatesTested recorded and rolling stability beside it"],
    invalidUses: ["a magic pair detector; any promotion without walk-forward + forward evidence"],
  },
  {
    id: "missed_trade_cost_proxy",
    model: "Missed-trade cost proxy: rejected intents × shadow mean net return",
    version: "1.0",
    assumes: ["rejected signals would have performed at the shadow-stage mean"],
    knownFailureModes: [
      "selection effects — rejections correlate with conditions (thin capital, cutoffs) under which performance may differ from the mean",
    ],
    validUses: ["an ESTIMATED, labelled opportunity-cost line in Alpha Health TCA"],
    invalidUses: ["a measured cost; any promotion arithmetic"],
  },
  {
    id: "pearson_correlation",
    model: "Pearson correlation (rolling)",
    version: "1.0",
    assumes: ["linear dependence, stable within the window"],
    knownFailureModes: [
      "REGIME-DEPENDENT: correlations can rise sharply during market stress, so diversification can vanish exactly when it is needed (the social-media claim that correlation 'disappears in panics' is the wrong lesson)",
    ],
    validUses: ["descriptive dependence WITH the window stated"],
    invalidUses: ["a constant input to sizing across regimes"],
  },
] as const);

const BY_ID = new Map(ENTRIES.map((entry) => [entry.id, entry]));

export function modelAssumptions(id: string): ModelAssumptions {
  const entry = BY_ID.get(id);
  if (!entry) {
    throw new Error(
      `No assumption record for model "${id}". A model without a declared assumption record may not ` +
        "be shown to the owner — register it first.",
    );
  }
  return entry;
}

export function listModelAssumptions(): readonly ModelAssumptions[] {
  return ENTRIES;
}

export interface AssumptionFingerprint {
  id: string;
  version: string;
  /** Hash over the full record content: change the record, change the hash — old evidence keeps the OLD hash. */
  hash: string;
}

/**
 * Pin an assumption record into evidence. Persisted beside model-generated results (and in
 * experiment manifests) so a later edit to the registry cannot silently re-describe what an old
 * experiment ran under.
 */
export function assumptionFingerprint(id: string): AssumptionFingerprint {
  const entry = modelAssumptions(id);
  const hash = createHash("sha256")
    .update(JSON.stringify(entry))
    .digest("hex")
    .slice(0, 16);
  return { id: entry.id, version: entry.version, hash };
}
