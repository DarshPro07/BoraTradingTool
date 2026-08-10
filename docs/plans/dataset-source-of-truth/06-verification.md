# Gate 5 — Independent reality verification

All evidence below is from executed runs on 2026-08-09 (evening), not inspection of code.

## Unit suite (fresh temp databases per test)
`npx vitest run` → **102 files, 1309 passed, 2 skipped, 0 failed** (37.8s).
Includes the new `lib/research-data/snapshot.test.ts` (8/8: store-only success, ingestion-named
refusal, daily-cannot-serve-5m, one-bar mutation changes fingerprint, unchanged store reuses the
row, reopen-identical after store growth, cold reopen, append-only delete refusal) and the
extended `lib/backtest/inspect.test.ts` (8/8, including the owner's exact 2023-10-25 US
fee-refusal scenario abstaining per-trade instead of 500ing).

## Production scenario probe (copy of the owner's database; original untouched)
`npx tsx scripts/probe-ledger.mts`:

```
snapshot dss_b2076270a2b33d31 fp=b2076270a2b33d314b4dc0e8 bars=30436 instruments=12
fresh: 73 trades — 73 trade(s), 27 net-positive, across 12 instrument(s). Economics shown at quantity 1.
ledger: 73 trades, experiment exp_8a9b8a54398484b8, identical=true
PROBE OK
```

The 0-trades-vs-73 defect scenario now answers 73 both ways, from a fingerprinted snapshot.

## Build
`npm run build` → completed, fresh `.next/BUILD_ID` (production compile of the rewired route,
provenance UI and dev badge).

## Playwright, against a clean known server (stale-:3000 class excluded by construction)
Fresh `next start` on :3100 with a brand-new database; `MARKETPULSE_E2E_DB_PATH` pointed at the
same file so the seeding tests write to the server's own store (playwright.config now refuses to
claim a database it cannot prove is the server's).

Full suite: **74 passed, 0 failed, 8 skipped (all deliberate `test.skip` guards), 2.8m** across
desktop + mobile projects.

`e2e/dataset-ledger.spec.ts` (rerun standalone for visible statuses — 3 passed, 1 deliberate
mobile skip):
- API: author through the real door → first call `servedFrom:"fresh"` with fingerprinted
  provenance → second call `servedFrom:"ledger"`, same experiment id, `trades` deep-equal →
  explicit `rerun:true` reproduces the identical experiment id (idempotent determinism).
- UI: first click FRESH EXPERIMENT → second click "stored ledger" while a browser network
  capture recorded **zero** candle/quote/history/provider requests → reload → same summary,
  still from the ledger.

## Independent challenge attempted
- Renamed-collision rerun: spec names are now run-stamped; the spec was rerun against the same
  kept database and passed (a 409 regression was found this way and fixed before recording).
- Fingerprint sensitivity: one bar mutated out-of-band via raw SQL — fingerprint and snapshot id
  changed (unit T6).
- Evidence deletion: `DELETE` on `experiments`/`experiment_trades` raises `append-only` from the
  SQLite trigger (unit test).

## Known limitations (stated, not hidden)
- Slice 13b: rehearsal/gauntlet/cycle still consume `loadDataset` (store-first, provider
  fallback, no snapshot id recorded). Registered in MASTER Part 5 as the required follow-up
  before their numbers feed promotion decisions.
- `latestExperiment` serves the most recent experiment; there is no historical-experiment picker
  UI yet.
- The dev build-identity badge is dev-only by design; production builds identify themselves via
  deployment.
