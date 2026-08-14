# Incidental findings (2026-08-13)

Things found while proving the P0 items. None were in scope to fix in this pass; each is recorded
rather than quietly fixed or quietly ignored.

## PERF1 — a single research call takes ~9.5 minutes (§69)

Measured repeatedly while proving the ingestion unlock: once an instrument has bars, the second
`Research this stock` call reaches the provider and returns `PROPOSAL READY` after roughly **nine
and a half minutes**. Three separate e2e runs were torn down by their own budgets because of it —
600s was not enough for one research call plus a page reload.

This is not a test problem. It is the product's headline interactive action, and a user pressing
that button waits nine minutes for a result. Worth profiling before it is called acceptable:
the surface does warn "this takes as long as the model takes", which is honest, but the number
itself deserves attention. Candidate causes to separate: provider/model latency, the evidence
packet assembly, the syntax parser warm-up, and the quant-core feature computation that runs
BEFORE the model is called.

## T1 — `npm run build` cannot complete on this machine — **FIXED 2026-08-13**

Fixed by changing `"build": "next build && npm run build:mcp"` to call `node esbuild.mcp.mjs`
directly, matching what `test:full` already did. `npm run build` now exits 0. Original finding
retained below for context.

### Original finding

`"build": "next build && npm run build:mcp"`. The second stage dies with
`'npm' is not recognized as an internal or external command`, and `npm run build` exits **1**.
`next build` itself succeeds. This is the same Windows PATH problem `WORK_QUEUE.md` already
documents for `test:full`, which works around it by calling `node esbuild.mcp.mjs` directly.

Consequence: **`npm run check` cannot pass on this box**, because it ends in `npm run build`. Any
report claiming `npm run check` is green here should be doubted. Workaround used throughout this
session: `npx next build` then `node esbuild.mcp.mjs`.

Suggested fix: make `build` call `node esbuild.mcp.mjs` directly, exactly as `test:full` already
does.

## T2 — `vitest --reporter=basic` exits 0 having run nothing

The `basic` reporter was removed in vitest 4. Passing it produces `ERR_LOAD_URL` and **exit code
0** with zero tests executed. A CI step or a report quoting a pass count from such an invocation
would be fiction. Worth a guard if any script still passes a reporter name.

## T3 — piping vitest/playwright to `tail` discards the exit code

`npx vitest run 2>&1 | tail -30` reports the exit status of `tail`, not vitest, so a run with 51
failures looks like a success. Bit me once in this session. Anything that gates on these commands
must either avoid the pipe or set `pipefail`.

## P1 — US instruments in an India/NSE-first product

Two places assume a US universe:

- `components/analyze/TickerNotFound.tsx:4` — `SUGGESTIONS = ["AAPL", "MSFT", "NVDA", "GOOGL",
  "META", "TSLA", "PLTR", "AMD"]`, offered to a user who mistyped an NSE symbol.
- The application chrome prefetches `/analyze/US%3AXNAS%3AMSFT` on every page (visible in the RSC
  prefetch traffic of every route test).

Neither breaks a test. Both contradict the stated product scope, and the second means every page
load warms a US instrument route.

## P2 — the research path is unproven at breadth, by construction

All 30 acceptance securities refuse with `NO_STORED_DATA — 0 daily bars; 60 required`. The refusal
is correct and must not be softened (WORK_QUEUE P0 §66). But it means the 30-stock matrix currently
proves the refusal path, not the research path, and it cannot prove more until history can be
ingested from inside the product. P0 §66 (no API route for ingestion; two manual CLI steps) is
therefore also the blocker for meaningful breadth research coverage.

## P3 — `report.worker` will trend toward zero

With the RESEARCH lane draining every 5s, the learning cycle's own drain phase will usually find an
empty queue. `report.worker.processed` feeds `run-log.jobsProcessed`, `SystemPulse` and
`LearningModeControl` ("Processed N job(s)" / "No jobs processed"). The number is still true — it
counts what *that cycle* drained — but it will now understate research activity, because most
draining happens in the lane. If the UI is meant to show research throughput, it should read the
job ledger rather than the cycle report.

## P4 — three suites were asserting nothing

Recorded because it is a pattern, not three accidents:

1. `all-routes.spec.ts` — console errors collected, reported with `console.warn`, never asserted.
2. `nse-30-stock-matrix.spec.ts` — same `console.warn` pattern per stock.
3. `nse-30-stock-matrix.spec.ts` search test — entire body inside `if (visible)` / `if (count > 0)`,
   and the selector it guarded had never matched anything in the first place.

The common shape is a conditional or a log where an assertion belongs. Worth grepping for
`console.warn` and `if (await ...isVisible())` across `e2e/` before trusting any other suite.
