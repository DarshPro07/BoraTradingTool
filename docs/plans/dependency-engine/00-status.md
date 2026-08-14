# Dependency Engine — Status

**Mission:** Execute the owner's 2026-08-13 feedback priority chain on top of Dependency Resolver
v1 (docs/plans/marketpulse-p0-final-proof, session 5). The feedback's summary rule:

> Every blocked workflow either knows what will wake it, creates the required remediation
> automatically, or declares a truthful external/permanent blocker.

**Branch:** checkpoint/m5-research-bridge-verified · **Started:** 2026-08-13 23:27 IST

## Slices (from the feedback's own ordering)

| # | Slice | Status |
|---|-------|--------|
| 1 | Failure classes + revival policy in the job queue (RETRY_AFTER / BLOCKED_PERMANENT) | ✅ DONE — 6 tests, revival + immediate-death proven |
| 2 | Generic dependency resolver module + the full self-resolution loop test | ✅ DONE — lib/brain/dependency-resolver.ts, 7 tests incl. loop + failure-without-looping |
| 3 | Typed reason codes (category/severity) drive supervisor health | ✅ DONE — quant-core unreachable now DEGRADED, proven fail-first |
| 4 | Forecast Resolver: bar arrival → matured predictions resolve | ✅ DONE — DATA_INGESTED → store-only grading, 2 tests |
| 5 | Warm-up/waiting reasons carry `resumeAt` from the Market Clock | ✅ DONE — nextBarOpportunity() on waiting reasons |
| 6 | Verification: full suite + tsc + final verdict | ✅ DONE — 142 files / 1676 passed / 0 failed, tsc 0, build 0; independent verifier PASS (7/7 claims), its 2 fixable gaps closed |

## Exact next action

Done — see 07-final.md. Next rung (not this plan): event-driven job wake-up beyond the 5s
research lane; per-strategy nextEligibleAt for feature warm-up; DataRequirement timeframe/session
dimensions when an intraday consumer exists.

## Context for a fresh session

- Read `01-reality.md` for what v1 already does (it is more than the queue docs suggest).
- The feedback text lives in the conversation and its actionable core is quoted in `02-product.md`.
- Everything here builds on `lib/research/queue.ts`, `lib/learning/cycle.ts`,
  `lib/runtime/supervisor.ts`, `lib/market/ingest.ts`, `lib/forecast/live.ts` — none protected.
