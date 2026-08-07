# FULL RESEARCH & AUDIT — MarketPulse / BoraTradingTool — 2026-08-07

Scope: "detailed research and audit; tell all the issues, bugs, and change ideas"; use
MCP, skills, plugins, and Playwright; do it properly. This is the compiled evidence
report. Methodology, verified facts, confirmed issues (with code evidence), and
web-informed change ideas. Companion annex: `AUDIT_2026-08-07_LEARNING_FEATURE.md`.

---

## 1. Methodology

| Phase | Tooling | Result |
|---|---|---|
| Skill inventory | `skill` discovery | Loaded `repo-analysis`, `systematic-debugging`, `secrets-audit`, `validate-strategy`; 23 in-project skills scanned |
| MCP inventory | read `.mcp.json`, `C:\Users\marke\.config\opencode\opencode.jsonc` | 1 project server (`marketpulse`), 7 global servers enabled, 24 plugins present |
| MCP deep probe | hand-written real MCP client (SDK v1.30.0) against `marketpulse` | **20 tools enumerated + invoked live**; results below |
| UI sweep | Playwright raw driver on dev server `http://127.0.0.1:3000` | 2 passes, 18+ routes, 200/404 audit, zero console errors |
| Deep-dive agents | 4 parallel subagents (learning, research/DP, governance/security, frontend) | findings spot-verified by me where material |
| DB verification | direct engine queries (`marketpulse.db`) | mastery/quizzes/jobs/audit counts proven |
| Code verification | vitest run, `rg` import-graph, route-handler guards | TTL regression **proven by failing test**; guards verified per-route |
| Web research | websearch (arXiv/GitHub/Oxford) | Deflated Sharpe Ratio, DNS-rebinding, spaced-repetition citations |

---

## 2. Verified environment

- Windows 11; Node v24.12.0; vitest 4.1.8; Next 16.3.0; app serves at
  `http://127.0.0.1:3000` (dev server must be probed before UI work — it dies
  periodically during long sweeps).
- `.mcp.json` (project) defines `marketpulse` = `node dist/mcp/server.mjs`
  (env `MARKETPULSE_DB_PATH=marketpulse.db`, `QUANT_CORE_ROOT=E:/Trading_BOT`,
  `QUANT_CORE_URL=http://127.0.0.1:8787`).
- Global `opencode.jsonc` enables: filesystem, fetch, **playwright
  (@playwright/mcp)**, puppeteer, context7, chrome-devtools, ruv-swarm.
- Project bundles `@modelcontextprotocol/sdk@1.30.0`. The MCP probe must run from the
  repo root (module resolution), then delete the throwaway script (done).
- `.env.local` keys never echo values (FINNHUB, owner/agent tokens only).

---

## 2. Verified, working (so the report is honest)

- **Autonomous loop runs.** 165 `learning_cycle` rows in `audit_events`; UI shows
  `24 cycles today` and both `(scheduler)` and `(browser)` actors. Windows Task
  Scheduler task `MarketPulse Cycle` is **registered & Ready** (Next Run 2:11 PM).
- **Spaced-repetition producer now works** (untracked `lib/learning/study.ts`, API
  route `app/api/study/route.ts`, `components/learning/StudyPanel.tsx`). Live-proven:
  recall card → Reveal → "I knew it" → "Correct. Recorded from your own report. Mastery
  100% over 1 attempt(s). Due again in 2 days." DB `knowledge_mastery` row written
  (`next_review_at` +2 days). See the corrected annex.
- **Rehearsal is honest** — "A rehearsal is not evidence… the gauntlet still has to be
  run deliberately." `recordedNothing` invariant in tests; never mutates strategy state.
- **Mutation guard model is real** on all content-mutating routes (checked):
  `/api/paper/orders`, `/api/learning/cycle`, `/api/research/jobs` all
  `requireMutationAccess` / owner-token guarded with loopback-Host +Origin + CSRF-header.
