# Dependency Grammar — Gate 5 Verification

## Suite + typecheck + build

```
npx tsc --noEmit       → exit 0
npm run test:verified  → 143 files / 620 suites / 1688 passed / 0 failed / 2 skipped
```

Baseline entering this leg: 142 files / 1676 passed (dependency-engine final). Delta: +1 file
(worker-kinds.test.ts), +12 tests (10 grammar in dependency-resolver.test.ts, 2 kinds),
0 regressions. The 2 skips are the standing pre-existing ones.

## Behavioral proofs

- **Per-kind grammar** (10 tests): TIME waits with its own resumeAt then satisfies · MARKET_STATE
  satisfied mid-session and names "2026-08-17 09:00 Asia/Kolkata" when shut on a
  holiday-weekend · FUTURE_EVENT names its wake event · PROVIDER maps READY/AUTH_REQUIRED/
  UNAVAILABLE to satisfied/EXTERNAL_REQUIRED/VIA_ALTERNATIVE · JOB maps in-flight/succeeded/
  dead-permanent/missing to NOW/satisfied/IMPOSSIBLE/IMPOSSIBLE · CAPABILITY healthy/degraded/
  unregistered · dominance IMPOSSIBLE > EXTERNAL_REQUIRED > autonomous work · nextCheckAt is the
  MIN of time-knowable blockers with event-driven members contributing wake events, never an ETA.
- **The two-concept warm-up rule** (the owner's "09:30 arriving alone doesn't make it ready"):
  MARKET_STATE ✓ + TIME ✓ + DATA ✗ → NOT ready, one blocker, classification RESOLVABLE_NOW
  (the asking created the remediation); after the durable worker runs, the SAME composition is
  ready. No owner action.
- **Job OS kinds**: `forecast_resolve` and `memory_validate` execute as durable work on a fresh
  DB with truthful empty results. The first run of the forecast test surfaced real machine state
  (the dev machine's actual pending-forecast archive) — the job graded nothing, wrote nothing,
  and reported the honest zero, which is the store-only contract working.

## Migration resolution regression check

After restoring 0014: `npx vitest run lib/db/migrate.test.ts lib/governance` → 4 files /
76 passed / 0 failed. Zero behavior change, as the three-ways-dead analysis predicted.

## Independent verification

A fresh-context verifier was dispatched against nine claims across the migration resolution, the
grammar, the Job OS kinds and the reason enrichment — including deliberate self-suspicion items.
**Result: PASS, high confidence, 0 blockers, 9/9 CONFIRMED**, with exact-match independent
reproduction of the suite numbers and its own build run. Its hunt surfaced **one real dormant
defect** — `nextCheckAt` min-selected by string sort, where `' '` < `'T'` lets a same-day
exchange-local descriptor beat an earlier ISO instant (a consumer would under-poll). Fixed the
same session with an instant-aware comparator (zone-correct via Intl); regression proven red
against the string sort first; final suite **143 files / 1689 passed / 0 failed**, tsc 0. Its
refuted suspicions (composition double-enqueue, CLASS_PRECEDENCE completeness) and one cosmetic
protected-file note are recorded in 07-final.md.

## Not verified in this pass (stated)

- No UI surface changed; e2e suites not rerun. The inherited single-RUN/ownerless-auth refactor's
  surfaces remain e2e-unverified (flagged in protected-path-provenance, owner's attention).
