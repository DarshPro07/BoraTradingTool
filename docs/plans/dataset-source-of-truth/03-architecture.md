# Gate 2 — Architecture

## Data flow

```
provider → ingestion (accumulator/imports) → canonical store (price_candles)
        → dataset snapshot  (dataset_snapshots: fingerprint over every bar, reused when unchanged)
        → experiment        (experiments: spec + snapshot + kind + engine, id = hash of those)
        → trade ledger      (experiment_trades: append-only, UNIQUE(experiment_id, trade_index))
```

`HistoricalResearchData` (snapshots; statistics may use only this) and `LiveMarketData`
(provider loaders; live views only) are separate concepts; one never silently substitutes for
the other.

## Interfaces
- `snapshotFromStore(market, resolution, actor)` → `SnapshotResult | {code:"NO_STORED_DATA"}` —
  reads `loadStoredCandles` over the instrument catalog only; SHA-256 fingerprint over
  `market|resolution|instrument|bars`; reuses the existing row on fingerprint match.
- `recordExperiment(...)` → idempotent experiment id `exp_<hash(spec|snapshot|kind|engine)>`.
- `latestExperiment(specId)` → experiment + parsed sorted trades + snapshot row.

## Failure paths
Empty store → refusal naming ingestion (503 at the route). Resolution unknown to the store →
same refusal (daily bars can never satisfy 5m — T4). Unpriceable trade → `economics: null` +
`economicsUnavailable` reason, report survives. Ledger deletes → SQLite trigger raises
`append-only`.

## Security / immutability
Triggers `experiments_no_delete` / `experiment_trades_no_delete` in migration 0009; the tables
are additionally covered by the governance write-guard patterns.

## Alternatives considered
"Make the endpoint prefer the DB" — rejected by the owner and by Gate 0: it fixes one caller and
leaves the concept ambiguous, which is how the same defect recurred five times.

## Risks
Fingerprint cost is O(bars) per fresh snapshot (~30k bars ≈ fast, measured under a second in the
probe). Snapshot `dataset` is rebuilt from the store on rerun, not stored — bars live once, in
the store; the fingerprint proves they are the same bars.
