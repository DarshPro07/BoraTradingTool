# Quant curriculum intake (owner image-set reviews, 2026-08-10 09:27)

Governing rule adopted: **MarketPulse may learn an idea from anywhere, but it may accept a fact
only after evidence verification.** Social-media images generate research tasks; they never
become system truth.

## Corrections encoded (do NOT store the original claims)
| Image claim | Verified correction | Where enforced |
|---|---|---|
| "Correlation disappears in panics" | Correlations are REGIME-DEPENDENT and can RISE sharply in stress | `pearson_correlation` entry in the ModelAssumptionRegistry (tested) |
| "EWMA is what real systems use" | EWMA and SMA are both tools; neither privileged | registry carries both, no priority |
| "Cointegration ⇒ market-neutral" | Neutrality is a goal; needs rolling stability, break detection, costs, borrow | `ou_process` invalidUses |
| "GBM represents markets" | Model #1 of several; fails on fat tails/clustering/jumps | `gbm` entry; ScenarioEngine queued |
| "One Sharpe number proves quality" | Naive √t assumes i.i.d. (Lo 2002); adjusted figure computed BESIDE it | `analyzeReturns` |
| "Random portfolios are an optimizer" | Visualization only; real optimizers queued (shrinkage/BL/HRP) | WORK_QUEUE |
| "Ernest Chan — Systematic Trading" | FALSE — *Systematic Trading* is Robert Carver; Chan wrote *Quantitative/Algorithmic/Machine Trading* | claim-verification exemplar |
| Shreve/Hull/López de Prado/Tsay card titles | Real titles: *Stochastic Calculus for Finance I–II*, *Options, Futures, and Other Derivatives*, *Advances in Financial ML*, *Analysis of Financial Time Series* | knowledge vault stores verified metadata only |

## Naming rule (data-model safety)
Order-flow delta is `trade_flow_delta` / `cumulative_trade_flow_delta`; options Greek stays
`option_delta`. Never bare `delta`.

## Data honesty for microstructure (Upstox V3 reality)
The documented feed gives LTP/LTQ/LTT + 5/30-level depth, NO aggressor flag. Every aggression
value must carry classification: EXCHANGE_REPORTED / PROVIDER_REPORTED / QUOTE_INFERRED /
TICK_RULE_INFERRED / UNKNOWN — a BUY is never fabricated because price ticked up. NSE web pages
are NOT a production data pipeline (site terms); use broker APIs / licensed feeds.

## TCA taxonomy (beyond brokerage+taxes, for the Alpha Health monitor)
explicit fees · spread · slippage · market impact · timing cost · opportunity cost ·
missed-trade cost · broker/RMS cost. "COST = 0.10%" is never the final execution model
(Gârleanu-Pedersen decay×costs; Almgren-Chriss impact/risk trade-off; AQR $1.7T executions).

## Library intake
- ArturSepp/StochVolModels (MIT): benchmark/reference engine behind a VolatilityModel adapter,
  never sole pricing truth; parity-test vs QuantLib.
- PyPortfolioOpt (MIT): reference for optimizer methods.
- Do not hand-roll linear algebra; QuantMathKernel wraps trusted numerics with typed contracts.
