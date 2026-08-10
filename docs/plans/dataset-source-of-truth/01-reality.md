# Gate 0 — Reality

## The defect (REPRODUCED)

Owner's dev log + live probe: `POST /api/strategy/trades` inspected via `marketCandleLoader`,
which serves the provider's *sliding window*. The canonical store held 30,436 five-minute NSE
bars producing 73 trades; the provider window produced 0. Same strategy, same question, two
datasets, two answers, no error anywhere. Fifth occurrence of this defect family (a layer
assuming its data source is settled by knowing the market).

A second live defect rode along (REPRODUCED, owner's log): trades entered on 2023 US dates
crashed the whole report with `CostModelError: No US fee schedule covers … 2023-10-25` — one
unpriceable trade hid 72 priceable ones behind a 500.

## What existed

- `lib/market/candle-store.ts` — canonical store, append-only `persistCandles`/`loadStoredCandles`. WORKS.
- `lib/learning/dataset.ts` — store-first (≥250 bars) with silent provider fallback; no snapshot identity. OBSERVED.
- `lib/backtest/inspect.ts` — replay engine; economics threw on missing fee schedule. REPRODUCED.
- No dataset snapshot concept, no experiment/trade ledger anywhere. STATICALLY_CONFIRMED.
- Playwright config could reuse a stale external server; the owner's "buttons don't work" was a
  stale :3000 dev process. OBSERVED earlier today.

## Constraint

`lib/db/migrate.ts` is a protected path; registering migration 0009 there was explicitly
authorized by the owner's directive ("Add explicit dataset snapshot identity… Every experiment
records its dataset snapshot").