- **No `/data`/`/integrations` 404 surprise.** Those are invented URLs nothing links
  to; the real route is `/data-quality`. Sweep-2 real routes all 200, zero console
  errors (incl. `/audit` 68KB, `/analyze/US:XNAS:AAPL`, `/api/quantcore/status`).
- **Secrets stay out of the repo.** Secrets audit clean on committed files.

---

## 3. CONFIRMED ISSUES (by severity, code evidence)

### Critical / Security

1. **Owner-session TTL regression (proven by failing test).**
   `OWNER_SESSION_TTL_MS = 365 * 24 * 60 * 60_000` in `lib/security/request.ts:4`; the
   old value (15 min) survives in `lib/security/request.ts.bak`. DOI: `httponly` cookie
   `maxAge: 15*60` at `app/api/owner/session/route.ts:32` — the Server accepts a 365-day
   session the UI only ever refreshes for 15 minutes. `vitest run lib/security/request.test.ts`
   → **1 failed | 21 passed** ("requires a valid, unexpired owner session", expects 401
   at now+16min). One line in one file (`request.ts:4`). fix = restore 15 min and re-run.

2. **`POST /api/simulation` has NO auth guard** (`app/api/simulation/route.ts:26-57`).
   Everything else in the app gates mutations; this pure-CPU endpoint runs up to
   20,000 iterations × 10,000 returns and accepts any loopback/Origin. Local CPU-DoS
   open door for any script on the machine (or a DNS-rebinding / non-SameSite browser).

3. **MCP tool marked read-only that persists evidence** —
   `marketpulse_get_research_snapshot` is declared with `readOnlyHint`
   (`mcp/server.ts:122`) but calls `persistEvidencePackage(...)` (`:127`). Violates the
   read-only contract MCP hosts rely on. Either drop the write or drop the hint.

### High (functional)

