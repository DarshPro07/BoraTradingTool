# V01 parked behind a frozen contract; S01 run and rejected

2026-08-17.

## V01-CONFIRM-001 — frozen while there is nothing to run it on

That is the point. Pre-registration confers confirmatory value only while analytic choices stay
independent of observed outcomes. V01 was corrected after its results were seen, so the correction
is legitimate and its confirmatory status is gone. The only way to get it back is to freeze the next
test before its data exists — every field below was chosen with no ability to peek.

```
formation 5 · volume baseline 20 · hold 21 · monthly
extreme quintile · volume split at cohort median
liquidity top 30% by median rupee traded value · cost 38 bps/leg
decision unit: one observation per rebalance
inference: Newey-West HAC + stationary block bootstrap
primary: interaction ONLY — secondarySubstitutionAllowed: false
direction under test: POSITIVE (frozen from V01r, not left open)
minimum evidence: t >= 2.0 AND sign matches AND gross > 76 bps
                  AND >= 60 decision units AND sign stable across measured eras
```

Hashed. Changing any field makes a different contract.

### A different provider is not independent evidence

Made structural rather than remembered, because it is the easiest mistake available:

```
different provider, same market observations   -> SOURCE_REPLICATION            refused
never-touched historical cohort                -> WEAK_CROSS_SECTIONAL_REPL.    refused
market data that did not exist at discovery    -> INDEPENDENT_ALPHA_CONFIRM.    admitted
```

If an authenticated Upstox account later supplies the same stocks over the same dates, comparing it
against the existing candles is excellent **source replication** — it raises confidence that the
numbers are the numbers. It is the same realised market history, so it cannot re-test a hypothesis
that history produced.

`admitForConfirmation` fails closed on three axes: a burned cohort, insufficient independence, or
observations that predate the freeze. The 358-name cohort is in `BURNED_FOR_DISCOVERY` permanently,
and re-slicing it by date, sector or subset does not change that — tested explicitly.

## Statuses, in vocabulary that distinguishes a bug from a rejection

| | |
|---|---|
| M02 | `REJECTED` — factor spread negative before friction |
| X01 | `INVALIDATED_BY_IMPLEMENTATION_BUG` — liquidity over 22 sessions, contract declared 20 |
| X01r | `REJECTED` — 83.4 bps, t 1.87, sign still flips |
| V01 | `INVALIDATED_BY_IMPLEMENTATION_BUG` — volume paired with another bar's close |
| V01r | `EXPLORATORY_CORRECTED_REANALYSIS` — 127.0 bps, t 2.12, corrected after results were seen |
| V01 (hypothesis) | `AWAITING_INDEPENDENT_CONFIRMATION` — parked behind V01-CONFIRM-001 |
| H08 | `AWAITING_INDEPENDENT_CONFIRMATION` — post-hoc, immutable |
| S01 | `REJECTED` |

`REJECTED` alone would flatten three different things: a hypothesis the data refuted, a run whose
implementation was wrong, and a re-analysis that is legitimate but no longer confirmatory.

## S01 — rejected, and mostly X01 in disguise

Registered direction-neutral with `independentOfRelated: false` **before** it ran.

```
                                        gross     cost      net      PF    HAC t
SPREAD  HIGH_SKEW minus LOW_SKEW  <-     53.4       76    -22.6    1.33     1.65
HIGH-SKEW leg vs its own cohort          47.1       38      9.1    1.48     2.05
LOW-SKEW  leg vs its own cohort          -6.3       38    -44.3    0.94    -0.36
HIGH-SKEW leg, MAX-EXTREME REMOVED       25.1       38    -12.9    1.19     1.05
```
*bps/month · 271 rebalances · eras +104.6 / +28.4 / +26.7 / +68.6*

**Rejected on the predeclared rule**: 53.4 bps cannot cover 76 bps of two-leg friction.

The last row is the one that matters. S01's falsification condition, written before the run, was
that the effect vanishing once MAX is controlled for would make S01 "X01 wearing a different
statistic". Removing the MAX-extreme names **halves the high-skew leg (47.1 → 25.1 bps) and takes it
from t = 2.05 to t = 1.05.** Most of what skewness appeared to find was the lottery-day names X01
already ranks.

So the finding, stated at the strength the evidence supports:

> Two observables inside the lottery/higher-moment mechanism behave alike in NSE equities, in the
> same positive direction, and neither clears its friction. That is **one** result about lottery
> demand, not two.

## Controls, and the fourth fixture defect they caught

```
planted POSITIVE   -> recovered      planted NEGATIVE  -> recovered
genuine null       -> silent, CI spans zero
```

Two fixture faults surfaced on the way, both of which would have produced confident wrong readings:

1. **Uncompensated jumps.** Right-skewed names got +6% jumps with no offset, so the high-skew group
   carried a built-in +24 bps/session drift. The NEGATIVE control returned **+30.9 bps — the wrong
   sign** — because the fixture's own drift decided the answer. Real skew is many small losses
   against rare large gains at roughly zero mean.
2. **Liquidity confounded with the planted effect.** Liquidity is `close × volume`, and a planted
   drift makes the high-skew group's prices diverge upward, so the top-30% cohort filled with
   winners and both quintiles were drawn from the same planted group. Tripling the planted effect
   moved the measured spread only from 38 to 43 bps — a response so far from proportional it could
   only be a fixture fault. Fixed by holding traded value constant.

That is M02's confound wearing `close` instead of `volume`. Four probes, four fixture defects caught
before real data was believed.

## Programme state

```
registeredTrialCount    0
probeDiscoveryLooks    22
probes                  M02, S01, V01, V01r, X01, X01r
proven NSE edge         0
```

```
V01r.cell.negNormal.corrected      t  3.10   raw .0019   Holm .0426
V01.cell.negNormal                 t  3.01   raw .0026   Holm .0549
V01r.interaction.corrected         t  2.12   raw .0340   Holm .6461
S01.highVsCohort                   t  2.05   raw .0404   Holm .7266
```

Two numbers, both true, answering different questions: V01r's primary is interesting on this sample
(HAC t = 2.12); and given everything looked at, no result here is surprising enough to claim
discovery. Neither reading is the other's refutation.

**Next: M01**, the last of the admitted hypotheses. After that the Foundry runs out of
economically-plausible ideas on price-and-volume data alone, and saying so is preferable to
weakening admission until something backtests green.
