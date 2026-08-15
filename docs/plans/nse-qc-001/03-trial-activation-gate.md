# NSE-QC-001 — the trial-activation gate, PRE-REGISTERED 2026-08-16

**Declared before any family was tested.** Every intraday family sat at 6 qualified instruments
and no trial had been spent when these criteria were fixed. Deciding when to start spending
permanent statistical trials *after* seeing which families look promising is the same selection
bias the campaign apparatus exists to prevent — moved one level up — so the rule is registered
like a trial protocol, before enrolment.

Declaration: `lib/strategy/trial-activation.ts` · criteria hash **`0f86755bbbebcaec`**, pinned
literally in `trial-activation.test.ts`. Changing a threshold changes the hash and fails that
test by design: loosening the bar is permitted, but only as a deliberate, visible act.

## The criteria (conjunctive — every one must hold)

| Criterion | Threshold | Why this number |
|---|---|---|
| Family-ready breadth, INTRADAY families | 60 qualified instruments | The smallest cross-section over which a per-instrument intraday edge can be told from a handful of lucky names; ~3% of the main board rather than a round percentage. |
| Family-ready breadth, DAILY families | 150 | Higher because cross-sectional momentum RANKS its universe — a ranking over a thin universe measures the universe, not the signal. |
| Liquidity representation | all 3 buckets | An edge existing only in the most liquid tercile is a different claim from a market-wide one and must not masquerade as one. Buckets are fixed rupee floors on median daily turnover (≥₹10cr HIGH, ≥₹1cr MEDIUM, below LOW) — quantiles of the ready set would always yield three buckets and could never fail. |
| Sector representation | 5 distinct sectors | So no single sector's regime can carry a family's result. |
| READY_FOR_GAUNTLET pool | 10 strategies | So the first trials are drawn from a real candidate set rather than whatever compiled first. |

Deliberately NOT "coverage > 10% → ON": a smaller but diverse sample is scientifically more
useful than a larger concentrated one.

## Fails closed

A criterion the system cannot MEASURE is **not satisfied**. Sector classification is exactly
that today — the synced NSE master carries series and asset type but no industry map, and the
`stocks` table that has the columns holds no rows. The gate reports `UNMEASURABLE`, stays shut,
and names the ingestion that would open it. Inventing a sector map to make a gate pass would be
the most expensive kind of convenience.

The owner's switch and the criteria are **independent facts**, and the decision says which is
which — including the honest "ON BY SWITCH while the pre-registered criteria are NOT satisfied"
case, which the gate will state rather than hide.

## First live evaluation (production copy, 2026-08-16 03:48 IST)

```
GATE: OFF — the pre-registered criteria are not satisfied.
criteria hash 0f86755bbbebcaec · readyForGauntlet 2

· pool: 2 strategy(ies) standing ready to spend a trial; 10 required
· Opening Range Breakout — family-ready breadth: 6 qualified; 60 required
· Opening Range Breakout — liquidity representation: 1 of 3 buckets represented (HIGH)
· Opening Range Breakout — sector representation: UNMEASURABLE (no classification ingested)
  … same for RVOL and intraday MR
```

**The gate earned its place on day one.** The liquidity criterion revealed that all six
ORB-ready instruments sit in the HIGH bucket alone — precisely the concentration bias that makes
a coverage percentage a misleading trigger. A naive "10% coverage" rule would eventually have
opened on a sample that measures large-cap liquidity rather than the hypothesis.

Family-ready at the same moment, with the quality ladder applied: ORB / RVOL / intraday MR **6**
each (162 blocked on intraday), swing momentum **148**, swing MR **152** — the swing families
grew from 77/78 six hours earlier as the daily planner worked.

## The quality ladder behind those numbers

DATA PRESENT → SESSION COMPLETE → QUALITY PASS → FAMILY READY. Sessions now count only when they
hold ≥80% of a full day's bars, and the families that trade the open (ORB, RVOL) additionally
require a populated opening window — a session missing its first bars is useless to them however
complete the rest of the day is. Session dates come from the market's own timezone via
`sessionStamps`, not a UTC slice that would misfile every afternoon bar.

Measured effect on the live data: of the 14 main-board instruments holding any 5m data, **all 14
have complete sessions and populated opening windows** — the accumulated data is clean, so the
ladder cost nothing here while guaranteeing that future half-empty days cannot inflate a count.

## Verification

Units **171 files / 1887 passed / 2 skipped / 0 failed**; tsc silent; live e2e green on a fresh
DB and a production copy; the pinned hash asserted literally. `MARKETPULSE_AUTONOMOUS_TRIALS`
remains 0.
