# M02 — the first canonical exploratory probe

2026-08-17. **Verdict: REJECTED — NO_GROSS_EDGE.** Recorded so it is not re-derived.

## What was asked

Liquidity-conditioned intermediate momentum: 6-month formation, 1-month hold, monthly rebalance,
top-10% liquidity cohort, winner and loser quintiles. Contract frozen and hashed **before** the
first result; the liquidity bucket predeclared once rather than swept.

M02 was run before M01 on the owner's correction, from the external evidence: the source study
defines short-term formation as J=1/J=3 and reports only limited short-term momentum, while
intermediate (J=6) and long-term momentum are robust. Choosing J=6 first is picking the experiment
the evidence points at, before seeing any output.

## The result

```
                                  gross      cost       net      PF    HAC t    P(>0)
LONG-SHORT (factor spread)        -52.6        76    -128.6    0.86    -0.79      23%
LONG-ONLY winners                 122.4        38      84.4    1.48     1.69      96%
LONG-ONLY minus its own cohort     12.5        38     -25.5    1.06     0.33      63%
```
*bps per month, 221 rebalances, 358 instruments.*

```
era          rebalances    long-short     long-only
2000-2007            0   not measured  not measured
2008-2014           83          -97.3         166.2
2015-2019           60         -140.8         -54.9
2020-2026           78           62.6         212.1
```

## What it means

**The factor spread is negative.** Winners underperformed losers by 52.6 bps a month gross, before
any friction. On this cohort, over this period, with this liquidity proxy, intermediate momentum
did not merely fail to pay for itself — it pointed the wrong way. The sign also flips across eras.

**The long-only leg is the trap.** It shows +122.4 bps gross, +84.4 net, profit factor 1.48 and
P(mean > 0) of 96%. Reported alone it reads as a working strategy. Against its own cohort it adds
**12.5 bps**, which does not cover 38 bps of cost, at t = 0.33.

So essentially all of the long-only leg is the return of liquid Indian equities over 2008-2026, not
momentum selection. Without the excess-over-cohort measure this would have been a plausible
"strategy" built entirely from market beta — and it is exactly the confusion the owner flagged in
advance, in the opposite direction to the one anticipated.

**2000-2007 was not measured.** Too few instruments were listed and liquid enough to form a 20-name
cohort at 10% of the universe. That is a gap in coverage, not evidence of no effect, and the report
says so rather than printing a zero.

## Why the number is trustworthy — and where it is not

The probe was validated against controls before its output was believed:

```
POSITIVE control (engineered momentum)   spread  +92.1 bps   t = 4.61   -> detected
NULL control (no persistent component)   spread  +10.6 bps   t = 1.03   -> correctly silent
```

Two fixture defects were found and fixed on the way, each of which would have produced a confident
wrong conclusion:

1. **Volume scaled with drift**, so the top-10% liquidity cohort held only high-drift names with no
   dispersion left to rank. The positive control read ~0 bps and looked like a blind instrument.
2. **The first "null" was not null** — drift re-randomised every 21 days, which is the holding
   period, so recent formation genuinely predicted the hold and the null showed +44 bps at t = 2.25.
   A negative control that is not null silently licenses trusting the instrument.

Also verified: no lookahead (perturbing bars after a cutoff leaves every earlier rebalance
byte-identical), determinism, point-in-time listing eligibility, and refusal to rank a cohort below
20 names rather than reporting a 4-name "decile".

**What is NOT sound:** the universe. The deep cohort was selected on 2025-2026 traded value, so every
name that delisted or fell out of liquidity before then is absent. For a momentum study run back to
2008 that is survivorship bias in the universe itself.

**Correction to a claim made in the original commit message.** That commit said the bias "biases
toward finding an effect, which makes a negative result more credible, not less". That is wrong.
Current-survivor and current-liquidity selection can distort a factor in **either** direction —
excluding the names that collapsed removes both losers that would have widened a momentum spread and
losers that would have narrowed it, and the net sign is not knowable without the missing names. The
bias blocks promotion; it says nothing about which way the measured number is wrong.

## What this is not

- **Not a replication.** The source conditions on turnover ratio (shares traded / shares
  outstanding). No point-in-time shares-outstanding history exists here, so rupee traded value was
  substituted. `NOT_A_DIRECT_REPLICATION`.
- **Not the same market.** Evidence is BSE-listed equities; this is NSE. `transferAssumption: UNPROVEN`.
- **Not evidence.** The data was obtained under `EXPLORATORY_ONLY_UNDER_UNKNOWN_ACCESS_BASIS`.
  validation / trial / holdout / forward / paper all remain false.

A negative result under a substituted proxy does not refute the published finding. It says this
proxy, on this cohort, over this period, does not reproduce it.

## Consequence

M02 is rejected under the predeclared kill rule — gross ≤ 0, so no Sharpe was computed. The
rejection and its reason are recorded against the hypothesis fingerprint so an economically
equivalent idea returning under different wording collides with it.

The verdict is deliberately narrow: **M02 is rejected for this exploratory NSE cohort, this rupee-
liquidity proxy, and this 6m/1m contract.** It is not a finding about Indian momentum.

**This does not clear M01.** 3-month formation is a different claim and the evidence for it was
weaker to begin with; the honest expectation after this is lower, not unchanged.

Nothing was tuned. No parameter was moved toward what performed better. QC-001 untouched.
