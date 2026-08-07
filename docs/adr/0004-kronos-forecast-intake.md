# ADR 0004 — Kronos foundation model: intake as a scored hypothesis source, not a signal

Status: Accepted

Date: 2026-08-06

## What Kronos is

[shiyu-coder/Kronos](https://github.com/shiyu-coder/Kronos) — "Kronos: A Foundation Model for
the Language of Financial Markets" ([arXiv 2508.02739](https://arxiv.org/pdf/2508.02739),
accepted at AAAI 2026). Two stages: a tokenizer quantises continuous OHLCV bars into
hierarchical discrete tokens, then a decoder-only autoregressive Transformer is pretrained on
those tokens. Pretrained on a reported 12 billion K-line records from 45+ global exchanges.

Published checkpoints (HuggingFace, `NeoQuasar/` namespace):

| Model | Parameters | Context |
|---|---|---|
| Kronos-mini | 4.1 M | 2048 |
| Kronos-small | 24.7 M | 512 |
| Kronos-base | 102.3 M | 512 |

Input is a window of historical candles; output is forecast candles for future timestamps.

**Licence: MIT.** Permissive — reuse, modification and redistribution are allowed with the
copyright notice retained. No copyleft obligation on this repository.

## What the reported numbers do and do not establish

The paper reports +93% RankIC over the leading time-series foundation model, +87% over the
best non-pretrained baseline, 9% lower MAE on volatility, 22% better generative fidelity.

Those are **benchmark results on historical data**. Under this system's own vocabulary that is
`historically_observed`, not `known`, and it says nothing about forward performance on NSE or
US equities in 2026. The repository is candid about this: its finetuning example is described
as not production-ready, and it notes that raw signals require portfolio construction, and that
backtests must carry transaction costs, slippage and market impact.

A 93% relative improvement in RankIC is also not a 93% anything in money. RankIC is a
cross-sectional rank correlation; the distance between "ranks better than the baseline" and
"survives costs after execution" is exactly where most published edge dies.

## Decision

**Kronos is admitted as a hypothesis and feature source. It is never admitted as a signal.**

1. **It runs in the Python quant core, not here.** Kronos is PyTorch; this application is
   TypeScript and has no model runtime by design. Forecasts arrive over the existing quant-core
   filesystem seam like every other resource, and are absent until that side produces them.

2. **Absence is reported, never defaulted.** `lib/forecast/kronos.ts` returns a typed
   `RESOURCE_NOT_PROVIDED` refusal when no forecast file exists. A forecast of "no change" and
   the absence of a forecast are opposite facts and must never render alike.

3. **Every forecast carries `not_forward_validated`.** The status is set by the reader, not
   supplied by the file, so a producer cannot upgrade its own epistemic standing.

4. **A forecast must beat naive persistence before it means anything.**
   `lib/forecast/score.ts` scores any forecast against the persistence baseline — "tomorrow
   equals today" — and runs the paired bootstrap already used by the gauntlet. MAE alone cannot
   reveal this: on a low-volatility series a model can post an excellent MAE while being
   strictly worse than doing nothing.

5. **Nothing skips the gauntlet.** A strategy that consumes Kronos features goes through
   `lib/strategy/gauntlet.ts` and `lib/simulation/battery.ts` exactly like a hand-written one.
   A pretrained model is a *reason to look*, never a reason to skip the checks — and the more
   impressive the published number, the stronger the incentive to skip them.

## Consequences

- **Nothing to consume yet.** `E:\Trading_BOT` is not present on this machine, so
  `quantCoreRoot()` resolves to a missing directory and *every* quant resource — Kronos
  included — reports unavailable. The adapter and scorer are ready; the producer is not, and
  no bridge request could be filed because the bridge directory does not exist.
- **The lookahead risk is real and is the reason for the point-in-time rule.** A forecast for
  bar *t+1* generated at bar *t* is legitimate; a forecast file regenerated over history and
  read as though it had been available at each bar is lookahead of the purest kind. The reader
  records `generatedAt` per forecast and the scorer refuses to score bars at or before it.
- Attribution: MIT licence text must accompany any vendored Kronos code. Nothing is vendored
  here today — this repository holds only the contract and the scorer.
