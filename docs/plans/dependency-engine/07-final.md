# Final — Dependency Engine

**Verdict: VERIFIED** (for the defined scope — engine behavior; e2e explicitly out of scope and
stated so in 06-verification.md).

## Objective

Execute the owner's 2026-08-13 feedback chain on Dependency Resolver v1, so that:
*every blocked workflow either knows what will wake it, creates the required remediation
automatically, or declares a truthful external/permanent blocker.*

## What was built

| Slice | Files |
|---|---|
| Failure taxonomy + revival (RETRY_AFTER / BLOCKED_PERMANENT) | `lib/research/queue.ts` (+`queue-failure.test.ts`) |
| Generic resolver, six truthful states, cycle delegation | `lib/brain/dependency-resolver.ts` (+test), `lib/learning/cycle.ts` |
| Typed reasons; non-throwing impairments can degrade | `lib/learning/reasons.ts` (+test), `cycle.ts`, `lib/runtime/supervisor.ts` (+health test) |
| Forecast resolver on bar arrival, store-only | `lib/market/ingest.ts` (emit), `lib/forecast/resolver.ts` (+test), supervisor registration |
| Eligibility clock (`resumeAt`) | `reasons.ts` `nextBarOpportunity`, wired to warm-up + forecast reasons |

Real defects fixed along the way (both found at Gate 0, neither in the feedback text):
1. A dead job's dedupe key blocked remediation FOREVER — one transient outage permanently doomed
   an instrument's ingestion. Now: revival after cooldown for retryable causes only.
2. A configured-but-unreachable quant core could never degrade the run (the catch-only health
   rule was blind to structured failures). Now: INFRASTRUCTURE/DEGRADED, proven fail-first.

## Evidence

- Three fail-first regressions observed RED against unfixed code, then GREEN (06-verification.md
  records the exact assertion texts).
- The self-resolution loop test — the feedback's named acceptance test — passes end to end with
  no owner action.
- `npx tsc --noEmit` → 0 · `npm run test:verified` → **142 files / 1676 passed / 0 failed /
  2 skipped** (baseline 138/1654; +22 tests, 0 regressions) · `npm run build` → exit 0.

## Independent verification (Gate 5)

A fresh-context verifier agent attacked seven claims and ran its own suite/type/build passes.
**Verdict: PASS, high confidence, 0 blockers — all seven claims CONFIRMED** (revival cannot
loop; permanent death truthful with dependent cascade intact; forecast path store-only,
throw-safe, dedup-guarded; INFO/WARNING-only reports stay RUNNING; no protected path touched by
this changeset; `reasons` attached on all four mode tiers; non-market events filtered).

Its three low-severity gaps, disposition:
- `enqueue` check-then-act not transactional (cross-process double-revival bookkeeping) —
  **FIXED**: whole enqueue now runs in one `db.transaction`, same discipline as `claimNextJob`.
- `registerForecastResolver` double-call untested — **FIXED**: identity-of-disposer test added.
- Forecast subscription lives for the process lifetime (not disposed by `stopAutonomousRun`) —
  **ACCEPTED, recorded**: idempotent and root-stable in production; revisit if a test ever
  exercises real ticking without an explicit dispose.

## Flags for the owner (pre-existing, NOT from this work)

The working tree carries an unrelated uncommitted refactor touching **protected paths**:
`lib/governance/{mcp-manifest,policy,runtime}.ts`, `lib/security/request.ts`, `mcp/server.ts`,
`.env.example` — and `drizzle/0014_autonomy_default.sql`, an **applied migration edited in
place**, which the repo's own rule forbids (new migrations only). Independent review confirmed
none of it references this changeset. It deserves its own provenance check before anything is
committed from this tree.

## Rollback

New modules are inert without their call sites. Reverting three guarded edits (cycle remediation
delegation, tick status derivation, ingest emit) plus the queue's revival block restores v1
exactly.

## Next rungs (per the feedback's ordering, not started)

Event-driven wake for queue jobs beyond the 5s research lane · per-strategy feature-warm-up bar
arithmetic · `DataRequirement` timeframe/session dimensions when an intraday consumer exists ·
then durable job types for research/strategy/backtest/validation/forward/paper/memory/repair ·
then Agents/Teams as workers · then multi-model routing above that.
