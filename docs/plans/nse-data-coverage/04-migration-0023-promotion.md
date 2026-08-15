# Migration 0023 promoted — the fetch ledger is durable (2026-08-16, owner-approved)

Owner approval: promote now, because until the ledger is durable a restart erases the history
Brain needs to distinguish "never attempted", "successfully backfilled", "partial", "identity
unverified" and "provider failed" — which weakens the planner and any future self-learning.

Both steps from the staged README were executed as written: `git mv` into `drizzle/`, and one
line appended to `MIGRATIONS` in the owner-protected `lib/db/migrate.ts` (edited under this
approval; the comment there records that the change is additive only).

## The acceptance contract, each item with its evidence

| Requirement | Evidence |
|---|---|
| Populated DB upgrades without modifying existing rows | A production backup rolled back to pre-0023, then migrated: exactly ONE new table (`bar_ingestions`), zero tables lost, and the ONLY changed row count was `schema_migrations` 23→24. `price_candles` 99,903 and `strategy_families` 14 unchanged. |
| Fresh virgin DB applies the whole chain incl. 0023 | `lib/db/migrate.test.ts` builds a fresh database, runs the chain, and asserts applied versions == the `drizzle/` listing. Green. |
| Re-running migration is idempotent | A second `migrateDatabase()` pass on the same populated file: no error, no further change. Also covered by the migrate suite's own "can run twice". |
| Fetch-success audit survives restart | `bar-ingestion-ledger.test.ts` records four fetches, calls `closeDatabase()` — a real restart, since the cached handle drops and the next `getDb()` reopens from disk — and reads all four back. |
| Identity + gap/completeness + source survive restart | Same test: `COMPLETE 2 / PARTIAL 1 / EMPTY 1` with `unstatedIdentity 1` after the restart, and completeness vs identity asserted as INDEPENDENT dimensions (a COMPLETE fetch that was identity-UNSTATED stays both). |
| Failed/partial fetches remain queryable | `latestIngestion()` returns the PARTIAL row with observed-vs-expected sessions, bar count and source; "never attempted" (`null`) stays distinct from "attempted, returned nothing" (`EMPTY`, count 0). |
| Planner does not duplicate after restart | The dedupe key is a **UNIQUE INDEX in the database** (`idx_jobs_dedupe`), so the guarantee is structural rather than in-process. The owner's live data proves it across many restarts: 141 `ingest_history` jobs, 141 distinct dedupe keys. |
| /brain drops the "not durable" qualification | Live on the upgraded DB: `schemaVersion 0023_bar_ingestions`, and the panel reads "no fetches recorded yet" — an honest empty ledger rather than an unregistered one. |
| Full units + types + build + both Playwright states | Units **170 files / 1880 passed / 2 skipped / 0 failed**; tsc silent; production build clean; e2e green on the upgraded populated DB (18.9s) and on a fresh DB (24.5s). |

## Notes

- The ledger is append-only by trigger, and that is asserted too (update and delete both refuse).
- The owner's live dev server had already applied 0023 by hot-reload before this proof ran, so
  production is upgraded and healthy; the controlled before/after above was performed on a backup
  copy deliberately rolled back to the pre-0023 state, so the comparison was measured rather than
  assumed.
