# Gate 5 — verification (2026-08-15)

## Real-test rule — the defect was proven live before the fix

The new write-path test (`lib/agents/team.test.ts` — "an all-unmeasured team writes tokens NULL
to its row") ran FIRST against the unfixed tree and FAILED exactly as designed: the runtime's
`?? 0` sum wrote `tokens: 0` where null was asserted (observed 21:35 IST, 1 failed / 14
skipped). The read-model defect was already pinned in the opposite direction by the previous
leg's own test (`expect(trace?.totals.tokens).toBe(0)` over an all-unmeasured seed) — flipping
that assertion is the same proof from the other side. After the fix both pass.

## Units

- Focused: `execution-trace.test.ts` + `team.test.ts` + `expected-skips.test.ts` → 24/24.
- Full suite, twice consecutively: **161 files / 1834 passed / 2 skipped / 0 failed** (142s,
  144s). A first run under heavy import contention (230s) showed 5 environmental failures that
  did not reproduce in either subsequent run and touched none of this leg's files.
- `npx tsc --noEmit` silent. Production build clean (`.tmp/housekeeping-build`).

## Live surface

`brain-executions.spec.ts` against a dev server on the exact tree (`7b048b7-dirty.dad69f05`,
virgin DB): **2 passed (5.0m)** — one REAL team execution (live model calls), the drill-in
rendered through the NEW `tokensStatement`/`costStatement` path, the spec's console-error and
identity gates active. The live team reported usage (MEASURED path); UNMEASURED/PARTIAL/legacy
paths are unit-pinned string-exactly, which is the point of composing the strings in one place.

## What each pinned branch asserts

- All-unmeasured COMPLETED team (legacy row shape `tokens: 0`): totals.tokens null,
  `UNMEASURED`, "COST UNAVAILABLE (no usage reported by the provider)".
- New write path (via `runTeam` with an injected no-usage runner): team row tokens null.
- Partial (one measured, one not): subset sum shown, `PARTIAL`, partial cost string.
- Deterministic chief excluded from the census: fully measured team stays `MEASURED`,
  "COST UNAVAILABLE (tokens measured; no pricing source)".
- Reconciliation still refuses unmeasurable comparisons (null / NOT COMPARABLE).
- Skip manifest: exactly one `EXPECTED_SKIP(` site suite-wide (`app.spec.ts`, covering the two
  fixture tests that are the acceptance pair's whole "2 skipped"); the tagged reason names its
  class machine-readably.

## Independent challenge

Attempted disproofs: (1) could a genuinely-measured-0 team be mis-healed? Requires a measured-0
child ⇒ childTokens 0, not null ⇒ healing guard cannot fire. (2) Does the /brain RECENT WORK
panel still show a legacy fake 0? Yes — the summary reads the raw row without loading children
(documented in 01-reality; the drill-in is the truth surface; no statistics consumer reads the
panel). (3) Does any other surface derive "measured" from `tokens !== null`? Repo-wide grep:
the two totals strings existed only in the page and now exist only in the helpers.

## Scope not covered

Master Golden pair not rerun for this leg — it is spec-plus-lib housekeeping under the freeze,
verified by units + live e2e; the next full acceptance run inherits it. Mobile untouched.
