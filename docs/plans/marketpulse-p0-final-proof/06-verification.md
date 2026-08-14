# Gate 5 — Independent Reality Verification (2026-08-13)

Every result below was produced by running the thing, on this checkout. Where something was not
run, it says so rather than inheriting a claim from the tracker.

**Environment.** Production build (`npx next build`), `next start` on `127.0.0.1:3100`,
`MARKETPULSE_TEST_MODE=1`, fresh SQLite at `.tmp/p0-proof.sqlite`, `QUANT_CORE_URL=off`.
Server identity asserted on every Playwright run via the `identity` setup project plus
`MARKETPULSE_E2E_EXPECT_STARTED_AFTER`, so no result below can have come from a stale server.

- run 1 — pid 14000, build `c3a814f-dirty.cf4e5b73`, db `e050128c3518c68a`
- run 2 — pid 16004, build `c3a814f-dirty.0dcc890e`, db `76bda09bbc4d8289` (after the AUTO change)

## Results

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | **0 errors** |
| Unit / integration | `npx vitest run` | **134 files, 1637 passed, 2 skipped, 0 failed** (exit 0) |
| Route matrix (strict) | `playwright test all-routes` | **30 passed, 0 failed** |
| 30-stock matrix (strict) | `playwright test nse-30-stock-matrix` | **34 passed, 0 failed** |
| MCP bundle | `node esbuild.mcp.mjs` | built |
| AUTO concurrency | `playwright test auto-mode-concurrency` | see §AUTO below |

## What the new assertions actually caught

The point of tightening these suites was to find things, and they did.

1. **A false green in my own tooling.** `npx vitest run --reporter=basic` fails with `ERR_LOAD_URL`
   (the reporter was removed in vitest 4) and **exits 0 having run zero tests**. Any pass count
   quoted from that invocation is fiction. All counts above come from the plain `npx vitest run`.

2. **Two phantom routes and one untested real page.** The old hand-written inventory named
   `/factory` and `/forward` — neither has a page on disk — and omitted `/edge-factory`, which
   does. `/forward` was not even marked optional; it passed because the only status assertion was
   `toBeLessThan(500)` and a 404 satisfies that. Proven by diffing the literal old list against the
   filesystem: 2 phantoms, 1 missing, 28 vs 27 entries.

3. **The event bus was suppressing the repo's own test-isolation guard.** Removing the swallow at
   `event-bus.ts:157` turned 51 tests across 7 files red at once. The cause was not the change:
   `databasePath()` throws when a test process opens the production database, and `publish()` had
   been eating that throw. Those 7 files had never had a temporary database — they only looked
   green because the guard's alarm was being discarded. Fixed by adding `useTemporaryDatabase()`
   to each, not by restoring the swallow.

4. **A test that had never located its own control.** The 30-stock search test wrapped its whole
   body in `if (searchBox.isVisible())` / `if (count > 0)`, so it asserted nothing and passed.
   With the guards removed it failed — revealing it looked for `getByTestId("instrument-search")`
   while `TopNav` passes `id="instrument-search"` into a `role="combobox"` input, and that the
   `search-result` testid it expected has never existed anywhere in the codebase.

5. **Two of my own assertions were wrong about the product, and were corrected rather than
   forced.** Aborted Next.js RSC prefetches (`?_rsc=` + `net::ERR_ABORTED`) are the prefetcher
   working as designed, so the rule was narrowed to exactly that case rather than reverting to the
   old blanket `net::ERR` filter. And selecting a search result does not navigate — `TopNav`
   navigates on submit — so the test now follows the real two-step path.

## Event/mutation atomicity — proven by failure injection, not by co-occurrence

The prior test asserted that `completeJob` writes both the job row and its event on a healthy
database. That passes identically with and without the fix, so it never tested atomicity.

The new test drops `audit_events` mid-test and asserts the mutation rolls back. Proven to bite:
with the swallow temporarily restored it fails with `expected [Function] to throw an error` — the
old code completed the job silently, leaving `succeeded` with no evidence behind it. With the fix,
6/6 pass.

## 30-stock matrix — what the pass actually means

All 30 securities resolve, render, expose the research control, and reach a **terminal** state.
Every one of them lands on:

