# Phase F + F.2 — statistical arbitrage — final

## Verdict: **VERIFIED (research stage)** — and NOT execution-eligible, by design

## What exists
- **Formation** (`lib/quant/statarb.ts`): I(1) checks recorded per series, Engle-Granger
  cointegration, OLS hedge, OU half-life, rolling stability, `candidatesTested` counting EVERY
  attempt, full manifest in the append-only audit ledger.
- **Trading + walk-forward** (`lib/quant/statarb-trading.ts`): formation freezes (pair, hedge,
  spread mean/σ, thresholds — hashed); trading observes strictly AFTER the formation window on
  those frozen parameters; z-entry/exit, stop, half-life-scaled timeout; **both legs priced
  separately** through the effective-dated fee engine with whole-share `hedgeError` recorded;
  folds roll forward; run recorded in the audit ledger.
- **Pair-mode gate** (`assessPairMode`): INTRADAY_MIS / OVERNIGHT_EQUITY_SLB / FUTURES /
  RESEARCH_ONLY. India's prohibition on naked short selling makes overnight equity pairs
  research-only unless borrow is a VERIFIED input. Cointegration never buys eligibility.

## The defect the parity corpus found (the headline result)
`scripts/statarb-parity-corpus.mts` (108 deterministic synthetic cases: cointegrated /
independent / near-threshold / nearly-collinear × 3 lengths) + `scripts/statarb_parity.py`
(statsmodels.coint, trend='c', maxlag=1, autolag=None) — neither half grades itself.

**First run: 91.7% agreement.** Test statistics matched statsmodels to ~0.01, but classifications
diverged — because cointegration residuals were being tested against the **plain ADF** critical
value (−2.86) instead of **Engle-Granger** values (≈−3.34), which are more negative precisely
because the residual comes from an estimated regression. Measured consequence: a **13.9%
false-positive rate on independent random walks** against a nominal 5%.

**After the fix: 99.1% agreement (107/108); false positives 5.6%** — at nominal. `ADF_CRITICAL`
now serves only raw-series unit-root tests (where it is correct); `ENGLE_GRANGER_CRITICAL` serves
every cointegration decision. Regression tests pin both the value ordering and the
false-positive-rate property.

`COINTEGRATION_METHOD_STATUS` is now `APPROXIMATE_PARITY_MEASURED` and carries the corpus size,
agreement, reference call and measurement date — an approximation that has been measured, not a
promise that it will be.

## Deferred, with reasons
Point-in-time universe wiring (needs WS2's NSE work), sample-size-dependent MacKinnon values and
lag selection, Johansen for >2 series, pair-portfolio construction (the "20 pairs all containing
RELIANCE" concentration problem — Phase G), leg-fill asynchrony as a live execution risk (the
shape is recorded in `hedgeError`; real leg-risk needs the paper/broker path), and the
selection-search linkage into DSR (`EffectiveSearchTrials` — `candidatesTestedTotal` is carried
in the manifest today and must reach `screenedCandidates` before any pair strategy is validated).
