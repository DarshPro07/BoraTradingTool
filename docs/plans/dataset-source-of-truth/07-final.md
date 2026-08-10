# Final — dataset source-of-truth (master item 13)

## Verdict: **VERIFIED**

## Objective
Stop different parts of the system answering the same research question with different datasets.
Establish: provider → ingestion → canonical store → immutable fingerprinted dataset snapshot →
experiment → immutable trade ledger, with fail-closed refusals and visible provenance.

## What changed
- `drizzle/0009_dataset_snapshots.sql` (+ registration in protected `lib/db/migrate.ts` under
  explicit owner authorization; drizzle tables in `lib/db/schema.ts`)
- `lib/research-data/snapshot.ts` — snapshotFromStore / recordExperiment / latestExperiment
- `app/api/strategy/trades/route.ts` — ledger-first, explicit `rerun:true`, provenance on both
  paths, 503 refusal naming ingestion
- `lib/backtest/inspect.ts` — economics nullable with `economicsUnavailable` (owner's live 500)
- `components/strategy/TradeInspector.tsx` — provenance strip + economics abstention
- `components/layout/DevBuildBadge.tsx` + `app/layout.tsx` — dev build identity
- `playwright.config.ts` — e2e DB path only claimed when it matches the server under test
- Tests: `lib/research-data/snapshot.test.ts` (8), `lib/backtest/inspect.test.ts` (+1),
  `e2e/dataset-ledger.spec.ts` (4)
- Docs: MASTER Part 1 mission + corollaries, Part 5 item 13; this plan directory
- `scripts/probe-ledger.mts` — re-runnable owner-database verification probe

## Evidence
Unit 1309/0 failed · build clean · probe: 73 fresh = 73 ledger identical on the owner's data ·
Playwright 74/0 failed on a clean :3100 server, including the browser-network proof that
completed evidence needs no candle request. Details in `06-verification.md`.

## Rollback
Route can revert to direct `inspectTrades`; migration 0009 is additive and stays applied
harmlessly. No applied migration was modified.

## Unresolved (registered, not hidden)
Slice 13b (rehearsal/gauntlet/cycle onto recorded snapshots) — in MASTER Part 5. Item 14 (chart
markers) and 15 (hypothesis inbox) proceed next per the owner's standing order.
