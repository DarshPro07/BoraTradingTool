# Final — research identity

**Verdict: PARTIALLY_VERIFIED**

## Objective

Make it impossible for renaming, copying, re-versioning or re-parameterising a strategy to erase
the statistical history that informed its selection.

## What was wrong

Every strategy spec had `hypothesis_id = NULL`, so the deflated Sharpe denominator was 1 for every
strategy in the system. The sealed-holdout budget was keyed per spec id, so a rename bought a
second look at data that may be looked at once — and a test asserted that as correct.

Unlike the intraday defects fixed earlier the same day, this one was producing wrong numbers, not
merely permitting future wrong ones.

## Implementation

| File | Purpose |
|---|---|
| `lib/strategy/research-freeze.ts` | P0.0 halt on trials and holdout reads while accounting is broken |
| `lib/strategy/research-identity.ts` | fingerprints, identity resolution, fail-closed validation standing |
| `lib/strategy/selection-ledger.ts` | trial ledger, family-scoped denominator, two-gate atomic entitlement |
| `drizzle/pending/0008_research_identity.sql` | five tables, UNIQUE budgets, append-only triggers |
| `lib/db/schema.ts` | drizzle definitions (additive) |
| `app/api/strategy/gauntlet/route.ts` | freeze enforced at the manual door |
| `lib/strategy/auto-gauntlet.ts` | freeze enforced at the autonomous door |
| `scripts/classify-research-identity.mts` | read-only backfill classifier |
| `lib/strategy/research-identity.test.ts` | 18 adversarial tests |
| `lib/strategy/research-freeze.test.ts` | 6 tests, pins the freeze active |
| `e2e/intraday.spec.ts` | browser-level 423 assertion |

## Results

- typecheck clean; **1,242 unit tests**, 2 skipped, 0 failed, across 95 files
- **66 browser tests** (desktop + mobile), 4 skipped, 0 failed
- `next build` exit 0
- mutation check: reintroducing `denominator = 1` **failed T7** as required

## Design decisions worth carrying forward

**Family ≠ trial count.** Ten variants are one family and ten selection trials. Keying the
denominator to the family label would have understated N exactly as badly as keying it to the spec
id did. The two live in separate tables, counted by separate functions.

**`selectionTrialCount` returns a union, not a number.** `{known:false}` forces every call site to
handle the absence. A number-returning signature invites `?? 1` — the defect under repair — back at
every call site simultaneously.

**Enforcement is in the database.** Budgets are UNIQUE indexes, ledgers are append-only triggers.
A future caller that forgets the helper still cannot double-spend, and concurrency is settled by
the constraint rather than by a lock.

**`drizzle/pending/`.** `migrate.test.ts` asserts every `.sql` in `drizzle/` is registered — the
guard against a silently skipped migration. An unregisterable file placed in `drizzle/` would turn
a correct guard red and train everyone to ignore it.

## Failures encountered

`accessId` was built from truncated prefixes; `holdout_2026_h1` and `holdout_2026_h2` collided on
the primary key, so a legitimate new holdout generation was refused as a spent budget. Caught by
the control test, fixed by hashing the full tuple.

## Unresolved limitations

1. **The migration is not installed.** Requires an owner edit to the protected `lib/db/migrate.ts`.
   Production runs fail-closed until then. This is by design, not breakage.
2. **Backfill awaits declarations.** Six of eight specs classify as UNKNOWN; placing them is a
   claim about an economic hypothesis.
3. **Slice 6 (cut-over) is deliberately not done** — see `05-slices.md`.
4. **True concurrency (T10) not exercised** under parallel processes.
5. **Three pre-existing browser tests** require a populated database; CI with a fresh one would be
   red. Out of scope here, recorded in memory.

## Rollback

Additive throughout. Drop five tables, delete two modules; nothing existing depends on them. The
freeze reverts by flipping one constant and its paired test together.

## Readiness

The logic is verified. The system is in the correct interim state: it refuses to validate anything,
because it cannot yet prove which strategies are statistically related. Two owner actions move it
forward, and neither can be performed by an agent.
