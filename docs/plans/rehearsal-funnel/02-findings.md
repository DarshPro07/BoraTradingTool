# The real research population — what the funnel numbers were actually counting

Produced while looking for the next runnable blocker after the `INSUFFICIENT_BARS` fix. The
headline is a correction to the scoreboard, not a new capability.

## 64% of the strategy population is e2e test residue

`OBSERVED`. 22 specs in the production database; **14 are Playwright/e2e artifacts**, created by
actors `e2e`, `e2e-fixture`, and `http-20124`, several with `desktop_chromium` in the name:

```
e2e_ladder_fixture · e2e_ledger_api_… · e2e_rehearsal_row_… · e2e_ledger_ui_… ·
e2e_orb_… · e2e_quant_… · ledger_gap_screen_…×3 · forward_gap_screen_…×3 ·
probe_authored_null_…
```

They are in `marketpulse.db`, the production database — not a virgin e2e database. The e2e runbook
directs runs at `MARKETPULSE_DB_PATH=.tmp/master-runN.sqlite`, but nothing *enforces* it, so a run
launched without the override writes its fixtures into production through the dev server on :3000.

Consequence: "18 drafts", "22 strategies" and the pool criterion's denominator are all measuring a
population that is mostly test data, and the rehearsal rotation spends its 10-slot budget largely
on fixtures.

## The real population, and its real verdicts

`OBSERVED`, test actors excluded — 8 candidates with a verdict, 1 never rehearsed (correctly:
`rsi_reversion_30` is `rejected`).

| candidate | author | verdict | why |
|---|---|---|---|
| `gap_largecap_premarket` | claude_code | not_evaluable | `market_cap` |
| `gap_smallcap_premarket` | claude_code | not_evaluable | `market_cap` |
| `largecap_momentum` | owner | not_evaluable | `market_cap` |
| `sma_cross_20_50` | owner | **would_pass** | 24 instruments, 165 trades |
| `sma_cross_ui_probe` | owner | **would_pass** | 24 instruments, 165 trades |
| `orb_nse_5m` | claude-code | would_fail | failed all 5 simulations |
| `first_hour_momentum_nse_5m` | claude-code | would_fail | failed all 5 simulations |
| `gap_and_rvol_screen_transferred…` | scheduler | not_evaluable | inconclusive; 3 instruments, 12 trades |

### The pool's "2 ready" is one distinct strategy

`sma_cross_20_50` and `sma_cross_ui_probe` return **identical** results — 24 instruments, 165
trades, same reason. The second is a UI probe duplicate of the first. The honest count of distinct
strategies that have survived a rehearsal battery is **one**.

### `market_cap` blocks 3 of 8 (37.5%) and is EXTERNAL, not a defect

The `stocks` table that carries a `market_cap` column holds **0 rows**. Deriving the feature needs
point-in-time shares outstanding; applying a *current* market cap to historical bars is look-ahead
bias, which is precisely what `POINT_IN_TIME_FEATURES` exists to prevent.

So the refusal is the guardrail working. Resolution owner **EXTERNAL_PROVIDER** — the same shape
as the sector-classification dependency, and not something autonomous work can close.

One non-destructive path exists and is an owner decision, not an autonomous one: both gap screens
use `market_cap` only as a *universe filter* (large- vs small-cap). A derivable point-in-time
liquidity proxy (median turnover = price × volume) could express the same intent from bars alone.
That changes what the strategy tests, so it is proposed, never silently applied.

## Correction to the `INSUFFICIENT_BARS` fix's claimed impact

None of the eight `INSUFFICIENT_BARS` outcomes belonged to a real candidate — they were e2e
fixtures. The fix is genuine and preventive rather than immediately unblocking: the campaign's two
**swing** families (`swing cross-sectional momentum`, `swing mean reversion`) run over exactly the
NSE daily universe that contains the 15 thin listings, so every swing strategy would have been
structurally un-evaluable from the moment it was authored. The wall was found before it was hit,
not after.

## Capacity ordering: hypothesis tested and largely refuted

`REPRODUCED`. `portfolio.ts` breaks slot contention by `instrumentId.localeCompare` — arbitrary and
deliberately so. With 80% of signals rejected for capacity, the concern was that an alphabetical
tiebreak had become the primary selection mechanism. Tested by relabelling instruments to reverse
priority (identical bars, only contention order changed):

| rejection rate | Sharpe, alphabetical → reversed | change |
|---|---|---|
| 80.4% (real gap screens) | −0.9675 → −0.9555 | **1.2%** |
| 96.7% (`e2e_ladder_fixture`) | −0.2187 → −0.3026 | **38%** |

Negligible at the operating point that matters; material only above ~95%. No current verdict is
affected — all sit near Sharpe −0.97, far from any decision boundary. **Not a defect**; the
existing comment's reasoning holds. Worth revisiting only if a candidate ever passes *while*
capacity rejection exceeds ~95%.

## Open decisions for the owner (not taken autonomously)

1. **Test residue in production.** Deleting rows is a production-destructive operation. The
   non-destructive alternative is a read-model exclusion of test actors from the funnel, which
   depends on a heuristic (`http-20124` is an HTTP client id, not unambiguously a test actor).
2. **Enforcing the e2e database boundary** so this cannot recur.
3. **Re-expressing the two gap screens** against a derivable liquidity proxy instead of
   `market_cap`.


## Addendum — the pool's "2 ready" rests on verdicts that cannot be reproduced today

`REPRODUCED`. Both `would_pass` verdicts are dated **2026-08-09 15:41**. Every other verdict in the
ledger was refreshed on 2026-08-16. The two that make up the entire pool were not.

The mechanism is deliberate (`lib/learning/cycle.ts`):

```ts
if (outcome.dataMissing) { outageSkipped += 1; continue; }   // do not overwrite a verdict
```

`NO_DATA_REASON` exists precisely so the cycle can tell a durable capability gap from a transient
data outage, and refuse to destroy a real verdict because the provider rate-limited for ten
seconds. That is right.

But `sma_cross_20_50` is a **US-market** strategy, and the store holds **no US daily bars at all** —
`price_candles` at resolution `D` contains only `IN:` tickers (1,974 of them, 0 others). The
absence is not a ten-second outage; it has held for seven days and there is no ingestion path
supplying it. A durable condition is being treated as transient indefinitely, and the verdict it
protects never expires.

Consequences, both worth stating plainly:

1. The pre-registered gate reads **"2 strategy(ies) standing ready to spend a trial"** from
   evidence that cannot be reproduced against today's store. Re-run now, both return
   `not_evaluable`.
2. The system's only distinct `would_pass` strategy is on **US equities**, outside NSE-QC-001's
   universe entirely. It says nothing about the campaign's research question — which is a
   different and more important fact than its staleness.

The distinction the code draws is by reason TYPE, never by DURATION or by consecutive-attempt
count. `outageSkipped` is counted per cycle and then discarded, so "this verdict has survived N
consecutive data-missing rehearsals" is not recordable today. Choosing a staleness threshold is a
research-policy decision, so no threshold was invented here.

One thing this clears: the corporate-action discontinuity in
`04-corporate-action-discontinuity.md` does **not** contaminate `sma_cross_20_50`, because that
strategy never ran on NSE data. The non-`IN` universe has **0** extreme daily moves.
