# V01 — return × volume regime, direction registered as UNKNOWN

2026-08-17. **Verdict on the pre-registered hypothesis: REJECTED — dependence-aware evidence null.**
**Plus one post-hoc observation that must not be treated as a result.**

## The pre-registered primary statistic

The question was whether the return following an extreme move depends on the volume it happened
under. The primary statistic was declared as the **interaction**, before any output existed:

```
interaction = (POS_HIGH - NEG_HIGH) - (POS_NORMAL - NEG_NORMAL)
```

```
                          gross      net      PF    HAC t      95% CI    signProb
INTERACTION  <- PRIMARY   114.1     38.1    1.39     1.74   [-15, 243]        96%
  high-volume spread      -16.3    -92.3    0.94    -0.38   [-100, 68]        35%
  normal-volume spread   -130.4   -206.4    0.69    -1.92    [-264, 3]         2%

era interaction:  +62.1   +68.4   +103.2   +197.9      (261 rebalances)
```

This is the closest any probe has come. It clears its friction (114 vs 76 bps), and unlike X01 the
**sign is stable across all four eras**. But HAC t = 1.74 with a 95% CI of [−15, +243] does not
reject zero, and the predeclared kill rule rejects on exactly that. `signProb 96%` is *not* a
p-value — it is the fraction of resampled means above zero, and 96% one-sided corresponds to
roughly this same t.

**Rejected.**

## The post-hoc observation, labelled as such

The four cells, each measured in excess of the same cohort on the same rebalance date:

```
             gross      net      PF    HAC t      95% CI    signProb
posHigh      -16.0    -54.0    0.90    -0.68    [-62, 30]        26%
posNormal    -34.4    -72.4    0.87    -0.64   [-139, 71]        24%
negHigh        0.2    -37.8    1.00     0.01    [-50, 51]        49%
negNormal     96.0     58.0    1.65     3.01    [ 34, 158]       100%
```

`negNormal` — a large negative move on **normal** volume — is the first cell in three probes with
|t| > 2. And it has a coherent story: a sharp fall on ordinary volume looks like liquidity demand
and reverses (+96 bps excess), while the same fall on heavy volume looks like information and does
not (+0.2 bps). That is the information-versus-liquidity distinction the mechanism section named.

**It is still not a result, for three reasons.**

1. **It was not the pre-registered statistic.** The declared primary was the interaction, and it
   failed. Promoting a subsidiary cell because it looks better is precisely the substitution the
   whole contract exists to forbid.
2. **Seven statistics were examined here** (four cells, three spreads). A two-sided p for t = 3.01
   at ~260 df is about 0.0028; Bonferroni over seven gives ≈ 0.020. Across all three probes run so
   far — M02's three, X01's three, V01's seven — that is thirteen, giving ≈ 0.036. Still under 0.05,
   and much less impressive than t = 3.01 reads unadjusted.
3. **Nothing in the system counted those thirteen.** PBO and DSR exist only at the registered-campaign
   stage. Probe-level multiple testing is currently unaccounted, which was named as a weakness in
   this session's own code audit and this is the first time it has bitten.

So `negNormal` is recorded as **a new hypothesis requiring separate pre-registration**, not as
evidence. If it is ever tested, it must be on a fresh contract with its own controls, and the fact
that it was discovered post-hoc travels with it permanently.

## Controls, run before the real data

Three worlds, because the hypothesis allows either direction:

```
CONTINUATION (planted)   interaction  +673.9 bps   t = +20.99   -> recovered
REVERSAL     (planted)   interaction  -734.7 bps   t = -26.51   -> recovered
NULL                     interaction   -36.9 bps   t =  -0.79   -> correctly silent, CI spans zero
```

Also verified: every cell measured against the same cohort on the same date; returns and volume read
only from before the rebalance date (perturbing later bars, including a 7x volume shock, leaves
every earlier rebalance byte-identical); a rebalance with any empty cell is skipped rather than
filled with a zero that would read as "no effect"; determinism.

## Scope and limitations

- `MECHANISM_ONLY_NO_TRADING_RULE_CLAIMED` — the source documents return-volume dynamics and
  investor biases, not a profitable rule.
- No sector conditioning: sector coverage here is externally constrained to ~38% of the universe.
- Survivorship: cohort selected on 2025-2026 traded value, direction of distortion unknown.
- `EXPLORATORY_ONLY_UNDER_UNKNOWN_ACCESS_BASIS` — validation, trial, holdout, forward and paper all
  remain false.

## Where the programme stands

```
mechanisms tested        3
credible positive edge   0

M02  momentum          REJECTED  factor spread negative
X01  MAX / lottery     REJECTED  sign unstable, evidence null, net +2 bps
V01  return x volume   REJECTED  pre-registered interaction not significant (t = 1.74)
                                 + one post-hoc cell flagged for separate registration
```

V01 is the most interesting rejection so far: it clears friction, it is sign-stable across four
eras, and its cell structure tells an economically coherent story. None of that is significance, and
the difference between "interesting" and "established" is the only thing keeping this honest.

**Next: S01** — with the standing caveat that it shares X01's lottery-preference mechanism, so a
similar result is one finding about lottery demand in NSE equities, not independent corroboration.
