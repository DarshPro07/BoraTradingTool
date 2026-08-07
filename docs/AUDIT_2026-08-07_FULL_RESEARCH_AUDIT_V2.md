# FULL RESEARCH & AUDIT v2 — MarketPulse / BoraTradingTool — 2026-08-07 (evening pass)

Re-audit performed because "code changed a lot": 24 files modified (+811/−48), 10 new
untracked files, 1 new security-related commit absent. Companion: v1 report
`AUDIT_2026-08-07_FULL_RESEARCH_AUDIT.md` (superseded where noted below).

## Verification performed this pass (all live, not assumed)

| Check | Result |
|---|---|
| Full suite `npx vitest run` | **848 passed, 2 skipped, 1 FAILED** (owner-session test, `lib/security/request.test.ts:152`) |
| `tsc --noEmit` | clean |
| Playwright sweep (24 routes + API) | all 200; `/integrations` `/data` 404 (still unlinked inventions); 0 console/page errors on real routes |
| MCP probe (rebuilt `dist`, 20 tools) | `system_status` now `quantCore.ok:true` via **filesystem** transport, `SELF_GENERATED` artifacts |
| MCP integration tests (`mcp/server.integration.test.ts`) | 4/4 pass |
| Live study API (GET + grade) | card served; **wrong option → `correct:false`, right → `correct:true`, self-report on a quiz concept → accepted** (`gradedBy:"self_report"`) |
| DB counts | quizzes **10** (was 0), mastery **2**, concepts **15** (was 5), cycles **207** (51 today), research_jobs still **0** |
| `.env.local` selected value (line 8, `ffb30eca…` 64-hex) | is one of the `MARKETPULSE_*_TOKEN`s (FINNHUB is 40 chars) — **`git grep` clean, `.env.local` ignored; not committed anywhere** |
| `data/quantcore/` | real artifacts written (board packet, universe, regime_state, 2 journals) |

---

## 1. NEW CRITICAL SECURITY FINDING — owner-session gate removed, test red, UI now cosmetic

**Committed contract** (still in `request.test.ts:152-160` and `request.ts.bak`): a browser
owner action required a valid, unexpired owner-session cookie (`OWNER_SESSION_TTL_MS =
15 * 60_000`), i.e. the "UNLOCK OWNER CONTROLS" token ceremony actually gated
`PATCH /api/learning`, `/api/agent/config`, `/api/agent/strategies`, `/api/proposals`.

**Working-tree contract** (`lib/security/request.ts:164-175`): `requireOwnerMutationAccess`
= `requireMutationAccess` (loopback + same-loopback-Origin + CSRF header) **plus only**
"reject if a bearer token is present". The session check is gone:

- `hasValidOwnerSession` is now **dead code** (defined at `request.ts:111`, called by nothing).
- The 365-day `OWNER_SESSION_TTL_MS` (`request.ts:4`) is now meaningless (nothing validates
  expiry); the cookie `maxAge: 15*60` in `app/api/owner/session/route.ts:32` is decorative.
- `LearningModeControl.tsx` still shows the token form and "Owner controls unlocked for
  15 minutes" — a ceremony that gates nothing.
- **Consequence**: any local process (or rebind-free page from 127.0.0.1) can flip learning
  mode to `evolving`, change agent config, or advance/reject proposals **without the owner
  token**. The owner token was the only factor separating "any code on this machine" from
  owner authority; loopback+Origin+CSRF were always satisfiable locally.
- The single failing test is the canary: it asserts the old contract and fails.

**Recommendation**: either restore the session check (revert `request.ts` to the `.bak`
logic, keep TTL 15 min — one function + one constant), or — if dropping the gate is
intentional — delete the ceremony (`LearningModeControl` unlock UI, `hasValidOwnerSession`,
the `maxAge` cookie logic, `request.ts.bak`) and rewrite the test to assert the new
contract. Mixed state (gate half-removed, UI half-present, test half-old) is the actual bug.

## 2. FIXED since v1 (verified, with gratitude-worthy notes)