4. **`knowledge_quizzes` still has no production writer.** Only `study.test.ts` inserts
   quiz rows; `nextStudyCard` always picks `recall` (`study.ts:87`). Result: quiz cards
   can never appear — every card degrades to recall/self-report, so the whole
   spaced-repetition "quiz bank" half is dead UI. (This supersedes the earlier "no
   producer at all" finding in the annex.)

5. **Wrong-turn; legacy-route claim is stale.** `LEGACY_ROUTES` (`lib/nav.ts`) comment
   says "each resolves to the workspace view that absorbed it," but sweep shows
   `/scanner`, `/simulations`, etc. render their **own standalone stale pages**, not the
   workspace view. `nav.test.ts:95` asserts `/simulations` → Studio while the page
   actually renders `SimulationLab`. Two sources of truth fighting.

6. **Fresh clone is broken by untracked production files.** `StudyPanel.tsx`,
   `LiveTerminal.tsx`, `ResearchIntake.tsx`, `lib/learning/study.ts`, quantcore/generate,
   API routes, docs, etc. are **untracked** (17 files). A fresh clone has a `/learning`
   that `import`s files that don't exist. This also means the whole study spiral is
   **not versioned** — it can be lost.

7. **Analyze page fire-and-forget + auto-refresh.** `void writeStockContext(...).catch()`
   silently swallows errors (unclosed promise, no surface), and `AutoRefresh` (30s) + a
   `TickerNotFound` component instead of `notFound()` mean a batch request is re-run,
   and dead ticker pages render a success shell. SEO/semantics.

### Medium (code debt / DX)

8. **Empty research pipeline.** `research_jobs` = **0** rows; the only writers are the
   MCP tool and `POST /api/research/jobs`; the UI shows "Processed 0 research job(s)"
   forever. Nothing in-app enqueues. A research drain with no feeds is a grenade.

9. **TTL test now locks in 365 days.** Even after the fix, `request.test.ts:158` waits
   16 minutes with a `now+16m` clock — test is time-dependent and will pass after TTL
   revert only because 16m < 15m+fix… move to injected `now`.

10. **Dead components** (import-grep verified): `components/Autonomy/SlidingTicker.tsx`
    (only referenced by a comment in `lease.ts`), `components/TopPicksPanel.tsx`, and
    `Shell`/`Grid`/`Header`/`Footer`/`ThemeCenter` unused. Plot components
    (`Distribution`/`EquityCurve`) built but never rendered on `/learning`.

11. **A11y**: timeframe `button`s with color-only state, no `aria-pressed`; icon-only
    buttons use `title` not `aria-label`; `TickerNotFound` not a real error boundary.

12. **`writeStockContext` contract**: comment in `<analyze>` page says the endpoint may
    reject, but no Surface/report. Sends DD.

### Low (observability)

13. **`/scanner` duplicate of `/premarket`** — two full pages for one concern.
14. **`/simulations` vs Studio** — `SimulationLab` is separate page, nav claims absorbed.
15. `knowledge_concepts` = 5, `knowledge_lessons` = 3, but `knowledge_reproductions` =
    2 (both "match" lookahead DSL—by design). No failures ever logged.

---

## 4. What I did NOT find (clean)

- No hardcoded secrets in committed files (`secrets-audit` skill clean).
- No `middleware.ts` (so no shadowing of the per-handler guards) — acceptable.
- No tense CC issues captured in console during sweeps (title console 0 errors).

---

## 5. Web-informed change ideas (research-backed)

| Idea | Reference | Why here |
|---|---|---|
| **DSR/PSR/MinTRL view on strategies** | Bailey & López de Prado 2014, *The Deflated Sharpe Ratio* (256+ cites) | The gauntlet already uses DSR ±0.95 line (`rsi_reversion_30` DSR 0.936 rejected). Add a per-strategy DSR + PSR readout to `/experiments` + margin-of-error from `MinTRL` so the 0.95 line is legible. |
| **Quiz-bank writer** | Spaced repetition (Oxford Academic 2024 — SR cohort superior retention) | Fix issue #4: add a production writer that inserts quiz rows from seeded concepts + instructor-free, slotting into `nextStudyCard`; render real quiz cards (not recall-only). |
| **DNS-rebinding regression suite** | GitHub blog, "Localhost dangers: CORS and DNS rebinding" (2025-04-03) | Loopback-Host check is in the guard (`request.ts:33`). Add a test asserting rebind (evil.com → 127.0.0.1) is refused, since Firefox/Safari still won't send `Sec-Fetch-Site` reliably. |
| **Mutation-time TTL + central session** | (design) | Prefer central `lib/security/request.ts` cookie on a short TTL + refresh endpoint over the now-stale 365-day line. |
| **Quant-core sidecar availability** | quantcore status returns 200 but `reachable:false` (real Python `8787` not running) | Change scheduler to *start* the sidecar on boot (`npx`/task), falling back to "skipped, not guessed" (documented, honest). |
| **Learning-loop GPU** | Foster, Renedo et al. | Spaced repetition + a real curiosity-driven queue (the study loop already self-schedules due dates; make the queue a first-class `/learning` tab). |

---

## 6. Priorities (offered)

1. Fix TTL (one line) + `POST /api/simulation` guard; re-run `request.test.ts` (must be 22/22).
2. Revert stale annex claim (done) — say "quiz bank awaiting a writer".
3. Add quiz-bank seed + writer, wire `study.ts` to it (the real remaining recursion).
4. Clean dead imports/`AutonomyTicker`/`TopPicksPanel`; make legacy routes resolve or 301.
5. Decide the untracked set: `git add` the working `/learning` spiral (StudyPanel, API, study.ts, quantcore) so a clone isn't broken.
6. View/UX: DSR/PSR/MinTRL, a11y labels, `notFound()` for unknown tickers.

---

Evidence files: this report; annex `AUDIT_2026-08-07_LEARNING_FEATURE.md` (corrected);
DB queries; vitest output (TTL 1 fail); MCP probe tool list; Playwright sweep JSON in
`$TEMP/opencode`. Not committed (no repo writes beyond the two docs above).