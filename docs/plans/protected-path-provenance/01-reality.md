# Protected-path dirty state — provenance and resolution (Gate 0 + decision)

**Date:** 2026-08-14 · **Trigger:** owner directive to resolve this BEFORE further Job/Agent/
Provider schema work. Independent verifier flagged it 2026-08-13 (dependency-engine Gate 5).

## What is dirty and what it is

One coherent, owner-directed refactor — **"single always-RUN mode + ownerless local auth"** —
sitting uncommitted across protected paths, authored by a prior session (INFERRED: matches the
owner's standing directives "one single mode which is run always", "remove the owner access
token"; no commit records it):

| File | Change |
|---|---|
| `lib/governance/runtime.ts` | `getLearningMode()` coerces: only stored `off` is respected; everything else returns `evolving` |
| `lib/brain/auto-mode.ts` (new, unprotected) | RUN / MAINTENANCE layer over the same row; `setAutoMode` writes `evolving`/`off` |
| `lib/governance/policy.ts` | +4 allowlisted autonomous actions: `run_gauntlet` (evolving), `research_instrument`, `author_strategy`, `run_backtest` |
| `lib/security/request.ts` (+test) | rewrite: owner-token auth → invisible local session cookie |
| `app/api/owner/session/route.ts` | **deleted** (owner login endpoint gone) |
| `.env.example` | `MARKETPULSE_OWNER_TOKEN` removed |
| `mcp/server.ts` | +123 lines (session/tool growth, same refactor) |
| `lib/governance/mcp-manifest.ts` | +5 lines |
| `drizzle/0014_autonomy_default.sql` | **applied migration edited in place** — see below |

**OBSERVED:** the unit suite (142 files / 1676 passed / 0 failed) and `npm run build` are green
WITH this refactor in the tree; its own tests were updated alongside it (runtime.test,
request.test). Sessions 3–6 built and verified on top of it.

## The 0014 finding — the edit is dead code three ways (STATICALLY_CONFIRMED)

1. **The runner never executes the file.** `lib/db/migrate.ts:200-201` routes
   `0014_autonomy_default.sql` to the hardcoded TS function `applyAutonomyDefaultMigration`,
   which still writes `mode = 'learning'`. The .sql is documentation for 0014, not its
   implementation.
2. **Applied migrations are skipped anyway.** Any database whose `schema_migrations` records
   0014 never re-runs it, whatever the file says.
3. **Runtime ignores the stored mode.** Both read paths (`getLearningMode`, `getAutoMode`)
   coerce everything except `off` to evolving/RUN.

So the edit could never change behavior — but it made the tree lie twice: fresh checkouts would
carry a file claiming `'evolving'` while the runner applies `'learning'`, and the applied-
migration divergence the owner described (old-0014 DBs vs new-0014 readers) existed in
documentation even though not in execution.

## Preserved evidence — the working-tree diff of 0014 before restoration

```diff
--- canonical (HEAD, what the runner's TS twin implements)
+++ working tree (the dead edit)
@@
--- Start safe local research autonomy on a fresh installation.
+-- MarketPulse is always RUN. Learning never stops; other lanes are timing/market dependent.
 --
--- Only the untouched bootstrap row is changed. Any owner choice writes a real timestamp through
--- setLearningMode(), so an explicit OFF state remains OFF across upgrades and restarts.
+-- Fresh installs start in "evolving" (the highest autonomous mode). Only an explicit "off"
+-- state is respected for maintenance. The old mode toggle is removed — single RUN mode.
 UPDATE learning_state
-SET mode = 'learning',
+SET mode = 'evolving',
@@ (audit INSERT: 'learning' → 'evolving' in subject, detail, learning_mode)
```

## Decision

- **Restore `drizzle/0014_autonomy_default.sql` to canonical** (`git checkout`). Zero behavior
  change; removes both lies.
- **No new data migration.** The intended change ("default is always-RUN") is implemented in
  CODE (`runtime.ts` coercion + `auto-mode.ts`), covers every database uniformly — old, new and
  fresh — and needs no schema or data change. A migration rewriting stored rows to match a
  coercion that ignores them would be ceremony. If the owner ever wants the stored row aligned
  for raw-reader honesty, a one-line `0019` (`UPDATE learning_state SET mode='evolving' WHERE
  id=1 AND mode<>'off'`) + registration in `lib/db/migrate.ts` does it — recorded here as the
  optional path, deliberately not taken.
- **The rest of the refactor stays in the tree** as inherited work-in-progress: it is the
  owner's stated direction, its unit tests are green, and reverting it would break the suite
  that was co-updated with it. It is NOT committed by this session (committing is the owner's
  call), and its auth surfaces (`/api/*` under the new local-session model, MCP session tools)
  have **not** been e2e-verified in this pass — that is the named residual risk.

## What the resolution changes for future sessions

The rule this incident pins: **the intended change behind an applied-migration edit must be
re-expressed in code or a NEW migration, never by editing the applied file** — and in this repo,
0004/0006/0014 are TS-implemented in `migrate.ts`, so their .sql files are documentation whose
only correct state is agreement with the TS twin.
