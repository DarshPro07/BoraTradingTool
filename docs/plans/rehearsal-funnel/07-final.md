# Final — the rehearsal funnel

**Verdict: VERIFIED.**

## Objective

Under the freeze ("freeze architecture; continue every independent quant/data/research task that
remains runnable"), find and fix the one funnel blocker that was not gated by market time.

## The fix

`lib/backtest/portfolio.ts` — an instrument below `MIN_BARS` is excluded from the walk instead of
refusing the whole portfolio; the exclusion is reported in `PortfolioRun.instrumentsExcluded`.
Refusal is kept for the case where *nothing* qualifies, and `UNORDERED_BARS` still aborts.

`lib/learning/rehearsal.ts` — the recorded verdict reason now names how many instruments were
excluded and the thinnest bar count, beside the existing capacity note.

## Evidence

**Fail-first.** Three tests written before the fix; the exclusion test observed red
(`expected true, got false` on `result.ok`) while the two guard-preserving tests — refuse when
nothing qualifies, still refuse out-of-order bars — passed both before and after, proving the
change did not weaken them.

After: `lib/backtest` + `lib/learning` + `lib/strategy` + `lib/simulation` + `lib/research-data`
= **43 files, 486 tests, 0 failures**. `tsc --noEmit` exit 0.

**Live probe**, real rehearsal against a `VACUUM INTO` snapshot of production:

| | before | after |
|---|---|---|
| `not_evaluable` from INSUFFICIENT_BARS | 8 of 21 | **0** |
| instruments evaluated per affected run | **0** | **1,744** |
| trades produced per affected run | 0 | 1,963 |

Remaining `not_evaluable` in the probe: 2, both "the canonical store holds no D bars for US" —
an honest ingestion fact about a market with no daily history, not a defect.

Direct confirmation that the exclusion is not silent — 15 excluded, every one named:

```
evaluated=1744  excluded=15
ALPINETEX(19), ARDEE(3), CMLL(16), CPL(17), GYFTR(26), INDOMIM(12), JNPR(6), KNACK(28),
KUSUMGAR(23), LASERPOWER(22), LCL(12), MANIPALHOS(8), MVELECTRO(7), RIR(22), SBIFUNDS(19)
```

Exactly the 15 measured independently against `price_candles`, including the ALPINETEX that had
been named in all eight dead rehearsals.

## Cost

A rehearsal pass of 10 candidates now takes 62.7s, where the eight aborting runs previously
returned instantly. Cycles run every ~15 minutes, so this is comfortably inside the budget — but
it is real work that was not being done before, which is the point.

## Not done

- The `market_cap` feature gap (n=3 `not_evaluable`) — the factory authors strategies referencing
  a feature no engine derives. Separate defect, separate fix, tracked next.
- Capacity starvation (8,048 signals dropped against 1,963 trades) — a research-design question,
  honestly reported by the engine. Not a defect.
