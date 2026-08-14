# P0 Final Proof — Status

**Mission:** Complete the 8-point "MARKETPULSE P0 FINAL PROOF" closure order.

**Last updated:** 2026-08-13 (supersedes the 2026-08-12 tracker, which was stale — it listed
items 3 and 4 as not started when both had landed).

Every row below was re-derived from this checkout. See `01-reality.md` for the Gate 0 findings and
`06-verification.md` for the commands and their output.

## 8-point mission tracker

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | Restore 30-stock requirement (`>= 30`) | ✅ **VERIFIED** | `nse-30-stock-matrix.spec.ts:89` `toBeGreaterThanOrEqual(30)` + `:96` `.toBe(30)`. Never lowered. E2E: 34 passed. |
| 2 | Unit suite 0 failures | ✅ **VERIFIED_RUNTIME** | `npx vitest run` → 134 files, **1637 passed, 2 skipped, 0 failed**, exit 0. Run by me twice. |
| 3 | Rename partial Golden Journey | ✅ **VERIFIED** | `golden-journey-core.spec.ts` + `research-journey-multi-stock.spec.ts`. |
| 4 | Full-lifecycle Golden Journey | ⚠️ **EXISTS, UNAUDITED** | 350-line spec present; 13 UI calls vs 11 API calls. Semantics not verified by me. |
| 5 | AUTO concurrency | ✅ **VERIFIED_E2E** | 4 jobs claimed by `research-<runId>` executed during cycle 3450's window. 2 passed. Took 3 runs; the 2 failures were both measurement defects, documented in `06-verification.md`. |
| 6 | `paper-lifecycle.spec.ts` | ⚠️ **EXISTS, UNAUDITED** | 277-line spec present; not executed or reviewed in this pass. |
| 7 | Crash recovery | ⚠️ **EXISTS, UNAUDITED** | 226-line spec present; not executed or reviewed in this pass. |
| 8 | Brain wiring (quant core → Event Bus + Capability Graph) | ⚠️ **PARTIAL** | Event bus wired via `emit()` from 15+ modules; quant-core capability coverage not audited. |

## Landed this session (beyond the 8 points)

| Fix | Proof |
|---|---|
| Route matrix derived from the filesystem, not a hand-written list | 9 unit tests in `e2e/lib/routes.test.ts`; the 3 key assertions proven to fail against the old list (2 phantoms `/factory` `/forward`, 1 missing `/edge-factory`) |
| Route matrix now fails on console errors / failed requests / 5xx / non-200 | 30 passed on a real production server |
| 30-stock matrix now performs a real interaction and asserts a terminal outcome | 34 passed; per-stock outcome **and reason** logged |
| Event/mutation atomicity enforced (`event-bus.ts:157` swallow removed) | Failure-injection test proven to fail against the unfixed code |
| Test-isolation guard restored in 7 files the swallow had been suppressing | 51 previously-hidden failures surfaced and fixed properly |
| Node-only supervisor removed from the Next instrumentation bundle | Dynamic import inside `register()`, gated on `NEXT_RUNTIME`; build clean |

## AUTO concurrency — what changed and how it is judged

The single shared lease file was the real mutex: one lease meant one lane, so the research worker
could only ever run as a phase *inside* the learning cycle. The lane now has its own lease
(`researchLeasePath()`) and its own 5s timer (`RESEARCH_TICK_MS`), independent of the 60s cycle.

The inverted spec does **not** accept overlap alone as proof — under the old design every job
overlapped its cycle, because the cycle called the worker. The discriminator is the claimant in
`research_job_events` (`${workerId} attempt N`): `supervisor-<runId>` for the cycle's own drain,
`research-<runId>` for the lane. The headline assertion is that a `research-`claimed job overlapped
a cycle in wall-clock time.

Both drainers are retained on purpose. `report.worker` feeds `run-log`, `SystemPulse` and
`LearningModeControl`, so removing the cycle's drain has a wider blast radius than the requirement
needs; `claimNextJob` claims transactionally under `lockedUntil`, so no job can run twice.
Consequence, recorded rather than hidden: with the lane draining every 5s, the cycle's own drain
will often find an empty queue, so "Processed N job(s)" in the UI will trend toward 0 even while
research is busy. Cosmetic, not a correctness change, but it is a change.

## Honest reading of the 30-stock pass

All 30 securities resolve and reach a terminal state, and every one is
`FAILED :: NO_STORED_DATA — 0 daily bars; 60 required`. That is the guardrail working correctly on
a fresh database, and a truthful refusal is a pass by the mission's own rule — but it proves the
**refusal** path at breadth, not the research path. Breadth-testing the research path needs
ingested history, which is the still-open P0 §66 item (there is no in-product route to ingest).

