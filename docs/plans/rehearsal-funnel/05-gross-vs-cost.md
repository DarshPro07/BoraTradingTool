# Gross versus cost: what the five canonical seeds actually show

Measurement only — no parameter changed, no family selected, no trial spent. 2026-08-17.

## The cost formula, derived rather than assumed

```ts
perSide  = (commissionBps + slippageBps) * 2   // despite the name, this is BOTH sides
roundTrip = perSide + assumedSpreadBps          // spread charged once, not doubled
```

**29 bps** for the intraday seeds (5 + 7 + 5), **38 bps** for the swing seeds (5 + 10 + 8). The
statutory floor for the owner's capital basis computes to **24.0 bps**, so every seed declares more
cost than the fee model demands — conservative, not understated. Delivery friction is *higher* than
intraday in absolute terms, which is the opposite of a casual assumption.

## The decomposition

| family | trades | gross bps | cost bps | net bps | gross PF | net PF | hold hrs | gross winners flipped to net losers |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| ORB | 589 | −0.7 | 29.0 | −29.7 | 0.98 | 0.42 | 1.3 | 75 |
| RVOL breakout | 491 | −2.1 | 29.0 | −31.1 | 0.94 | 0.42 | 1.3 | 58 |
| Intraday MR | 495 | −2.9 | 29.0 | −31.9 | 0.87 | 0.21 | 0.9 | 149 |
| Swing MR | 578 | **+10.0** | 38.0 | −28.0 | 1.05 | 0.87 | 145.5 | 19 |
| XSec momentum | 488 | −69.1 | 38.0 | −107.1 | 0.82 | 0.74 | 168.4 | 9 |

Four of five are flat-to-negative **before any friction**. Removing execution cost entirely would
not make them attractive. Only Swing MR shows a positive gross point estimate, and its
`edge/cost = 0.26` means the observed gross expectancy pays for about a quarter of its own friction.

## Inference: the naive numbers, and the ones that count

Trade-level t-statistics treat trades as independent. They are not — intraday families place
several trades inside one session, swing MR holds overlapping positions, and cross-sectional
momentum draws many stock-trades from **one** ranking decision. Aggregating to the real decision
unit and applying a Newey–West HAC correction shrinks the effective sample rather than flattering
it.

| family | naive n | naive t | **decision unit** | **effective n** | **HAC t** | **95% CI (bps)** | **P(mean > 0)** |
|---|---:|---:|---|---:|---:|---|---:|
| ORB | 589 | −0.21 | per day | **67** | −0.21 | [−62.9, +51.0] | 43% |
| RVOL breakout | 491 | −0.58 | per day | **71** | −0.57 | [−65.6, +35.8] | 29% |
| Intraday MR | 495 | −1.16 | per day | **71** | −1.27 | [−51.1, +10.8] | 10% |
| Swing MR | 578 | +0.48 | per day | **242** | +0.42 | [−86.4, +134.0] | 67% |
| XSec momentum | 488 | −1.66 | per rebalance | **67** | −1.28 | [−1274.6, +268.1] | 11% |

`P(mean > 0)` is a stationary block bootstrap (block 5, 4,000 draws) on the aggregated series.

**No family reaches |t| > 2 under either method.** The correction does not rescue anything; it
mainly reveals that 589 trades were 67 experiments.

## The defensible conclusion

> **None of the five canonical seeds currently provides evidence of positive gross expectancy.**

Per family, at the honest strength the evidence supports:

| family | label |
|---|---|
| ORB | NO OBSERVED GROSS EDGE |
| RVOL breakout | NO OBSERVED GROSS EDGE |
| Intraday MR | NO OBSERVED GROSS EDGE |
| Swing MR | POSSIBLE WEAK GROSS EFFECT — not distinguishable from zero, and insufficient to cover costs |
| XSec momentum | CURRENT SPEC POINTS THE WRONG WAY — not yet a diagnosis of why |

## Two wordings corrected

**Not** "no parameter search rescues an idea with no gross edge." A negative centre-of-range seed
does not prove every parameterisation is empty — a family can be negative at its centre and
positive at some lookback. What is true, and is the point:

> A negative canonical seed provides **no empirical justification for moving parameters toward
> whatever happened to perform best.** Doing that converts *hypothesis → test* into
> *returns → search → hypothesis invented afterwards*, which is exactly the selection bias DSR and
> PBO exist to correct.

So the registered variant search stays. It simply may not begin unofficially, ahead of counted
trials, steered by this measurement.

**Not** "this data could never support discovery." A small sample can carry a large, clean effect.
This one does not: tiny noisy gross means over 18 intraday instruments and ~40 sessions. The honest
form is that **the current sample supports refusing to claim an edge; it does not prove these
families cannot contain one.** That is precisely what the frozen 60-instrument floor encodes.

## What this does and does not license

It does not license tuning, reversing the cross-sectional seed because it lost, changing any
declared criterion, or spending a trial. `xsec_momentum` at −503 bps per rebalance deserves a later
*diagnosis* — horizon, skip period, direction, regime, or portfolio construction — and reversing it
into a mean-reversion strategy on the strength of a negative backtest would be post-hoc discovery
unless separately registered.

What it does license is a shift in where the next intellectual investment goes: from tuning toward
**hypotheses with an economic mechanism**. The question a future family should have to answer
before it earns trial budget:

> **Who keeps leaving this return available, and why can they not stop?**
