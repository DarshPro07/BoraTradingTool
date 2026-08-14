# Gate 0 — Reality

Every claim is labelled. Nothing here is assumed.

## What exists

| Fact | Evidence | Label |
|---|---|---|
| `/api/system/status` reports run/mode/queue but **nothing about the server itself** | read `app/api/system/status/route.ts` in full — no pid, no build, no schema, no database | STATICALLY_CONFIRMED |
| `databasePath()` resolves `MARKETPULSE_DB_PATH` or `marketpulse.db`, and throws if a test process opens the production file | `lib/db/index.ts:11-31` | STATICALLY_CONFIRMED |
| Applied migrations are tracked in a `schema_migrations (version, applied_at)` table | `lib/db/migrate.ts:182-208` | STATICALLY_CONFIRMED |
| 18 migrations exist, `0000`…`0017` (no `0018`) | `drizzle/*.sql` listing | STATICALLY_CONFIRMED |
| `next.config.ts` sets only `distDir`. **No build identity of any kind is pinned or exposed.** | read in full — 8 lines | STATICALLY_CONFIRMED |
| Playwright already uses `reuseExistingServer: false`, an isolated port (3100) and an isolated DB — **but only when it spawns the server itself** | `playwright.config.ts:63-81` | STATICALLY_CONFIRMED |
| When `MARKETPULSE_E2E_BASE_URL` is set, the `webServer` block is **omitted entirely** and nothing verifies what is listening there | `playwright.config.ts:61-66` | STATICALLY_CONFIRMED |
| A stale `next start` served an old bundle and made a real fix look broken | `docs/plans/autonomous-master-runtime/00-status.md:84-90`, recorded from a live session | REPRODUCED (previous session) |
| `mutationFetch` sets the CSRF header, sets `content-type` only when a body exists, and pins `credentials: "same-origin"` | `lib/client/mutation-fetch.ts` read in full | STATICALLY_CONFIRMED |
| `AutonomousControl` shipped without the CSRF header and was a genuinely dead button that every unit test passed | Task 1 status doc, found by clicking | REPRODUCED (previous session) |
| Runtime status reports `DEGRADED` from a paper-capital mismatch, and keeps ticking | Task 1 status doc: `succeeded=81`, `failed=0`, `status=DEGRADED` | OBSERVED (previous session) |

## The defect found while mapping reality

`components/strategy/RunGauntletButton.tsx` had **`mutationFetch` imported on two consecutive
lines** in the uncommitted working tree. That is a duplicate-identifier error: `tsc` and the build
both fail on it. Label: REPRODUCED (read directly at `:6-7`).

This is worth recording rather than silently fixing, because of *how* it survived: the previous
session's migration pass was a mechanical edit across 8 files, and a mechanical edit is exactly the
kind that a green unit suite does not protect — the suite never imports that component.

## Raw-mutation inventory (the "11 controls" claim, re-measured)

Grepping `method: "POST|PUT|PATCH|DELETE"` across `components/**/*.tsx` returns **18 mutation call
sites**, and after the in-flight migration **all but two already went through `mutationFetch`**.

The two survivors were `components/learning/RunCycleButton.tsx:23` and
`components/learning/AutonomyTicker.tsx:37`. Both POST to `/api/learning/cycle`.

**Neither was broken.** Both set `x-marketpulse-csrf` by hand and send no body, so there was
nothing for the shared helper to fix. Label: STATICALLY_CONFIRMED by reading both files.

This matters for the plan: the earlier framing ("11 raw fetch controls, maintainability risk, don't
migrate yet") is **out of date**. The real count was two, and the reason to migrate them was not
consistency-for-its-own-sake but that finishing the set converts a hand-audit into a grep-able
invariant.

Remaining raw `fetch("/api/…")` calls in components are **reads** (`GET`), which require no CSRF
header. They are correct as they are and are explicitly out of scope.

## What is missing

- No runtime identity surface at all. A browser test cannot state which build, process, schema or
  database it just exercised.
- No attestation step in the Playwright suite. `reuseExistingServer: false` protects the
  self-spawned path only; the external-server path is completely unguarded.
- No invariant test preventing the next component from hand-rolling a mutating `fetch`.

## Open, not touched by this work

- `CapitalProfile` conflict (₹1,000 declared vs ₹1,00,00,000 paper account) — currently the honest
  source of `DEGRADED`. Blocks paper/sizing acceptance, not this gate.
- Cross-process singleton test for the supervisor lease.
- The `lib/learning/lease.test.ts` flake — inferred cause only, deliberately not fixed.