## Exact next actions

1. Audit — do not assume — `golden-journey-full-lifecycle`, `paper-lifecycle`, `crash-recovery`.
   Three suites in this repo have now been caught asserting nothing; existence is not evidence.
   Start by grepping `e2e/` for `console.warn` and `if (await …isVisible())`, the two shapes that
   hid all three.
2. Brain ↔ quant-core capability wiring (item 8).
3. Two consecutive clean full runs (A47) before any verdict is upgraded.

## Session 3 (2026-08-13, evening)

| Item | Status | Evidence |
|---|---|---|
| Research "hang" | ✅ **DISPROVEN + real cause fixed** | Not a hang. `CONTRACT_VIOLATION` — schema caps array items at 300 chars, prompt never said so. Fixed + regression proven to bite. See `32-research-hang-root-cause.md`. |
| Research latency | ✅ **ATTRIBUTED** | ~58s, 95.7% provider API, `turns=1`. **P1 UX, not P0.** See `30-latency-profile.md`. |
| Lane contention | ✅ **DISPROVEN** | 57.5s loaded vs 58.0s idle. |
| NSE dashboard fake data | ✅ **ROOT-CAUSED + fixed** | `fixtureQuote` served ₹1,000/0.5% stamped `quality: "LIVE"`. Now `FIXTURE` + disclosure banner + computed source summary. See `33-nse-dashboard.md`. |
| Build portability (§66) | ✅ **FIXED** | `npm run build` exits 0. |
| Test-truth guard (§7.9/§82) | ✅ **BUILT + PROVEN** | `npm run test:verified`; fails a zero-test report claiming success. |
| In-product ingestion (§32/§65) | ✅ **BUILT + PROVEN** | refusal → ingest → `PROPOSAL READY`, through the UI. |
| Crash-test silent skip | ✅ **FIXED** | OS-allocated port; no `test.skip`. |
| Change provenance | ✅ **DOCUMENTED** | `31-change-provenance.md`. |

**Suites:** unit **136 files / 1645 passed / 0 failed**; e2e **67 passed** (30-stock + dashboard +
routes), dashboard suite **5 passed in each of fixture and real mode**.

## Session 4 — the MAIN dev server (`npm run dev`, :3000, real data)

Owner instruction: all work must be verified on the main server, not the e2e one.

**Environment proven:** `runtimeMode: development`, **`testMode: false`**, owner's real database
(`c05ea58b166fc130`), schema 0018. This is the real thing, not a test harness.

| Check | Result |
|---|---|
| Dashboard data | `19 quotes — source: YAHOO 19 · quality: STALE 19`, **0 demo banners** |
| Prices/changes | genuinely varied — ₹184.85–₹5,063.70, +1.41% to −1.74% |
| Sectors | varied — Technology +0.49% · Auto +0.22% · Banks −0.73% · Energy −0.90% |
| Data-mode badge | `REAL (PAPER)` on /dashboard, /analyze, /scanner |
| Route matrix + dashboard suites | **38 passed, 0 failed** |
| Unit suite | **136 files, 1646 passed, 0 failed, 2 skipped** |

### Bug found and fixed ON the main server: boot recovery was dead

Every boot of the owner's dev server logged:

```
[runtime] boot recovery skipped: UNIQUE constraint failed: index 'autonomous_runs_one_live'
```

`recoverInterruptedRun` did not check for an existing LIVE run before promoting a CRASHED one to
DEGRADED. `reconcileStaleRuns` only demotes runs whose heartbeat has gone stale, so a
freshly-heartbeating RUNNING row survives it; recovery then found an older corpse and resurrected
it, producing TWO live rows, which `autonomous_runs_one_live` (drizzle/0017) correctly rejected.
The function threw and `instrumentation.ts` swallowed it — so the crash-recovery path that exists
to resume interrupted work **had never once run on that database**.

Fixed by returning null when a run is already live, which is the correct answer as well as the
safe one: a live machine has nothing to recover, and a second resurrection is exactly the
duplicate work the single-live-run invariant forbids.

Regression `lib/runtime/supervisor.test.ts` — "returns null instead of throwing when a live run
coexists with a CRASHED one" — proven to fail against the unfixed code with the *identical*
production error (`SqliteError: UNIQUE constraint failed: index 'autonomous_runs_one_live'`). The
pre-existing "does not resume a healthy RUNNING run" test passed throughout, because it never set
up a corpse alongside the live run.

Verified live: the same server now logs `[runtime] Recovered run arun_a0159c7… 0 interrupted job(s).`

## Session 5 — the masterclass mission begins: Dependency Resolver v1 + A7 health truth

