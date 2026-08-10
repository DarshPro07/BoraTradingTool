# Gate 0 — Reality

- Trade detail in `TradeInspector` shows PATH textually (entry → exit, MFE/MAE). STATICALLY_CONFIRMED.
- `components/chart/CandlestickChart.tsx` exists but is a live-quote view (divergence warnings,
  live provider `/api/candles`) — wrong instrument for evidence display. STATICALLY_CONFIRMED.
- `lightweight-charts` v5.2 installed; v5 markers use `createSeriesMarkers`. CONFIRMED in build.
- Trade payload carries instrumentId/entryTime/exitTime/entryPrice/exitPrice/exitReason;
  it does NOT carry bars. STATICALLY_CONFIRMED (`lib/backtest/inspect.ts`).
- Item-13 contract: statistical evidence must come from the canonical store. A chart that
  fetched provider bars would reintroduce the defect visually.
