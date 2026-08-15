# Telemetry measurement honesty — final

## Objective

Owner directive 2026-08-15, the two housekeeping items before the quant-quality scoreboard:
(a) `tokens = 0` must never mean UNMEASURED — the Model Router will learn from these statistics
and a fake zero reads as "free"; (b) the acceptance suite's two deliberate skips carry a typed
classification instead of being a bare "2 skipped".

## Implementation

- `lib/agents/team-runtime.ts` — the team close sums ONLY measured member outcomes and writes
  `tokens: null` when nothing was measured (budget guard numerically unchanged).
- `lib/brain/execution-trace.ts` — `ExecutionTotals.tokensMeasurement`
  (`MEASURED | PARTIAL | UNMEASURED`) derived over ledger-recorded model calls (the
  deterministic chief is excluded BY DESIGN, not "unmeasured"); legacy summed-0 rows heal at
  read time (`row.tokens === 0 && childTokens === null` is provably the pre-fix fake zero);
  the stale "(tokens still measured)" comment corrected; `tokensStatement`/`costStatement`
  compose every totals string in exactly one place.
- `app/brain/executions/[id]/page.tsx` — renders the two statements; no string composition in
  the view.
- `e2e/app.spec.ts` — the shared skip reason is now
  `EXPECTED_SKIP(EXTERNAL_DEPENDENCY): requires MARKETPULSE_TEST_MODE fixtures; …`.
- `e2e/lib/expected-skips.test.ts` — the manifest: exactly one `EXPECTED_SKIP(` site
  suite-wide; a new expected skip must edit the manifest consciously.

## Evidence

Defect proven live before the fix (write-path test failed against the unfixed tree). After:
units **161 files / 1834 passed / 2 skipped / 0 failed** twice consecutively; `tsc` silent;
production build clean; `brain-executions.spec.ts` live against the exact tree — 2 passed
(5.0m) with a REAL team execution rendered through the new path. Full detail:
`06-verification.md`.

## Limitations

- The /brain RECENT WORK panel shows the raw row token value (a legacy fake 0 can still appear
  there); the drill-in and every statistics-bearing surface are honest. Documented, deliberate.
- The UNMEASURED/PARTIAL visual states are unit-pinned, not master-run-proven; the next full
  acceptance run inherits this leg.

## Rollback

Revert the single commit. No schema change, no migration; the read-side healing is pure.

## Verdict

**VERIFIED_FOR_DEFINED_SCOPE** — units + live e2e on the exact tree; Master Golden pair not
rerun for a housekeeping leg under the freeze; mobile untouched and unclaimed.