| v1 finding | Status |
|---|---|
| `POST /api/simulation` unguarded CPU-DoS | **FIXED** — `app/api/simulation/route.ts` now calls `requireMutationAccess` (loopback/Origin/CSRF); comment documents the reasoning; `/simulations` UI now uses `mutationFetch` |
| Quiz bank dead (`knowledge_quizzes` no writer) | **FIXED** — cycle seeds "10 graded quiz question(s)"; 10 quiz rows exist; quiz grading verified end-to-end via API (correct/incorrect both graded against stored answer) |
| Research queue had no door | **FIXED** — `components/research/ResearchIntake.tsx` is the queue's only in-app writer; documented as paste-content-not-URL because no model reads pages |
| Tests wrote into the owner's production DB | **FIXED with permanent debt** — `lib/db/index.ts` now refuses the default DB from any test process (`MARKETPULSE_TEST_MODE` **or** `VITEST`); `useTemporaryDatabase()` helper; `run-log.test.ts` now isolated. **But**: 135 `test-writer` fixture cycles are already permanently in `audit_events` (append-only trigger) — handled by `NON_DRIVER_ACTORS` exclusion + `excludedFixtureCount()` surfaced in `/api/cycles`. Debt cannot be deleted, only excluded. |
| Quant core unreachable / `E:/Trading_BOT` dependency | **FIXED, biggest change** — quantcore root now `data/quantcore/` (repo-local); `lib/quantcore/generate.ts` produces artifacts from the system's own evidence each cycle; `regime.ts` (realised-volatility classifier, percentile-ranked, honest `asOf`), `signals.ts` (three-valued entry scan: `undefined` ≠ `false`, warm-up refusals named); `disabled` state (`QUANT_CORE_URL=off`) distinguished from crashed/absent; cycle text says "switched off… not part of this install" instead of "unreachable" |
| CSRF header hand-rolled in 2 call sites | **FIXED** — `mutationFetch` now also sets `content-type` when a body exists; owner sign-in content-type trap documented and closed |
| Nav "absorbed view" claim vs stale pages | **NOT FIXED** — `/scanner` still renders its own `ScannerPage` fetching `quantResource("board")` directly; `LEGACY_ROUTES` still only feeds tab highlighting; `nav.test.ts:95` still asserts `/simulations`→Studio while the page renders `SimulationLab` |
| Dead components | **NOT FIXED** — `AutonomyTicker.tsx`, `TopPicksPanel.tsx` still import-referenced only by comments/docs |
| Analyze page fire-and-forget | **NOT FIXED** — `void writeStockContext(...).catch()`, `AutoRefresh` 30s, `TickerNotFound` instead of `notFound()` all still present |

## 3. NEW / REMAINING issues (ranked)

1. **Owner gate removal** (above) — HIGH, one red test.
2. **MCP read-only tool that writes** — `marketpulse_get_research_snapshot` carries
   `readOnlyHint` (`mcp/server.ts:122`) yet calls `persistEvidencePackage` (`:127`).
   Violates the read-only contract every MCP host relies on. Unchanged from v1.
3. **`dist/mcp/server.mjs` staleness hazard** — the checked-in MCP entrypoint is a
   gitignored build artifact; `.mcp.json` points at `dist/`, and I proved it served the OLD
   quant-core logic until rebuilt manually (`npm run build:mcp`). No hook rebuilds it in the
   dev loop → agents using MCP can silently get stale behavior.
4. **Quiz card accepts self-report bypass** — `gradeStudyAnswer` accepts `recalled` even when
   the concept HAS a gradeable quiz (`study.ts:155-166`), so a client can mark a quiz card
   "I knew it" without picking an option, earning `gradedBy:"self_report"` credit instead of
   the stored-answer grade. `study.ts` itself argues these must not be blended — enforce it:
   return `NOT_GRADEABLE` when `quiz`+`options` exist and `recalled` is sent.
5. **135 permanent test rows in the audit trail** — excluded at read, but the owner's
   evidence table contains fabricated cycles forever. Acceptable engineering, worth knowing.
6. **`research_jobs` still 0** — intake door now exists, but nothing has queued work; cycle
   still honestly says "Processed 0 job(s)".

## 4. What improved materially (positive evidence)

- The loop now generates its own quant-core artifacts and the MCP surface reports
  `ok:true, transport:"filesystem"` with an explicit `SELF_GENERATED` primary limit that
  refuses to be read as independent corroboration — honest self-sufficiency.
- Cycle reports are named and quantified ("Would survive the battery: sma_cross_20_50 (90
  trades / 12 instruments)"), and the "proposals off by design" line no longer reads as a
  failure every pass.
- Test isolation is now structurally enforced (the throw in `databasePath()`), and the
  permanent contamination is surfaced, not hidden.
- Rehearsal/regime/scan code is unusually well-documented; refusals distinguish
  warm-up/unknown/absent instead of collapsing to "no signal".

## 5. Recommended next actions (offered, not started)

1. Fix the owner gate (restore 15-min session check **or** remove ceremony + rewrite test).
2. Remove `readOnlyHint` from `marketpulse_get_research_snapshot` (or drop the persist).
3. Enforce quiz-vs-recall grading exclusivity in `gradeStudyAnswer`.
4. Add `build:mcp` to the dev script (or document the staleness).
5. Decide the legacy-route story (301 or real absorption) and the dead components.
6. Consider `git add` of the untracked working-tree files (StudyPanel, API study/cycles,
   quantcore generate/regime/signals, db/testing, tests) — a fresh clone is currently
   broken by imports of these files (v1 finding, still true).

— Evidence: this file, v1 report, vitest output (1 fail), MCP probe output, Playwright
sweep JSON, DB queries. No repo mutations besides the two audit docs.