> `FAILED :: NO_STORED_DATA — The canonical store holds 0 daily bars for IN:XNSE:<SYM>; 60 are
> required before an instrument can be researched.`

**This is the guardrail working correctly** on a fresh database (WORK_QUEUE P0 §66), and a truthful
refusal is a pass by the mission's own rule. But it must be read precisely: this run proves the
**refusal** path across 30 instruments, not the research path. Proving the research path at breadth
requires ingested history, which is the open P0 §66 item (no in-product route to ingest).

The identity test is stronger than a refusal, and does pass end-to-end: typing RELIANCE, selecting
the listbox option and submitting lands on `/analyze/IN:XNSE:RELIANCE` with the instrument
resolved, no `.BO`, no `XBOM`.

## AUTO concurrency

Implemented: the RESEARCH lane now drains the durable queue on its own 5s timer
(`RESEARCH_TICK_MS`) under its own lease file (`researchLeasePath()`), independent of the 60s
cycle. The single shared lease was the actual mutex — one lease file meant one lane — so a
separate lease is what makes overlap possible at all.

The spec was inverted accordingly, and deliberately does **not** accept overlap alone as proof:
under the old design every job overlapped its cycle because the cycle *called* the worker. The
discriminator is the claimant recorded in `research_job_events` (`${workerId} attempt N`) — the
cycle claims as `supervisor-<runId>`, the lane as `research-<runId>`. The headline assertion is
that a `research-`claimed job overlapped a cycle in wall-clock time.

**Result: PASS — 2 passed.** Measured evidence, from the product's own ledgers:

```
OVERLAP job 82 (research-arun_9173e16cc11e4074) [10:56:26.000 → 10:56:26.000]
        ran during cycle 3450 [10:56:26.000 → 10:56:26.848]
OVERLAP job 81 (research-arun_9173e16cc11e4074) … same cycle
OVERLAP job 80 (research-arun_9173e16cc11e4074) … same cycle
OVERLAP job 79 (research-arun_9173e16cc11e4074) … same cycle
```

The claimant prefix `research-` is the proof that these were executed by the independent lane and
not by the cycle's own drain phase.

It took three runs to get an honest measurement, and the two failures were both in the
measurement, not the runtime — recorded because a green on the first try would have been the
suspicious outcome:

1. **Run 1 — "no job was claimed by the research lane".** A spec defect: the four seeded jobs were
   inserted in `beforeAll`, but `beforeMaxJobId` is captured inside the test body, so
   `job.id > beforeMaxJobId` filtered every one of them out. The only jobs left to observe were
   those the cycle produces and self-drains milliseconds later, so the lane genuinely had nothing
   to claim. Fixed by seeding after the baseline.

2. **Run 2 — "no research-lane job overlapped a cycle".** A measurement defect:
   `research_job_events.created_at` is stored in whole SECONDS, so a job completing in
   milliseconds records `claimed` and `succeeded` in the same second — a ZERO-WIDTH interval
   `[T, T]`, which strict-inequality interval intersection can never match, however plainly it
   sits inside the cycle. Judged on the claim INSTANT against the cycle's millisecond window
   instead, which errs toward false negatives rather than false positives.

**Stated limitation.** Cycle 3450 lasted 848ms and the job timestamps are second-granular, so what
is proven is that four lane-claimed jobs executed within the same second that the cycle was
running. That is real concurrent execution of two lanes — impossible under the old single-lease
design, where the only possible claimant was `supervisor-` — but the overlap window is short. A
longer-running job class would make the demonstration wider, and the spec would then also satisfy
the `properOverlap` branch rather than the claim-instant branch.

## Not verified by me

These specs exist and were **not** audited or executed in this pass. Their existence is not
evidence they assert the right thing — items 2, 3 and 4 above are exactly that failure mode:

- `golden-journey-full-lifecycle.spec.ts` (350 lines; 13 UI calls vs 11 API calls — the UI/API
  balance is the specific thing to audit)
- `paper-lifecycle.spec.ts` (277 lines)
- `crash-recovery.spec.ts` (226 lines)
- Brain ↔ quant-core capability wiring