Owner-defined product principle: *"missing bars → DEGRADED → nothing happens → same warning next
cycle" is the difference between a dashboard and an autonomous OS.* This session built the first
two layers of that definition.

### Dependency Resolver v1 (A21) — a named prerequisite becomes owned work

- `ingest_history` is a **durable job kind** in the research queue (leases, retries, dedupe,
  /jobs visibility) — the queue's first REMEDIATION kind beside its five intake kinds.
- The rehearsal outage branch in `cycle.ts` no longer prints "the gap is an ingestion task" and
  stops: it **enqueues** `ingest_history` for every acceptance-universe instrument short of the
  60-bar floor. Dedupe key `ingest-history-<id>` prevents stacking; `ingestInstrumentHistory`'s
  ALREADY_READY answer makes even a duplicated run write nothing; a refusal FAILS the job into
  retry/dead where /jobs shows it. Rehearsal still refuses the current pass — remediation is
  asynchronous by design, the NEXT pass finds real bars (mid-evaluation fetches stay forbidden).
- `lib/learning/dependency-resolution.test.ts`, 5 tests: un-researchable → queue → researchable;
  dedupe; refusal→dead with the code visible; idempotency (repeat run writes zero bars).

### A7 — DEGRADED only for impairment, proven live on the owner's server

- `CycleReport.impaired`: the subset of `skipped` recorded from **catch blocks** — a mechanical
  membership rule (14 sites converted), immune to message rewording.
- `tick()` now derives status from `impaired`, not `skipped`. Eligibility/waiting notes stay
  visible in `reason` either way — reclassification hides nothing.
- `supervisor.health.test.ts`, 3 tests, using the owner's REAL tick report verbatim ("No strategy
  exists to consider" / "Quant core is switched off" / "15 predictions awaiting bars"). Proven to
  fail against the old rule: reverting the one line turns test 1 red.
- **Live verification on :3000 (`npm run dev`, real DB): `status: RUNNING` at tick 751**, warm-up
  notes present as reason. The machine had reported DEGRADED on every tick it had ever run.

Suite after: **138 files, 1654 passed, 0 failed, 2 skipped** (`npm run test:verified`).

## Session 6 — Dependency Engine (the feedback's priority chain) — see docs/plans/dependency-engine/

The owner's 2026-08-13 review of session 5 set the next rungs; all five landed, each with
fail-first proof where behavior changed:

| Rung | What landed |
|---|---|
| Failure taxonomy | `failureClass` PERMANENT/RETRYABLE in the queue. INSTRUMENT_UNKNOWN dies on attempt 1; a dead SOURCE_UNAVAILABLE job **revives after a 15m cooldown** — fixing the real defect that a corpse's dedupe key blocked remediation of a transient outage FOREVER. |
| Generic resolver | `lib/brain/dependency-resolver.ts` — resolveDataRequirement answers SATISFIED / REMEDIATION_QUEUED / REMEDIATION_ACTIVE / COOLING_DOWN / BLOCKED_PERMANENT / UNKNOWN_INSTRUMENT from durable rows; the cycle's inline remediation now delegates to it. The **self-resolution loop test** passes: blocked → job auto-created → worker → SATISFIED, no owner action. |
| Typed reasons | `CycleReason {code, category, severity, resumeAt?}` beside the string ledgers; catch blocks are now one producer, not the rule. **Quant core configured-but-unreachable now degrades the run** (a structured non-throwing impairment — proven to fail against the catch-only rule first). Disabled stays INFO; stale is WARNING and does not degrade. |
| Forecast resolver | `ingestInstrumentHistory` emits DATA_INGESTED; `lib/forecast/resolver.ts` subscribes and grades matured predictions **from the canonical store only** the moment bars land — no cycle, no provider call. Registered idempotently at supervisor ticking. |
| Eligibility clock | Waiting reasons (warm-up, forecast-awaiting-bars) carry `resumeAt` from `getMarketPhase` — an exact ISO instant while a session runs, an exchange-local descriptor when shut (never a quietly-wrong UTC conversion). |

Suite after: **142 files / 1675 passed / 0 failed / 2 skipped** (`npm run test:verified`), tsc 0.

## Verdict

**PARTIALLY_VERIFIED.**

Items 1, 2, 3 and 5 are closed with runtime evidence. Items 4, 6, 7 and 8 remain unaudited.

Per the reviewer's wording, and adopting it deliberately: no new fundamental architecture is
currently known to be required; however the full-lifecycle Golden Journey, paper lifecycle, crash
recovery and complete Brain wiring remain **acceptance blockers**, not "test coverage gaps". The
30-stock matrix passes but currently exercises the refusal path rather than the research path, and
that distinction is part of the verdict rather than a footnote to it.
