# Gate 0 — Reality, re-established 2026-08-13

The prior `00-status.md` (2026-08-12) is **stale**: it lists items 3 and 4 as not started, but
`golden-journey-full-lifecycle.spec.ts` exists and the rename landed as commit `RM
e2e/golden-journey.spec.ts -> e2e/golden-journey-core.spec.ts`. Nothing below is taken from that
tracker or from the review narrative; every line was re-derived from this checkout.

Branch `checkpoint/m5-research-bridge-verified`, HEAD `c3a814f`, working tree dirty (~80 files).

## Verification labels

| # | P0 item | Status here | Evidence |
|---|---------|-------------|----------|
| 1 | 30-stock threshold restored | **VERIFIED_COMPONENT** | `nse-30-stock-matrix.spec.ts:89` `toBeGreaterThanOrEqual(30)`, `:96` `.toBe(30)`. Not weakened. |
| 2 | Unit suite 0 failures | **VERIFIED_RUNTIME** | `npx vitest run` → 133 files, **1627 passed, 2 skipped, 0 failed**, 55.14s. Run by me. |
| 3 | Golden Journey renamed | **VERIFIED_COMPONENT** | `golden-journey-core.spec.ts` + `research-journey-multi-stock.spec.ts` both exist. |
| 4 | Full-lifecycle Golden Journey | **PARTIAL** | Spec exists (350 lines) but is 13 UI calls vs 11 API calls — semantics unaudited. |
| 5 | AUTO concurrency | **BROKEN (product), test is honest** | See below. |
| 6 | Paper lifecycle | **PARTIAL** | Spec exists (277 lines), semantics unaudited. |
| 7 | Crash recovery | **PARTIAL** | Spec exists (226 lines), semantics unaudited. |
| 8 | Brain wiring / quant core | **PARTIAL** | Event bus wired via `emit()`; quant-core capability coverage unaudited. |

## Confirmed defects (each re-derived from source, not from the review)

**D1 — my own tooling produced a false green.** `npx vitest run --reporter=basic` fails with
`ERR_LOAD_URL` (the `basic` reporter was removed in vitest 4) and **still exits 0** having run zero
tests. Any report quoting a pass count from that invocation is fiction. Recorded because it is the
same failure class the mission is about. The real numbers above come from the re-run.

**D2 — `all-routes.spec.ts` cannot fail on console errors.** Line 93 collects `criticalErrors`
then emits `console.warn`. A route throwing JS errors passes. "35/35 routes pass" therefore does
not mean 35 routes are clean.

**D3 — the route suite tests a route that does not exist.** Line 28 declares `/factory` with
`optional: true`. `ls app/` confirms there is **no** `app/factory`; the real page is
`app/edge-factory`. The dead entry passes by being optional and the live route goes untested.

**D4 — same swallow in two more suites.** `nse-30-stock-matrix.spec.ts:124` and
`research-journey-multi-stock.spec.ts:77` both `console.warn` page errors instead of asserting.

**D5 — event/mutation atomicity is not enforced.** `lib/brain/event-bus.ts:157` catches and
discards the audit-event insert failure. `emit()` (the production entry point, used by 15+ modules
including `research/queue`, `paper/repository`, `runtime/supervisor`) delegates straight to
`publish()`, so it inherits the swallow. A caller wrapping `mutate + emit` in a transaction still
COMMITS when the event write fails. `event-bus.atomic.test.ts` states both halves of the
contradiction in its own docblock (line 11 "committed together", line 12 "errors are swallowed")
and its `completeJob` test never failure-injects — it proves co-occurrence on the happy path, not
atomicity. The subscriber catches at 166/173 are **correct** and must stay: an in-memory
subscriber failure genuinely must not break the bus.

**D6 — Node-only code is static-imported into the instrumentation bundle.**
`instrumentation.ts:1` statically imports `recoverInterruptedRun` from `@/lib/runtime/supervisor`,
which reaches filesystem/child_process/Python. Next.js guidance is a dynamic import inside
`register()` guarded on `process.env.NEXT_RUNTIME`.

## D7 — AUTO is sequential, and the spec proving it is the best-written test in the repo

`e2e/auto-mode-concurrency.spec.ts` is rigorous, uses only real product timestamps
(`/api/cycles` + the `research_job_events` ledger), explicitly refuses to accept lane labels as
evidence, and documents its own 1s precision tolerance as "a precision margin, not a concurrency
allowance". Its finding, traced through four files:

- `lib/runtime/supervisor.ts` `tick()` — one awaited `runLearningCycle`, non-reentrant via
  `state.ticking`;
- `lib/learning/cycle.ts` `runCycleBody()` — one sequential async body, nothing forked;
- `lib/learning/lease.ts` `withCycleLease()` — serializes every driver behind one file lease;
- `lib/research/worker.ts` `runWorker()` — one sequential claim→await→complete loop.

The test is correct. **The product is what fails the requirement.** The honest verdict is
`AUTO_CONCURRENCY = FAIL`, and the tracker's "✅ VERIFIED (honest)" is the mislabel — an honest
test of sequential behaviour is not a pass for a concurrency requirement. The spec header already
names the remedy: "If a future change makes lanes concurrent, the sequential assertions below will
fail loudly and will need to be inverted into overlap assertions."

## Consequence for the verdict

Items 1, 2, 3 are genuinely closed. Items 4, 6, 7, 8 exist but are unaudited — a spec existing is
not evidence it asserts the right thing (D2/D3/D4 are exactly that failure). Item 5 is a real
product gap. Overall remains **PARTIALLY_VERIFIED**.
