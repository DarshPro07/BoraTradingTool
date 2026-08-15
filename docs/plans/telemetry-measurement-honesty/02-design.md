# Gates 1-3 — product, architecture, program design (combined; small repair leg)

## Product

The user (owner + the future Model Router) must never read "0 tokens" where the truth is "no
usage was reported". Success: an all-unmeasured COMPLETED team renders TOKENS UNMEASURED and
"COST UNAVAILABLE (no usage reported by the provider)"; a partially measured team says PARTIAL;
statistics consumers see `null`, not `0`. Failure condition: any surface still deriving
"measured" from `tokens !== null`-after-a-fake-0, or a new fake zero written. Non-goals: cost
estimation, member-row redesign, historical backfill migration (legacy rows are healed at read
time, provably — see below).

## Design

**Semantics**: `tokens: null` ⇔ UNMEASURED. An explicit derived
`tokensMeasurement: "MEASURED" | "PARTIAL" | "UNMEASURED"` joins `ExecutionTotals`, computed
over the census of MODEL-CALL members only — members with a ledger row whose
`executed.provider !== "deterministic"` (the deterministic chief spends no tokens BY DESIGN;
counting it would render every team PARTIAL forever).
  - UNMEASURED: no census member reports usage (or the census is empty)
  - PARTIAL: some but not all census members report usage
  - MEASURED: every census member reports usage (census non-empty)

**Write path** (`team-runtime.ts`): sum only measured outcomes; write `tokens: null` when none
measured. The team budget guard keeps using the measured sum (numerically identical to today).

**Read model** (`execution-trace.ts`): fix the stale comment; add the census;
legacy healing — `row.tokens === 0 && childTokens === null` can only be the pre-fix fake zero
(a genuinely measured 0 total requires a measured-0 child, which would make `childTokens` 0,
not null), so it reads as null without a migration.

**Statement helpers** (exported from `execution-trace.ts`, consumed by the page, pinned by
vitest — the strings live in exactly one place):
  - `tokensStatement(totals)` → "UNMEASURED — no usage reported by the provider" |
    "N (PARTIAL — some members reported no usage)" | "N"
  - `costStatement(totals)` → "X CUR" | "COST UNAVAILABLE (tokens measured; no pricing source)"
    | "COST UNAVAILABLE (tokens partially measured; no pricing source)" |
    "COST UNAVAILABLE (no usage reported by the provider)"

**Skip classification**: the shared reason constant gains the machine-readable tag
`EXPECTED_SKIP(EXTERNAL_DEPENDENCY):` — every skip line in any report now names its class — and
`e2e/lib/expected-skips.test.ts` (vitest, the runner that owns `e2e/lib/**`) pins the manifest:
exactly one `EXPECTED_SKIP(` site suite-wide, in `app.spec.ts`, covering exactly the two
fixture tests. A third expected skip cannot join silently; it must edit the manifest.

## Test design (real-test rule)

1. Flip the existing all-unmeasured test's `toBe(0)` to `toBeNull()` + UNMEASURED + the exact
   no-usage cost string → MUST FAIL against unfixed code (proven by running it first).
2. PARTIAL: one measured + one unmeasured member → summed tokens, PARTIAL, partial cost string.
3. MEASURED + no pricing → measured cost string.
4. Legacy healing: `completeTeamRun` called directly with `tokens: 0` over unmeasured children →
   totals read null/UNMEASURED.
5. Write path: drive `runTeam`? No — the runtime path needs a live provider; the write-path fix
   is one expression covered by (1) indirectly? It is NOT: (1) seeds via completeTeamRun
   directly. Add a focused unit on the summing expression? The expression lives inline in
   runTeam (not separately callable) — extracting a pure `sumMeasuredTokens(outcomes)` helper
   makes it testable without a live team. Do that.
6. Skip manifest test as above.

## Rollback

Revert the single commit; no schema change, no migration, read-side healing is pure.

## Least confident

The "deterministic" provider marker as the census boundary — if a future non-model member uses a
different provider string it would be counted unmeasured. Acceptable: it IS unmeasured then, and
PARTIAL is the honest word. Stated here rather than hidden.
