# Gate 5 — Independent reality verification (executed 2026-08-09, late evening)

## Unit + integration
`npx vitest run` → **103 files, 1324 passed, 2 skipped, 0 failed.** Includes the 14 owner
requirements mapped in `04-program-design.md`: rehearsal determinism, cross-family gauntlet
determinism, DatasetIdentityMissing refusal (before any trial is recorded), trial + holdout +
rehearsal rows pinned to `dss_` ids, manifest field completeness, resolution-mismatch and
missing-store refusals at rehearsal/cycle/route/auto-gauntlet level, promotion blocked on
CostModelError, snapshot-mutation fingerprint change, and the provider-import pin.

## Mutation checks (real-test rule, both run live and restored)
- `DatasetIdentityMissing` guard disabled → gauntlet-ledger refusal test FAILED (1 failed).
- Provider import reintroduced into rehearsal.ts → no-provider-pin FAILED (1 failed).

## Defects found by this slice's own tests (fixed, then re-verified)
1. `trial_` id = `familyId.slice(0,8)+fingerprint.slice(0,10)` — PK collision for prefix-sharing
   families testing the same configuration; the second family's legitimate trial crashed. Now a
   hash over campaign|family|fingerprint.
2. Two pre-existing e2e fixtures broke under the new reality and were corrected to it: intraday
   spec names were not run-stamped (409 on any rerun against a kept DB), and the learning-page
   test asserted "n/a" unconditionally — once the 13b gauntlet e2e legitimately spends trials,
   evidence yield 0/6 is a *measured* zero, which is correct; the assertion is now conditional
   on trials actually being zero.
3. GraveyardPanel name spans could not break, so the long buried `ledger_gap_screen_*` names
   widened /strategies past a phone viewport (403px vs 391) — caught by the standing
   no-horizontal-overflow e2e; fixed with `break-all`.

## End-to-end, against a freshly built `next start` on :3100 with a brand-new database
Final run with the true exit code captured (an earlier pipe had been swallowing it):
**PLAYWRIGHT_EXIT=0 · 82 passed · 0 failed · 6 deliberate skips · 4.6m**, desktop + mobile.

The 13b-specific e2e (all passed):
- A real gauntlet through the running server: hypothesis → family-bearing strategy → confirmed
  gauntlet run → the HTTP response, the `selection_trials` row and the experiment manifest all
  name the same `dss_` snapshot; manifest carries feeModelId + calendar version.
- The rehearsal ledger panel displays a verdict with its dataset id.
- Completed inspection evidence reopens from the ledger with all provider-shaped routes ABORTED
  (`page.route(/candle|quote|history|provider/i)`), summary identical after reload (owner test 14).

## Hypothesis-refusal status (owner's side-question)
Verified in the route: a refusal PERSISTS a durable hypothesis row (content-hash idempotent,
listed by GET, rendered in the inbox with its held status). Per the owner's stated rule —
"if a refusal creates a durable hypothesis/refusal resource, 201 is acceptable" — 201 stands.
Documented here rather than changed.

## Known limitations (stated)
- Legacy trials/holdout/rehearsal rows keep NULL dataset ids — visibly pre-manifest, never
  backfilled with a guess.
- The quant-core generation pass and live views still use providers by design (live workflows).
- `experiments.manifest` for rehearsals stores no per-trade ledger (`trades: []`); the manifest
  and summary are the reproducibility record — the inspector's experiments carry the trades.
