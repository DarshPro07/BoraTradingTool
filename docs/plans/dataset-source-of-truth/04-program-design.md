# Gate 3 — Program design

## Files
- `drizzle/0009_dataset_snapshots.sql` — three tables + append-only triggers (new, registered).
- `lib/db/migrate.ts` — MIGRATIONS registration (protected; owner-authorized edit).
- `lib/db/schema.ts` — drizzle table declarations (additive).
- `lib/research-data/snapshot.ts` — the contract module (new).
- `lib/backtest/inspect.ts` — economics made `| null` + `economicsUnavailable` (per-trade catch).
- `app/api/strategy/trades/route.ts` — ledger-first; `rerun: true` explicit; fresh path
  snapshots, replays, records; both paths return `servedFrom` + `provenance`.
- `components/strategy/TradeInspector.tsx` — provenance strip (`inspect-provenance`),
  economics abstention rendering.
- `components/layout/DevBuildBadge.tsx` + `app/layout.tsx` — dev-only build identity
  (start time, pid, schema version).
- `playwright.config.ts` — E2E DB path claimed only when it matches the server under test.
- Tests: `lib/research-data/snapshot.test.ts`, `lib/backtest/inspect.test.ts` (extended),
  `e2e/dataset-ledger.spec.ts`.

## Error model
Refusals are values (`SnapshotRefusal`), never fabricated defaults; route maps them to 503 with
the store-named remedy. CostModelError is caught per-trade only; anything else still throws.

## Test design (owner's T1–T9 → actual tests)
- T1 store-only success / refusal naming ingestion → snapshot.test.ts "T1"
- T2/T7/T8 reopen identical after store change / cold reopen / delete refused → "T2/T7/T8"
- T4 daily cannot satisfy 5m → "T4"
- T6 one-bar mutation changes fingerprint; unchanged store reuses row → "T6"
- T3/T5 (no silent gap-fill, session semantics) → structural: the module has no provider import;
  store resolution mapping is explicit
- T9 browser network proof + inspector-matches-ledger → e2e/dataset-ledger.spec.ts
- Fee-refusal abstention (owner's live 500, exact dates) → inspect.test.ts pre-2024 US test

## Least-confident decisions
- Experiment id excludes execution-profile version (engine version is a proxy) — acceptable while
  profiles are compiled-in; revisit when profiles become data.
- `latestExperiment` = most recent by createdAt; no experiment picker UI yet.

## Rollback
Revert the route to direct `inspectTrades` and drop the module; migration 0009 is additive and
can stay applied (empty tables are harmless). The applied migration itself is never rewritten.
