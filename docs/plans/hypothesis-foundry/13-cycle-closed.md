# M01 rejected; the exploratory price/volume cycle is closed

2026-08-17. Five mechanisms tested. **Proven NSE edge: 0.**

## M01

Definition unchanged from registration, and it differs from M02 in **exactly one field** — asserted
in a test, because that assertion is the entire justification for running it after M02 failed. Same
liquidity cohort, same quintiles, same costs, same benchmark, same inference; formation 63 sessions
against M02's 126.

```
                                    gross     cost      net      PF    HAC t    signProb
LONG-SHORT factor spread  <-         -71.9       76   -147.9    0.81    -1.27         10%
LONG-ONLY winners (absolute)          87.5       38     49.5    1.33     1.29         91%
WINNERS vs their own cohort          -16.2       38    -54.2    0.92    -0.47         32%
LOSERS  vs their own cohort           55.7       38     17.7    1.33     1.83         96%
```
*bps/month · 223 rebalances · 358 instruments*

```
era          rebalances    long-short     long-only
2000-2007             1       -1206.0       -2904.8
2008-2014            84         -29.0         176.0
2015-2019            60        -157.2         -68.5
2020-2026            78         -38.0         150.7
```

**Rejected: the factor spread is negative.** No Sharpe computed.

Three things worth reading precisely:

**The long-only leg is M02's trap again.** +87.5 bps absolute looks tradeable; against its own cohort
it is **−16.2 bps**. All of it, and slightly more, is exposure to liquid Indian equities.

**"Sign stable: YES" is doing less work than it appears.** The 2000-2007 era carries **one
rebalance** at −1206 bps. One observation is not an era, and the kill check's stability flag counts
it equally. Reported here rather than left in the flag, because a reader would otherwise take
four-era consistency at face value.

**The losers outperformed.** +55.7 bps over cohort at t = 1.83 — the mirror of the negative spread,
and consistent in direction with reversal rather than momentum. That is an observation, recorded as
a look. **It does not become a hypothesis.** R01 already sits refused at the plausibility gate for
illiquid reversal, and inventing "liquid short-horizon reversal" now because momentum failed twice
is exactly the reflex the Foundry exists to prevent.

## The cycle

```
M02   6m/1m momentum         REJECTED   factor spread negative
M01   3m/1m momentum         REJECTED   factor spread negative, same direction
X01   MAX / lottery          REJECTED   sign unstable, evidence null (corrected: t 1.87)
S01   skewness               REJECTED   below friction; halves once MAX is controlled for
V01   return x volume        AWAITING INDEPENDENT CONFIRMATION (corrected: t 2.12)
H08   normal-vol reversal    AWAITING INDEPENDENT CONFIRMATION (post-hoc, immutable)
DC01  day-character study    DATA-BLOCKED, contract frozen
R01   illiquid reversal      refused at the gate (2.37x vs 3x required)
I01   idiosyncratic vol      refused at the gate (1.84x vs 2x required)
```

**No additional admitted runnable hypotheses.** The Foundry says that rather than reaching for
another indicator. R01 and I01 stay refused at their original hurdles; neither is re-priced because
the queue emptied.

```
registeredTrialCount    0
probeDiscoveryLooks    26
proven NSE edge         0
```

Strongest six statistics of the entire cycle, Holm-adjusted across all 26 looks:

```
V01r.cell.negNormal.corrected      t  3.10   raw .0019   Holm .0503
V01.cell.negNormal                 t  3.01   raw .0026   Holm .0653
V01r.normalVolumeSpread.corrected  t -2.21   raw .0271   Holm .6505
V01r.interaction.corrected         t  2.12   raw .0340   Holm .7821
S01.highVsCohort                   t  2.05   raw .0404   Holm .8880
X01r.highVsCohort.corrected        t  1.99   raw .0466   Holm .9784
```

Note what four more looks did: `negNormal` crossed from Holm .044 to **.0503** — the strongest thing
this cycle produced no longer clears .05 once the full search is counted. Nothing about that
statistic changed. The denominator did, and that is the ledger working exactly as intended.

## What the cycle actually established

Two findings, stated at the strength the evidence supports.

**Cross-sectional momentum points the wrong way on this cohort, at both horizons tested.** M02 and
M01 agree in sign, and M01's loser leg beats its cohort. That is one finding about this exploratory
cohort — not two independent confirmations, since they share a mechanism and a universe.

**The lottery/higher-moment family shows a weak positive pattern that does not clear friction.** X01
and S01 point the same way, and S01's effect halves under MAX control. Also one finding, not two.

Neither is an edge. Both are the kind of negative result that stops money being spent.

## The one candidate that earned waiting

V01 is the only mechanism whose economics, era-consistency and magnitude all survived — and it
survived a bug fix that moved it favourably, which is why it is parked behind V01-CONFIRM-001 rather
than believed. Its confirmation needs market data that did not exist on 2026-08-17. The 358-name
cohort is burned for it permanently.

## What happens now

Not more probes. The remaining questions are about data, not code:

- **V01 confirmation** needs prospective data. The clock only runs forward, and nothing shortens it.
- **DC01** needs NIFTY futures with a roll calendar and India VIX. Contract frozen; no
  futures-roll architecture built against imaginary data.
- **The event lane** needs a procurement decision that four rejected mechanisms do not by themselves
  justify.

The honest summary of the day: the Foundry was built, exercised five times, and produced five
rejections and one parked candidate. It caught five fixture defects and two implementation bugs
before believing any number. That is the machine working — and it is not the same thing as making
money.
