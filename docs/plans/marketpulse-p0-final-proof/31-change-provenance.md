# Change provenance — what this session touched, and what it did not

**Date:** 2026-08-13. Generated from `git status`, not from memory.

The working tree carries **155 dirty entries** on branch `checkpoint/m5-research-bridge-verified`
(HEAD `c3a814f`): 103 modified tracked files and 50 untracked paths. That state predates this
session. Layering fixes onto it without recording which changes are whose makes rollback and
independent verification difficult, so this is the record.

Nothing was reset, discarded, or force-pushed. Nothing is committed.

## Classification

| Class | Count | Meaning |
|---|---:|---|
| `SESSION_MODIFIED` | 24 | Tracked files this session edited |
| `SESSION_CREATED` | 7 files + 2 dirs | New files this session added |
| `PREEXISTING_DIRTY` | 131 | Dirty before this session; **untouched** by it |

### SESSION_CREATED

```
e2e/lib/routes.ts                          route inventory, derived from the filesystem
e2e/lib/routes.test.ts                     9 unit tests for that derivation
e2e/ingestion-unlock.spec.ts               the refusal→ingest→research proof
lib/market/ingest.ts                       in-product historical ingestion
lib/market/ingest.test.ts                  5 unit tests for it
app/api/market/ingest/route.ts             POST ingest + GET readiness
scripts/verify-test-run.mts                test-truth guard
docs/plans/marketpulse-p0-final-proof/     this plan directory
```

### SESSION_MODIFIED

```
e2e/all-routes.spec.ts                     rewritten: filesystem inventory, strict assertions
e2e/nse-30-stock-matrix.spec.ts            real interaction + terminal outcome + error assertions
e2e/auto-mode-concurrency.spec.ts          inverted to demand overlap; claimant discriminator
e2e/crash-recovery.spec.ts                 removed the silent skip; OS-allocated port
lib/brain/event-bus.ts                     persistence failure no longer swallowed
lib/brain/event-bus.atomic.test.ts         failure-injection rollback test
lib/backtest/{crossover,parity,portfolio,square-off}.test.ts   useTemporaryDatabase()
lib/factory/screen.test.ts                 useTemporaryDatabase()
lib/research/ablation.test.ts              useTemporaryDatabase()
lib/quantcore/signals.test.ts              useTemporaryDatabase()
lib/learning/lease.ts                      researchLeasePath() — separate lane lease
lib/runtime/supervisor.ts                  independent RESEARCH lane + timer
lib/runtime/gateway.ts                     latency attribution (apiDurationMs/wall/turns)
lib/research/bridge.ts                     exported MIN_BARS_FOR_RESEARCH; stage timings
components/analyze/TickerNotFound.tsx      data-testid so resolution is assertable
components/research/ResearchThisStock.tsx  ingest control on the NO_STORED_DATA refusal
instrumentation.ts                         Node-only import moved inside register()
vitest.config.ts                           e2e/lib/**/*.test.ts added to include
package.json                               build portability fix; test:verified script
```

### PREEXISTING_DIRTY — untouched

The remaining 131 entries were dirty on arrival and were **not** edited. They include large
tracked areas (`lib/learning/cycle.ts`, `lib/db/schema.ts`, `app/brain/page.tsx`,
`components/**`, `drizzle/**`, many `e2e/*.spec.ts`) and untracked directories that clearly belong
to earlier work (`app/api/brain/`, `app/api/golden-journey/`, `app/api/session/`,
`app/api/system/identity/`, `docs/autonomous-reconstruction/`, `docs/plans/autonomous-os-v7/`,
several other `docs/plans/*`).

Two of those untracked API directories are worth flagging, because their names overlap with this
session's work and a future reader could confuse them:

- `app/api/ingest/` — **pre-existing, not mine.** This session created
  `app/api/market/ingest/`. Whether these duplicate each other has NOT been checked; that is an
  open question for the wiring audit, not something to resolve by deleting either.
- `app/api/golden-journey/` — pre-existing, referenced by the full-lifecycle spec.

## Rollback

Every session change is confined to the files listed above. Reverting this session means reverting
those 24 modified files and deleting those 7 files plus the 2 created directories; no
pre-existing dirty state needs to be touched to do it.

## Recommendation

The 131 pre-existing dirty files are an engineering risk independent of this work: they mix owner
edits with earlier autonomous edits and nothing distinguishes them. A checkpoint commit of the
pre-existing state, before further sessions layer onto it, would make every later diff meaningful.
That is an owner decision — it changes repository history — so it has not been done.
