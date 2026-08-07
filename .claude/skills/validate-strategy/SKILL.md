---
name: validate-strategy
description: Use when compiling, testing, promoting, or rejecting a trading strategy. Covers the bounded DSL, the validation gauntlet, multiple-testing control, and the locked-holdout budget.
---

# Validate a strategy

## The DSL is deliberately small

`compileStrategy` accepts a closed vocabulary of point-in-time features. If a feature is not on
the list, the compile fails. This makes lookahead a compile error rather than a subtle backtest
bug you discover after trading it.

The compiler rejects:
- any reference to future information (`future_return`, `next_close`, `label`, …)
- any unknown feature
- an exit with no time limit, stop, or condition — a position that never closes

It warns (without blocking) about zero modelled costs, missing stops, and concentration.

## The gauntlet

`runGauntlet` runs seven stages and records **every one** as a trial:

| Stage | Fails when |
|---|---|
| replay | fewer than 30 out-of-sample trades |
| walk_forward | out-of-sample profit factor below 1.1 |
| parameter_stability | deflated Sharpe below 0.95 given the trial count |
| causality | probability of backtest overfitting above 0.5 |
| cost_stress | profit factor below 1.0 at double the modelled costs |
| monte_carlo | probability of a losing run above 35% |
| no_trade_comparison | not trading beats the strategy |

## The bar rises as you test more

The deflated Sharpe compares the observed Sharpe against **the best of N random strategies**,
where N is every trial ever recorded for that spec. Testing twenty variants and reporting the
best one is exactly what this corrects for.

Practical consequence: **do not run the gauntlet speculatively.** Each run raises the bar for
every subsequent run on that spec. Think first, test once.

## The locked holdout

`requestHoldout` grants **one** query per strategy, ever. The second request is refused, and the
ledger is append-only at the database level so the budget cannot be reset by deleting rows.

If you have exhausted it: build a genuinely different strategy, or collect forward evidence.
Re-querying the holdout would convert the only unbiased estimate you have into another
in-sample number.

## When a strategy fails

Record why, in `failure_memory`, with enough detail that a future attempt recognises the same
dead end. A rejected strategy is a result. It stays on record and cannot be deleted.
