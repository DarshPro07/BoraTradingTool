# Gate 0 — Reality: why the strategy funnel sat at 2 of 10

Found by asking the pre-registered gate what was actually blocking, rather than assuming the
bottleneck was data breadth.

## The blocker list (hash `19e571a36128b1ef`, read 2026-08-16)

12 blockers: **10 autonomous, 2 external.** Nine of the ten are the intraday breadth chain
(6 family-ready against 60 required), gated by the accumulator's 20h cadence and the
12-instrument discipline — both frozen, neither acceleratable today.

One is not time-gated at all:

```
pool: 2 strategy(ies) standing ready to spend a trial; 10 required
```

`factory_generation` had run 24 times in six hours. The pool had not moved.

## Where the candidates actually were

`OBSERVED`, from `standings()`:

| stage | count | blockedOn |
|---|---|---|
| draft | 18 | rehearsal |
| rehearsed | 2 | gauntlet |
| graveyard | 2 | — |

The factory was not the constraint. **Rehearsal was**: 18 drafts waiting on it.

## Why rehearsal was not converting them

`REPRODUCED`, from `rehearsal_outcomes` (21 rows):

| verdict | n |
|---|---|
| not_evaluable | 12 |
| would_fail | 7 |
| would_pass | 2 |

Twelve of twenty-one produced no judgement at all, for three distinct reasons:

```
n=8   INSUFFICIENT_BARS: IN:XNSE:ALPINETEX has 19 bars; 30 is the minimum.
n=3   FEATURE_NOT_AVAILABLE: no engine here derives market_cap
n=1   Inconclusive: the battery lacked evidence
```

## Root cause of the dominant class

`STATICALLY_CONFIRMED` + `REPRODUCED`. `lib/backtest/portfolio.ts:236`:

```ts
for (const [instrumentId, bars] of entries) {
  if (bars.length < MIN_BARS) {
    return { ok: false, code: "INSUFFICIENT_BARS", ... };   // aborts the ENTIRE portfolio
  }
```

One instrument below 30 bars refuses the whole run. Measured against the live store:

| resolution | instruments | below 30 bars |
|---|---|---|
| D | 1,728 | **15 (0.9%)** |
| 5 | 14 | 0 |
| 15 | 16 | 0 |
| 60 | 21 | 5 (23.8%) |

**Under 1% of the universe was destroying 100% of the evidence.** The fifteen are recent
listings: ARDEE(3), JNPR(6), MVELECTRO(7), MANIPALHOS(8), INDOMIM(12), LCL(12), CMLL(16),
CPL(17), ALPINETEX(19), SBIFUNDS(19), LASERPOWER(22), RIR(22), KUSUMGAR(23), GYFTR(26),
KNACK(28) — nothing wrong with them except youth.

## The design question this raises, and the answer

Excluding instruments silently would be the worse defect: a verdict over a quietly reduced
universe is a verdict about a different question. But aborting produces *no* evidence, and the
instrument that triggers it contributes nothing either way.

So: **exclude and report.** The count and the names ride out in `PortfolioRun.instrumentsExcluded`
and into the recorded rehearsal reason. When *nothing* qualifies, the original refusal is still
correct and is kept.

Deliberately NOT changed: the filter was not moved into the dataset snapshot. Snapshots are
fingerprinted and pinned into the experiment ledger and holdout seals; changing what enters one
would disturb research-integrity machinery to fix an engine-level defect.

Also NOT changed: `UNORDERED_BARS` still aborts. That is a provider defect, and its own guard
exists to surface it — excluding it would hide exactly what it was written to catch.

## Recorded, not chased

- At 60m resolution, 5 of 21 tickers are numeric BSE scrip codes (`500112`, `500209`, `500325`,
  `500510`, `500696`) sitting in an NSE universe. A ticker-namespace question, unrelated to this
  defect. `OBSERVED`, untouched.
- Two market vocabularies coexist: the catalog says `IN`, `snapshotFromStore` says `NSE`. Cost a
  wrong-looking refusal during this investigation. `OBSERVED`, untouched.
- `would_fail` runs report 8,048–9,370 signals dropped for lack of a free position slot against
  1,963 trades taken. The verdict may describe capacity starvation rather than a bad edge. That is
  a research-design question, honestly reported by the engine, and is not a defect.
