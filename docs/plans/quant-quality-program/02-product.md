# The Quant Quality Program — product definition (owner directive, 2026-08-15, verbatim intent)

## The scoreboard changed

Until 2026-08-15 the project's question was **"Can MarketPulse run correctly?"** — answered
VERIFIED_FOR_DEFINED_SCOPE by the C36/C50 clean pair (runs 13/14). From this checkpoint the
primary scoreboard is:

> **Can MarketPulse discover a repeatable NET positive NSE edge that survives independent
> evidence?**

Infrastructure is frozen: no new major subsystem unless quant-quality work exposes a concrete
need for one. The software factory has done its job; now the research factory must prove itself.

## The funnel (the product's spine)

Every unit of research work sits at exactly one stage, and every exit is attributed:

```
NSE universe scanned
→ Research candidates
→ Hypotheses
→ Strategy families
→ Strategy versions
→ Rehearsal pass
→ Gauntlet pass
→ Sealed holdout pass
→ Forward enrolled
→ Forward resolved
→ Paper traded
→ Net positive evidence
```

**Typed rejection attribution is mandatory.** "0 strategies survived" is only informative when
the rejections are countable by cause, e.g.:

```
GAUNTLET REJECTIONS
Cost negative              14
Insufficient observations   8
Parameter instability       6
DSR failed                  5
PBO too high                3
Regime instability          2
```

## Strategy families, not random strategies

Research belongs to a managed family catalogue — the LLM does not invent endless unique ideas.
Every experiment is chained: **ResearchCampaign → StrategyFamily → StrategyVersion → Trial.**
This is what makes DSR honest: the Deflated Sharpe Ratio corrects for multiple testing and
selection bias, so the NUMBER OF ATTEMPTS matters, not merely the final winner (López de Prado,
SSRN 2465675). PBO/CSCV exists for the same reason — ordinary backtest selection picks
overfit winners (Bailey/Borwein/López de Prado/Zhu, SSRN 2326253).

Initial catalogue (owner, 2026-08-15):

```
INTRADAY: opening-range breakout · gap continuation/reversal · RVOL breakout ·
          intraday momentum · intraday mean reversion · volatility compression/expansion
SWING:    cross-sectional momentum · relative strength · trend following ·
          mean reversion · breakout · event drift
POSITION: medium-term trend · momentum · factor combinations where data quality permits
```

## Costs are a first-class gate

Every strategy is judged on NET P&L after the full Indian cost stack — brokerage, STT, exchange
charges, GST, SEBI fees, stamp duty, spread, slippage, impact — from effective-dated sourced
profiles, never hard-coded constants. See `docs/external/india-equity-costs.md`. A ₹20 gross
edge that costs ₹18 is not a ₹20 strategy.

## The operating mission (verbatim, the autonomous loop's charter)

1. Scan the broad eligible NSE universe.
2. Identify statistically interesting market phenomena.
3. Generate falsifiable hypotheses grouped by strategy family.
4. Rehearse only on valid canonical data.
5. Backtest with realistic costs.
6. Record every selection trial.
7. Run robustness / walk-forward / DSR / PBO gates.
8. Reject aggressively.
9. Evaluate survivors once against the sealed holdout.
10. Never tune against consumed holdout data.
11. Enroll genuine survivors into forward evidence.
12. Collect enough future outcomes.
13. Paper trade only after evidence is sufficient.
14. Attribute every gain/loss.
15. Feed validated lessons back into research memory.
16. **Prefer no strategy over a statistically weak strategy.**

## The executive dashboard emphasizes quant KPIs

Not build metrics (files/tests/providers) but: universe coverage · research campaigns · trials
spent · gauntlet survival % · DSR · PBO · holdout survival % · forward outcomes · paper net
expectancy · net P&L after all costs · max drawdown · profit factor · turnover · cost/gross
profit · strategy-family survival · regime stability · API+model cost per survivor.

## Truthfulness rule (permanent)

Because runs 13/14 excluded mobile, documentation must NEVER shorten the verdict to
"MarketPulse fully verified". The permanent form:

```
VERIFIED_FOR_DEFINED_SCOPE
Desktop / Master Golden acceptance
Mobile: separate known gap / previously single-run green (run 8)
```

## Non-goals

No broker adapter, no order placement, no real money — unchanged. No new subsystems on
speculation. No strategy promoted on historical win counts; only forward-resolved observations
are unbiased.

## Success evidence

The funnel populated with real campaigns; every rejection typed; DSR/PBO/holdout/forward/paper
numbers on the dashboard reading from the ledgers; and either (a) a family with genuine
surviving net-positive evidence, or (b) the honest, attributed statement that none survived —
both are successful outcomes of a working research factory.
