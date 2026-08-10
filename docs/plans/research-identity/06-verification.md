# Gate 5 — Independent reality verification

Run 2026-08-09, after implementation. Every figure below is a recorded command result.

## Static and unit

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean, no output |
| `npx vitest run` | **95 files, 1,242 passed, 2 skipped, 0 failed** |
| `npx playwright test` (desktop + mobile) | **66 passed, 4 skipped, 0 failed** |
| `npx next build` | exit 0, compiled successfully |

## The real-test rule — mutation, performed not assumed

`selectionTrialCount` was temporarily reverted to the defect under repair:

```
if (identity === null) {
  return { known: true, trials: 1, ... };   // MUTATION
}
```

Result: **T7 failed** —
`T7/T11 — missing identity fails closed > a spec with no family cannot be validated`.
The fix was restored and the suite returned to green. The suite detects the original defect rather
than merely compiling alongside it.

The same procedure was applied earlier to the cycle-level resolution guard: removing
`if (isIntradayResolution(...)) return loadCandles(...)` caused
`does not hand an intraday strategy the cycle's cached daily bars` to fail, as required.

## Adversarial coverage

| Attack | Test | Result |
|---|---|---|
| denominator collapses to 1 | T1 | 5 configurations → N = 5 |
| re-run inflates N | T2 | idempotent on configuration fingerprint |
| siblings not counted together | T2b | both siblings report N = 2 |
| rename restores holdout | T3 | refused, `FAMILY_BUDGET_SPENT` |
| copy restores holdout | T4 | refused |
| new version restores holdout | T5 | refused |
| new uuid restores holdout | T6 | refused |
| new family in spent campaign | T8 | refused, `CAMPAIGN_BUDGET_SPENT` |
| **gates too blunt** (control) | — | new holdout generation **granted** |
| missing identity validated | T7 | refused; `selectionTrialCount` returns `known:false` |
| unconfirmed classification validated | T7b | refused |
| trial/access evidence deleted | T11 | both throw `/append-only/i` |
| suite fails to detect the defect | T12 | mutation confirmed detection |

## A defect the verification itself found

The control test — the one asserting the guard still lets legitimate things through — failed on
first run. `accessId` was built from truncated prefixes, so `holdout_2026_h1` and `holdout_2026_h2`
both sliced to `holdout_` and collided on the primary key. A **legitimately new holdout generation
was reported as a spent budget**, which would have made every future sample permanently unusable.

Fixed by hashing `(generation, campaign, family)`. Recorded because it is the argument for writing
the control alongside the attacks: twelve passing attack tests would have shipped it.

## Browser-level acceptance

Against a production build (`next start`) on an isolated copy of the owner database, port 3100.

- `POST /api/strategy/gauntlet` → **423 `RESEARCH_FROZEN`**, message names both the cause
  ("family of one", "renaming") and what remains available ("rehearsal"). Verified through the
  running application, not a unit stub.
- Intraday authoring contract: 201 with the square-off warning; 400 on a square-off past the
  ceiling; 400 `SESSION_FEATURE_AT_DAILY`; 400 on a missing declared spread.
- Full navigation, interaction, offline/failure-handling and mobile suites: green.

## Not verified

- **The migration itself.** `drizzle/pending/0008_research_identity.sql` is applied by the test
  harness to a temporary database, proving the schema and the logic. It has **not** been applied to
  the owner's database, because registration requires an owner edit to the protected
  `lib/db/migrate.ts`. Production therefore runs in the fail-closed state.
- **Backfill.** The classifier proposes; nothing has been written. Six of eight specs return
  UNKNOWN and fail closed by design.
- **Concurrency (T10) under real parallelism.** The UNIQUE indexes are the enforcement and the
  race path is covered by the catch branch, but two genuinely simultaneous processes were not
  exercised. Marked as a separate pass.

## Verdict

**PARTIALLY_VERIFIED.** Every implemented behaviour is verified, including by mutation. The
remaining gap is not a defect but an owner-only boundary: the schema cannot install itself, and
until it does the system correctly refuses to validate anything.
