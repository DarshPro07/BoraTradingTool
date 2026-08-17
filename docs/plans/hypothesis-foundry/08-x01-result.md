# X01 — MAX / lottery effect, direction registered as UNKNOWN

2026-08-17. **Verdict: REJECTED — sign unstable across eras, and dependence-aware evidence null.**

## Why no prior direction was registered

The classic US MAX anomaly predicts high-MAX stocks underperform. The Indian evidence contradicts
itself: a 2019 study (~2,949 firms/month, 2003-2017) found high-MAX stocks **OUT**performed with no
negative relation, while a 2024 study (2001-2021) finds MAX carries unique information without
establishing the classic sign. Registering a directional prior that evidence does not support would
have invited choosing the sign after the result.

So the spread was declared as `HIGH_MAX_MINUS_LOW_MAX` and is reported signed exactly that way.

## The result

```
                                   gross     cost      net      PF    HAC t    P(>0)
SPREAD  HIGH_MAX minus LOW_MAX      78.0       76      2.0    1.38     1.71      97%
HIGH-MAX leg vs its own cohort      49.5       38     11.5    1.40     1.81      98%
LOW-MAX  leg vs its own cohort     -28.5       38    -66.5    0.79    -1.36       8%
```
*bps per month · 278 rebalances · 358 instruments*

```
era          rebalances    spread gross
2000-2007            56           129.6
2008-2014            84           109.8
2015-2019            60           -49.8
2020-2026            78           104.9
```

## What it says

**The sign is POSITIVE** — high-MAX outperformed low-MAX by 78 bps/month gross. That is the
*India-style* relation the 2019 study reports, and the **opposite** of the classic US lottery
anomaly. Had X01 been registered as "short high MAX" per the classic account, this would have been
a confidently wrong bet, and the direction-neutral registration is the only reason the result is
readable at all.

**And it is still rejected**, on the predeclared kill rule, for two independent reasons:

1. **The sign flips.** 2015-2019 is −49.8 against +129.6 / +109.8 / +104.9 elsewhere. An effect that
   reverses for a five-year stretch is not a stable mechanism, whatever the pooled mean says.
2. **The dependence-aware evidence is null.** HAC t = 1.71 over 278 rebalances, 95% CI
   [−11, +167] bps — it includes zero. `P(mean > 0) = 97%` from the bootstrap looks decisive and is
   not: it is the probability the *mean* exceeds zero under resampling, not evidence of a
   tradeable effect, and the two disagree here precisely because the series is heavy-tailed.

**And the economics are absent anyway.** 78 bps gross against 76 bps of two-leg friction leaves
**+2.0 bps/month**. Even taking the point estimate at face value and ignoring the instability, the
spread pays for its own execution and nothing else.

The long-only HIGH leg is the least-bad reading: +49.5 bps over its own cohort, +11.5 net, t = 1.81.
That is genuine selection rather than beta — unlike M02's long leg — but it is still not significant
and still flips sign with the spread.

## Trustworthy because the controls ran first

Per Foundry policy, no real-data result is believed until the probe detects a planted effect and
stays silent in a true null. X01 is direction-neutral, so the positive control was run **both ways**:

```
planted POSITIVE relation   spread > +50 bps, t > +2    -> recovered
planted NEGATIVE relation   spread < -50 bps, t < -2    -> recovered
genuine null                |spread| < 30 bps, |t| < 2  -> correctly silent
```

The null caught a real fixture defect on the way. A first version keyed synthetic "months" off
`floor(i / 21)` while rebalances land on calendar month-ends; the two drift apart, so a formation
window could straddle two synthetic months and pick up a spike whose companion drift landed inside
the holding window. **The null world reported +213 bps.** Had that gone unnoticed, the probe would
have been validated on an artifact and the +78 bps read as corroborated.

Also verified: MAX computed from the formation window only (perturbing bars after a cutoff leaves
every earlier rebalance byte-identical), determinism, both legs measured against the cohort, and
refusal to rank a cohort under 20 names.

## Limitations that are not fixable here

- **Price-band censoring — `KNOWN_UNMODELED_LIMITATION`.** NSE applies daily bands of 2/5/10/20%.
  MAX is literally the largest observed daily return, so for a banded stock it is censored *by
  exchange rule*: a name that would have printed 14% shows 10% and ranks as unexceptional. No
  point-in-time band assignments are held, and inventing them would fabricate the variable under
  test. This is the first robustness question if MAX is ever revisited.
- **Survivorship.** The cohort was selected on 2025-2026 traded value. Direction of distortion
  unknown.
- **Rights.** `EXPLORATORY_ONLY_UNDER_UNKNOWN_ACCESS_BASIS` — validation, trial, holdout, forward
  and paper all remain false.

## What was NOT done

No parameter was moved in response to the result. MAX1/MAX3/MAX5, alternative quantiles, alternative
holds and alternative liquidity cohorts were **not** tried — that would convert one pre-registered
hypothesis into an uncounted optimizer, which is the failure mode the whole Foundry exists to
prevent. The 2015-2019 reversal is recorded as a fact, not investigated for a conditioning variable
that would make it disappear.

## Where this leaves the queue

```
M02  REJECTED  no gross edge, factor spread negative
X01  REJECTED  sign unstable across eras; dependence-aware evidence null; net +2 bps
      |
S01  skewness — next. Note it shares X01's lottery-preference mechanism, so if S01
     shows the same instability that is ONE finding about lottery demand in NSE
     equities, not two independent ones.
V01  return-volume regime
M01  3m momentum — last, after M02
```
