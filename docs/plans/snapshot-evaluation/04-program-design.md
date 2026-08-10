# Gate 3 — Program design

## Files
- `drizzle/0010_experiment_manifest.sql` + registration in protected `lib/db/migrate.ts`
  (owner-authorized by the 13b directive) + `lib/db/schema.ts` columns.
- `lib/research-data/manifest.ts` (new) · `lib/paper/cost-model.ts` (`FEE_MODEL_ID`) ·
  `lib/market/calendar.ts` (`MARKET_CALENDAR_VERSION`).
- `lib/learning/rehearsal.ts` — `ResearchDatasetSource`, snapshot memoization, crash-to-refusal,
  experiment recording, outcome identity fields; `CandleLoader` moved to `lib/learning/dataset.ts`
  (live/ingestion only).
- `lib/strategy/gauntlet.ts` — `DatasetIdentityMissing` guard, identity threading, manifest
  recording, `datasetSnapshotId` on the report.
- `lib/strategy/selection-ledger.ts` — identity columns on trial + holdout inserts; trial-id
  collision fix (hash over campaign|family|fingerprint).
- `lib/strategy/auto-gauntlet.ts`, `app/api/strategy/gauntlet/route.ts`, `lib/learning/cycle.ts`
  — snapshot sources; route returns snapshot + fingerprint.
- `lib/strategy/promotion.ts` — `costVerdictOrBlocked`.
- UI: `RunGauntletButton` provenance line (`gauntlet-provenance`), `RehearsalLedger` panel on
  /strategies (`rehearsal-ledger-row`).

## Owner tests 1–14 → actual tests
| # | Requirement | Test |
|---|---|---|
| 1 | rehearsal determinism | rehearsal.test "is deterministic across runs" (seeded battery) |
| 2 | gauntlet determinism | gauntlet-ledger "identical evidence in two fresh families" |
| 3 | provider outage cannot change/block completed experiment | snapshot.test T2/T7/T8 + e2e ledger reopen with provider routes ABORTED |
| 4 | provider changes cannot alter old experiment | snapshot.test "reopens identically after store changes" + append-only triggers |
| 5 | missing snapshot data blocks evaluation | rehearsal.test refusal + cycle.resolution daily-only-store test + auto-gauntlet noData test + route 503 |
| 6 | learning evaluation cannot run without snapshot identity | type-level (`ResearchDatasetSource`) + gauntlet-ledger DatasetIdentityMissing test |
| 7 | trials persist dataset_snapshot_id | gauntlet-ledger "persists the snapshot id on the selection trial" + e2e through the server |
| 8 | holdout records persist snapshot identity | gauntlet-ledger "persists the snapshot id on the holdout access record" |
| 9 | resolution mismatch fails closed | snapshot.test T4 + cycle.resolution first test |
| 10 | missing fee model prevents promotion | promotion-economics.test |
| 11 | snapshot mutation → new id/fingerprint | snapshot.test T6 |
| 12 | reintroducing provider fallback fails tests | no-provider-pin.test (mutation-verified live) |
| 13 | UI shows rehearsal/validation snapshot provenance | e2e rehearsal-ledger test + gauntlet response/manifest e2e |
| 14 | completed evidence usable with provider blocked | e2e ledger reopen under `page.route` abort |

## Least-confident decisions
- Rehearsal experiments store `trades: []` (the manifest and summary are the reproducibility
  record; per-trade ledgers stay the inspector's domain). Revisit if a consumer needs them.
- `randomSeed` is the battery seed for both kinds; pure replays carry it harmlessly.

## Rollback
Code paths revert cleanly (evidence fields are additive); migration 0010 is additive and stays.
