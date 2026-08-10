# Gate 2 — Architecture

Flow: trade click → `TradeChart` (client) → `GET /api/research-data/bars` (store-only, ±40 bars
around the trade at the spec's resolution) → lightweight-charts v5 candles + `createSeriesMarkers`
+ two `createPriceLine`s.

- The bars endpoint reuses `STORE_RESOLUTION` (now exported from `lib/research-data/snapshot.ts`)
  and `loadStoredCandles`; it answers empty windows with an ingestion-naming note, never a fetch.
- The spec's resolution rides on the trades response (`resolution` field, both ledger and fresh
  paths, parse-failure → null → chart hidden, report unharmed).
- Deliberately NOT reusing `CandlestickChart`: that component's live-quote divergence logic and
  provider loading are exactly what evidence display must not have. Two small components with
  different data contracts beat one component with a mode flag.

**Failure paths**: unknown resolution → 400; empty window → stated CHART UNAVAILABLE; fetch/render
errors → stated, numeric detail untouched.
