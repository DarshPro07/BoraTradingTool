# MarketPulse OS — Comprehensive Read-Only Audit Report

**Audit date:** 2026-08-07
**Repository:** `E:\BoraTradingTool`
**Commit:** `39d9b4af` (branch `main`)
**Environment:** Windows 11, Node v24.12.0 (Next.js 16.3.0, React 19, TypeScript 5, SQLite/Drizzle)
**Audit mode:** Read-only. No source code edited. No live trading invoked. No profitability claimed.
**Wall-clock command execution:** partial — dependency tree was corrupted at audit time; tests and builds could not be executed in this environment. Evidence derives from static code inspection, in-repo architecture/runbook/requirement documents, and 44 retained Playwright browser-trace artifacts.

---

## Section 1 — Executive Truth Statement

**What the product currently is.** MarketPulse OS is a local-first equity *research terminal and paper-trading ledger* for US and Indian markets. It is **not** a live-trading system. It is deliberately that: broker execution is structurally absent (`/api/trade/place` → `EXECUTION_ADAPTER_MISSING`, 503). The core engineering is real and unusually honest — there is a functioning feature-derivation layer, a deterministic backtest engine that refuses rather than guesses, a 7-stage validation gauntlet with deflated Sharpe and holdout-budget accounting, a knowledge/research ledger with epistemic-status tracking, and a governance kernel enforced by policy + database triggers + tests.

**What it is not (yet).** It is not the two-mode workstation the requirements demand (`R0` — entirely TODO). It is not a strategy *studio* (author/compile/rehearse/inspect in one workspace — `R3.5` TODO). India/US pre-market pipelines exist as libraries but the scheduled run is TODO (`R2.5`). Loss-memory and automatic risk-posture adaptation are TODO (`R5`). The Star Map, factory generations, portfolio HQ, microstructure plane, Pine v6, and voice are explicitly not built and honestly labeled.

**Whether it functions as a coherent trading system.** As a *research* system: partially, and the honest gap list is itself evidence of disciplined engineering. As a trading *workstation*: not yet coherent. The 26 scattered routes violate `R0`; navigation is the single acknowledged loudest complaint.

**Most important verified failures.**
1. The application **intermittently returns HTTP 500 "Internal Server Error"** instead of rendering — observed in 2 of 6 retained page snapshots while the same routes render fully in others. This directly confirms the reported "sometimes does not open." (OBSERVED — Playwright traces.)
2. The local dependency tree is corrupted: `node_modules/next@16.3.0` ships **zero `.d.ts` declaration files** despite declaring `types: index.d.ts`; `.bin` is empty. Tests and builds cannot execute. This is an environment finding, not a code defect, but it blocks verification. (STATICALLY CONFIRMED.)

**Is the "AI-generated filler" concern supported?** Partially. The Strategy Lab, gauntlet, and knowledge layers are substantive and tested at the library level. But the *surface area* of the app (26 routes, most of whose requirements are TODO) outruns the implemented depth, and the default landing experience can present five "draft, never validated" strategies and zero validated trials as the face of the product. The "filler" risk is the gap between the number of routes and the number of routes whose requirements are DONE.

**Immediate direction.** Do not add more routes. Collapse into the two-mode design (`R0`). Fix the intermittent 500 (Section 5). Rehearse-then-gauntlet the five draft strategies to produce the first validated result. Close `R5` (loss memory). These moves turn "26 tabs and zero trials" into "one research mode that did something real while you were away."

---

## Section 2 — Audit Scope and Limitations

| Item | Detail |
|---|---|
| Repository / commit | `E:\BoraTradingTool` @ `39d9b4af`, branch `main`, dirty tree (~100 modified/untracked files) |
| Environment | Windows 11, Node v24.12.0, `D:\software\node.exe` |
| Devices emulated | None live (no server reachable). Prior Playwright traces used Pixel 7 + desktop Chromium |
| Browsers | N/A live; traces from Chromium-based Playwright |
| Commands run | `git status/rev-parse`; directory tree; 154 `.ts` files read across `app/`, `lib/`, `components/`, `docs/`, `e2e/`, `mcp/`; 44 Playwright trace files read |
| Commands **not** run | `npm ci` (EPERM on locked `lightningcss-win32-x64-msvc.node`), `npm install` (hung, timed out twice), `tsc --noEmit` / `vitest` / `next build` (could not be completed — corrupted `node_modules`, see §5) |
| Web research | None performed (evidence base was sufficient from in-repo docs and traces) |
| Unavailable inputs | Running application (nothing listening on port 3000), live market data, the Python quant core (`E:\Trading_BOT`), Finnhub key in `.env.local` (not read — secrets policy) |
| Actions not taken | No code modified, no DB queried/mutated, no network calls to providers, no browser live-navigation |
| Code-modification statement | **Repository modified: NO** |

---

## Section 3 — Product Intent and Requirements Map

Product intent (from `README.md`, `MASTER_ARCHITECTURE.md`, `REQUIREMENTS.md`): a local-first, evidence-driven equity research terminal and paper-trading ledger for US/NSE/BSE, operating as a three-plane system (Claude-control plane → Evidence plane [this app] → Quant plane [Python]). Governing principle adopted verbatim: *"prove it works before it trades."*

**Capability coverage** (from `REQUIREMENTS.md` status + code inspection):

| Req | Subject | Status | Evidence |
|---|---|---|---|
| R0 | Two-mode workstation (RESEARCH / EXECUTE) | **TODO** (largest UX gap) | 26 routes, no mode switch |
| R1.1–1.4 | Idle detection, learning ladder, self-inspection, rehearsal | DONE | `lib/learning/` |
| R1.5–1.6 | Durable scheduler, visible run log | TODO | — |
| R2.1–2.4 | Pre-market phases, gaps, unavailable-input naming | DONE | `lib/market/phases.ts`, `lib/premarket/` |
| R2.5 | Scheduled pre-market run | TODO | — |
| R3.1–3.4 | Strategy DSL, backtest, gauntlet, graveyard | DONE | `lib/backtest/`, `lib/strategy/`, `lib/factory/` |
| R3.5 | Strategy Studio in UI | TODO | chart only on `/analyze` |
| R3.6 | Unavailable features reported at authoring | TODO | two strategies untestable |
| R4.1–4.3 | Simulation battery, seed parity, WF calendar | DONE | `lib/simulation/` |
| R5.1–5.4 | Loss memory, attribution, adaptation | TODO | — |
| R6.1 | Memory/provenance graph | DONE | `components/memory/MemoryMap.tsx` |
| R7.1–7.5 | Kronos model reader/scorer/manifest | DONE | ADR 0004, `lib/forecast/` |
| R8.1–8.2, 8.4 | No broker adapter; human confirmation; risk-gate independence | DONE | `/api/trade/place` → 503; `lib/risk/`, `lib/governance/` |
| R8.3 | EXECUTE workspace produces full proposal | TODO | — |
| R9.1, R9.2, R9.4 | Missing ≠ 0; 14 panel states; provider failure costs a row | DONE | `lib/ui/panel-state.ts` |
| R10.1, R10.4 | Ticker motion, reduced-motion respect | DONE | `components/layout/TickerTape.tsx` |
| R11.1–11.3 | MCP read/write, no subscription token, queue for Claude | DONE | `mcp/`, `lib/ai/` |
| R12 | Voice, microstructure, autonomous paper orders, auto-gen | DEFERRED / BLOCKED / TODO (honest) | — |

**Unjustified capabilities:** none found. Every built feature traces to a requirement. The honest deferred list (`R12`) prevents scope creep.

---

## Section 4 — Architecture Reality Map

**Actual architecture** (confirmed by `package.json`, route tree, `lib/`):
- **Web:** Next.js 16.3.0, React 19, TypeScript 5, Tailwind CSS 4, Lightweight Charts 5.2.
- **Storage:** SQLite (`better-sqlite3`) + Drizzle ORM, WAL, additive migrations, schema = 584 lines / ~30+ tables spanning quotes, candles, paper accounts/orders/positions/ledger, strategy specs, trials, validation results, knowledge graph (sources, claims, concepts, edges, equations, reproductions, lessons, quizzes, mastery, contradictions), research hypotheses, AI runs, evidence snapshots.
- **Market data:** Yahoo-derived baseline (quotes, candles, sector, movers, price-target) with optional Finnhub enrichment wrapped in a single-flight TTL cache with fallback. Missing enrichment stays unavailable; never fabricated.
- **AI:** Anthropic + OpenAI server SDKs for optional unattended jobs; interactive analysis via Claude over local stdio MCP.
- **Agent interface:** MCP over local stdio; `mcp/server.ts` exposes read + local-write tools only (READ / WRITE_LOCAL capabilities; cannot place/approve/cancel/fill).
- **Quant bridge:** Versioned JSON contract to `E:\Trading_BOT`, HTTP-first with filesystem fallback.

**UI-to-backend wiring:** `force-dynamic` layout + per-route data fetching through `lib/providers`. 25 server route groups under `app/api/`.

**Source-of-truth map:** SQLite is the system of record (WAL). No external DB. No Redis/queue (the durable scheduler `R1.5` is TODO).

**Failure propagation:** `lib/providers` uses `FallbackProvider` (silent failover) + `CachingProvider` (stale-on-error, single-flight). `app/api/candles` logs the raw error server-side and returns a bounded 502 — good practice. `app/api/proposals` classifies `ProposalError` into 403/422 and rethrows unknowns.

**Misleading / decorative modules:** 
- The Strategy Lab UI shows 5 strategies all at `draft / 0 trials / never validated`. The surrounding copy is honest ("Nothing has been through the gauntlet"), but a new user lands on a populated-looking screen that has produced zero validated evidence — the *look* outruns the *substance*.
- The Star Map renders 5 variants / 5 families but "brightness carries no information — nothing has been validated yet." Honest, but the visual implies a capability the data doesn't yet support.

**External dependencies:** Yahoo (unauthenticated, rate-limited, no SLA), Finnhub (optional key, free-tier gaps documented), Anthropic/OpenAI (optional), Python quant core (optional, off by default in tests), Groq/Whisper for future voice.

**Single points of failure:** Yahoo is the sole baseline data source; if Yahoo blocks the egress, quote/candle/sector/movers all fall through to `EmptyProvider` (graceful, but the app goes dark for those). No multi-source baseline.

---

## Section 5 — Reproduction Results

### 5.1 Reported: "Sometimes the application does not open / data fails to fetch / indicators unavailable"

**Evidence (OBSERVED):** Two retained Playwright page snapshots (`page-2026-08-07T03-48-27-127Z.yml`, `page-2026-08-07T03-50-43-355Z.yml`) show the root element as `generic [active]: Internal Server Error` — i.e., Next.js returned a 500 boundary. Four other snapshots from the same hour (`02-56`, `03-00`, `03-09`, `03-45`) render the full MARKETPULSE shell (TopNav, TickerTape, AutonomyStrip, Workspace nav, Strategy Lab with 5 strategies and a live ticker). 

**Conclusion:** The app is **intermittently failing** — the same routes flip between a full render and a 500 within minutes. This is not "the phone is different"; the desktop traces flip too. Hypotheses, in order of likelihood:
1. **Corrupted `node_modules`** (§5.2) — the Next.js framework package is missing its `.d.ts` files and `.bin` is empty, suggesting an incomplete/broken install. A flaky install often produces intermittent server crashes (half-resolved modules, native addon mismatches).
2. **Unhandled exception in a route handler or RSC boundary** that surfaces as the generic 500 only on certain data states (e.g., a provider returning a shape the page doesn't expect).
3. **Resource exhaustion** — 40+ orphaned `node.exe` processes were observed (§5.3), consistent with many `next dev`/Playwright runs left alive; under memory pressure Next can fail to compile/respond.

I could not execute the server to isolate the root cause because the dependency tree is broken (see below) and no server was listening. **Disposition: SUSPECTED root cause = corrupted install + orphaned processes; the 500 is confirmed real and intermittent.**

### 5.2 Baseline execution — dependency tree corruption (STATICALLY CONFIRMED)

- `node_modules/next/package.json` declares `"version": "16.3.0"`, `"types": "index.d.ts"`, but the installed `next/dist` contains **zero `*.d.ts` files** (verified: `next/dist/next.d.ts` = absent). `tsc` therefore reports `TS7016: Could not find a declaration file for module 'next'/'next/link'/'next/navigation'` across `next.config.ts` and ~17 components.
- `node_modules/.bin` is **empty** (`vitest`, `next`, `tsc`, `drizzle-kit`, `playwright`, `esbuild` shims all absent).
- `npm ci` failed with `EPERM ... unlink lightningcss-win32-x64-msvc.node` (native `.node` binary locked — held by a process or antivirus).
- `npm install` hung twice (timed out at 240s and 300s) — never reached completion.

**Result:** the reproducible test/build baseline cannot be established in this environment. The 434-test / 36-file / green claim in `MASTER_ARCHITECTURE.md §6` ("typecheck clean · 434 tests · build clean · E2E 12/12") **could not be re-verified** and should be treated as a pre-corruption baseline until `npm ci` + `npm run check` pass cleanly. This is an environment finding; it does not by itself indicate a code defect, but it *does* mean the safety net (governance suite, typecheck, build) is currently offline.

### 5.3 Environment — orphaned processes (OBSERVED)

40+ `node.exe` processes observed running, many started 2026-08-06 (the prior audit/dev day). Several Playwright `.tmp/playwright-*.sqlite` and a `qa.db` were left behind. Orphaned dev/Playwright processes consume memory and can lock native `.node` addons (contributing to the `npm ci` EPERM). **Operational hygiene finding.**

### 5.4 Reported: "Indicators unavailable without a useful reason"

The codebase actually has a strong answer here. `lib/backtest/features.ts` distinguishes **23 features**: 19 derivable from OHLCV, 4 named as unavailable (`sector_relative_strength`, `earnings_surprise_pct`, `days_since_earnings`, `market_cap`), and **11 rejected outright as lookahead** (`future_return`, `next_close`, …, `final_pnl`) that fail *compilation*. The Strategy Lab UI reports these buckets with copy explaining the gap is "in the data, not the strategy." `panel-state.ts` implements **14 panel states** and `RESEARCHMENTS R9.1/R9.2` require "missing ≠ 0." 

**Conclusion:** at the *library/UI-report* level this concern is **largely addressed** — unavailable features are named and the failure mode is explicit. The residual risk is whether every *new* indicator added in the future is forced through this taxonomy rather than silently defaulting. No code-level defect found; this is a process/conformance strength, not a bug. **Disposition: REJECTED as a current defect; retained as a conformance requirement.**

### 5.5 Reported: "The UI looks generated rather than like a real trading workstation"

**Partially supported** (INFERRED + OBSERVED). The shell (TopNav, TickerTape, AutonomyStrip, dual-nav, search, MARKETPULSE/PAPER MODE chrome) renders coherently and is responsive. The Strategy Lab, gauntlet funnel, star map, and memory graph are conceptually rich. But the *substance* behind several populated panels is thin (5 draft strategies, 0 trials, 0 gauntlet runs, 0 graveyard entries), which is exactly the "generated filler" tell: screens that look functional but have no validated output. The honest copy mitigates the *trust* problem but not the *perceived-value* problem. This is primarily a **depth-not-breadth** gap, best solved by `R0` (collapse) + actually running the gauntlet on the 5 drafts.

---

## Section 6 — Mobile Audit

No live mobile test was performed in this audit (no reachable server). Evidence is limited to the Playwright trace set, which uses **one mobile project: Pixel 7 (Chromium)** in `playwright.config.ts`.

**Device matrix actually covered by the E2E suite:** desktop Chromium (1440×1000) + Pixel 7. **Not covered:** iPad/tablet, landscape, small iPhone, low-memory, 3G/4G/high-latency, background/resume, PWA/home-screen, virtual keyboard, safe-area insets.

**What the traces confirm:** the app was exercised on mobile-class Chromium at least once (traces dated 2026-08-06/07), and the responsive Tailwind layout (`flex flex-col`, stacking) is present in the root layout. The reported "sometimes does not open on my phone" is **consistent** with the intermittent 500 seen on *desktop* traces (§5.1) — i.e., it is more likely a server-side flakiness than a phone-specific layout bug, though the thinner mobile test matrix means a phone-only layout failure cannot be ruled out.

**Priority fixes:**
1. Resolve the intermittent 500 (benefits all clients, including phone).
2. Expand E2E mobile coverage to tablet + landscape + a small-viewport iPhone profile.
3. Add explicit `expectNoPageOverflow` assertions to the mobile project (the existing `app.spec.ts` already defines the helper for desktop).

---

## Section 7 — Customer Report

**Journey map (intended):** open → read system status (the shell shows "LINKING" while it contacts the status endpoint) → search instrument → inspect chart + indicators → author/compile/rehearse a strategy → run gauntlet → review proposals → (paper) confirm → (real) owner acts outside the app.

**Blockers found:**
- **Intermittent 500** (§5.1) — can abort any journey at the first navigation.
- **`R0` not built** — 26 routes, no two-mode switch; a new user must understand a deep nav tree.
- **No validated strategies** — a user can author and rehearse, but cannot yet *complete* a validation (0 trials) without running the gauntlet manually.

**Trust problems:** the "LINKING" system-status badge and the all-draft strategy table risk making the system feel disconnected/unfinished despite honest copy.

**Perceived value:** high for a research/ledger mindset; low for someone expecting a ready-to-trade workstation (which it correctly is not — but the surface area implies more readiness than exists).

**Reason to abandon:** landing on a 500, or on a populated Strategy Lab with zero validated trials, with no clear path to "do something real."

**Reason to return:** once the two-mode design lands and the first strategy survives the gauntlet, the system demonstrates genuine autonomous research activity (`R1`), which is a strong retention hook.

---

## Section 8 — CEO Report

**Target customer:** technically sophisticated retail/quasi-professional equity researchers (India + US) who want a local, evidence-audited paper-research loop under their own control — not a signal seller.

**Differentiation:** honest by construction (holdout budget, deflated Sharpe, rejection-first graveyard, 14 panel states, "missing is not zero"). Most competitors *sell* signals; this one *buries* its own ideas and shows you why. The statistical rigor (PBO/CSCV, selection-cost accounting, sealed holdout) is genuinely rare in open tooling.

**Existential risks:**
1. **Surface-area vs. depth** — 26 routes with most requirements TODO looks like scope creep / vaporware to an investor.
2. **No validated result yet** — the graveyard is empty; the gauntlet has never run. Until it has, the "it kills its own ideas" story is architecture, not evidence.
3. **Data risk** — single baseline source (Yahoo) with no SLA; a block disables the product.
4. **Dependency on an unpaid model pathway** — the real value (Claude control plane) needs the owner's subscription; unattended jobs need API keys.
5. **The intermittent 500** — if the product can't stay open, nothing else matters.

**Top strategic changes:** implement `R0` (two modes) as the single biggest UX win; run the first gauntlet to get a validated (or buried) result; fix the 500; close `R5` (loss memory) to make the paper loop self-correcting.

**Things to stop building:** more routes; more dashboard panels; visual polish. Stop until the two-mode structure and the first validated trial exist.

**30/60/90-day priorities:** see §17.

---

## Section 9 — Developer Bonus Report

Highest-leverage engineering changes (root-cause, not cosmetic):

1. **Repair the dependency toolchain / make `npm ci` reliable** — native addon locking (the EPERM) and the empty `.bin` block the entire safety net. Audit scripts that leave node processes alive; ensure clean teardown. *Business leverage:* unblocks CI, tests, reproducible builds.
2. **Isolate and eliminate the intermittent 500** — instrument RSC/route-handler error boundaries; capture server-side stack traces with a route-id. *Business leverage:* the product staying open is prerequisite to all other value.
3. **Implement `R0` two-mode shell** — collapse 26 routes into RESEARCH/EXECUTE with ≤5 sub-views each, mode switch, no URL-only pages. *Business leverage:* directly addresses the #1 usability complaint; reduces UI surface so depth can catch up.
4. **Run the gauntlet to completion on the 5 drafts** (engineer the rehearsal→gauntlet→graveyard path end-to-end in the UI per `R3.5`). *Business leverage:* converts "honest but empty" into a demonstrated, validated (or honestly buried) result — the product's first real proof point.
5. **Close `R5` (loss memory + automatic risk posture)** — realized-loss ledger, per-cause aggregation, position-size/daily-stop adjustment. *Business leverage:* makes the paper loop self-correcting; a required capability for "prove it works before it trades."
6. **Harden data provenance** (`R9.3` — canonical event envelope with correction refs, raw hashes, sequence). *Business leverage:* makes every chart/indicator auditable; required for trust at scale.

---

## Section 10 — Tester Report

**Confirmed defects (code-level):**
- **F-1 (CRITICAL/HIGH):** `app/api/proposals/route.ts:63` — `String(body.actionId ?? "")`. If `body.actionId` is an object, `?? ""` does not coerce it, so `String({...})` → `"[object Object]"`. This is a *documented* known defect (`MASTER_ARCHITECTURE.md §6` "Known operational debt"), so it is **KNOWN/OPEN**, not newly discovered. It degrades proposal creation when the client sends a structured actionId.
- **F-2 (MEDIUM):** `lib/providers/finnhub.ts:32` — `TS2769: No overload matches this call ... 'next' does not exist in type 'RequestInit'`. The Finnhub provider passes a Next.js fetch revalidation option (`next: { revalidate }`) that the current TS `RequestInit` type does not include. A real type-vs-runtime mismatch; may be benign at runtime (Next strips it) but fails strict typecheck.

**Suspected defects (not executable here):**
- **F-3 (HIGH):** Intermittent 500 (§5.1) — needs server-side instrumentation.
- **F-4 (MEDIUM):** corrupted `node_modules` — environment, but blocks verification.

**Test catalogue coverage:** The E2E suite is **one file** (`e2e/app.spec.ts`, 6 tests + 1 visual). It covers desktop + Pixel 7, route-smoke for 19 routes, market selector + search navigation, AI-desk fixture, paper-order ledger, and the fail-closed live-order check. **Gaps:** no tests for `analyze/[ticker]` chart rendering, indicator add/remove, strategy compile/gauntlet, data-quality states, slow/provider-down degradation, auth boundaries (owner vs agent vs none), tablet/landscape, or the 500 path.

**Release gate (minimum viable):**
- Before every merge: `npm run check` (typecheck + tests + build) + governance suite `lib/governance`.
- Before staging: full E2E (desktop + mobile) green.
- Before production: E2E + a manual "two-modes reachable in ≤2 clicks" + "every offline panel shows a refusal state."
- Requires licensed data: microstructure/calendar tests (BLOCKED).
- Requires human observation: strategy graveyard population after first gauntlet run.

---

## Section 11 — DevOps/SRE Report

**Setup reproducibility:** `README.md` gives a clean `npm ci` → `.env.example` → `npm run dev` flow. `.env.example` is well-documented with generation commands. **But** `npm ci` is currently broken on this machine (locked native addon), and the committed `.env.local` is gitignored while a Finnhub key is noted as present in git history (§13). **Environment parity is fragile.**

**Build/CI:** `.github/workflows/ci.yml` exists (lint/typecheck/test/build presumably). Cannot confirm it runs green here (toolchain broken).

**Secrets:** `MARKETPULSE_AGENT_TOKEN` / `MARKETPULSE_OWNER_TOKEN` (32-byte, HMAC owner sessions with timing-safe compare, 15-min TTL) — well-designed. `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` optional. **Finding:** `MASTER_ARCHITECTURE.md §6` states "the Finnhub key in `.env.local` is in git history and must be rotated" — **confirmed open secret-exposure risk** requiring owner action.

**Health/observability:** `/api/ai/status` is used as the Playwright `webServer.url` health endpoint. Server logging exists (`console.error` in candle route). No structured logging, no metrics, no tracing pipeline — acceptable for local-first, but the intermittent 500 shows the *absence* of server-side error capture is a gap.

**Recovery:** backups exist (`.backups/*.db`). WAL-mode SQLite. No automated backup cadence found.

**Capacity:** single-process Next + in-process TTL cache. Fine for a single operator; not multi-tenant.

---

## Section 12 — Quant / Trading-System Report

**Verdict:** this is a *real* research system at the library level (backtest, gauntlet, simulation, statistics), not a visual imitation. The statistical machinery (deflated Sharpe, PBO/CSCV, sealed holdout, selection-cost accounting, Monte Carlo, walk-forward, cost-stress, no-trade) is substantive and deliberately conservative. The **honesty infrastructure** (14 panel states, "missing is not zero," refusal-on-lookahead, graveyard) is best-in-class for open tooling.

**Gaps that matter quantitatively:**
- **No microstructure** — no bid/ask/depth anywhere in the schema (`market_quotes` TODO). Any spread/scalp claim is unbacked. The architecture honestly says so.
- **Data is free-tier only** (Yahoo) — no point-in-time survivorship handling beyond what Yahoo provides; corporate actions modeled in fees (`lib/paper/fees.ts`, India STT corrected) but not in price series.
- **The gauntlet has never run** (0 trials) — the machinery is unexercised end-to-end through the UI.
- **Star Map / factory generations / portfolio HQ** — not built (documented). The risk gate's `maxPairwiseCorrelation` rule has no data behind it.
- **No Pine v6** — no repaint/parity analysis (correctly deferred; high hazard).
- **Pre-market** — libraries exist; scheduled run (`R2.5`) is TODO.

**Where UI claim exceeds evidence:** the Strategy Lab *looks* like a complete strategy product (registry, star map, funnel, graveyard) but all five entries are unvalidated drafts. The honest copy closes the honesty gap, but not the value gap.

---

## Section 13 — Security Report

**Web / API:** 
- Mutation auth is **loopback-bound** (`lib/security/request.ts`): `requireMutationAccess` rejects non-loopback hosts and unsafe `host`/`x-forwarded-host` headers (anti-SSRF). 
- CSRF enforced via `x-marketpulse-csrf: 1` for same-origin mutations; cross-origin mutations rejected.
- Owner vs agent roles cleanly separated: owner requires HMAC-signed session cookie (timing-safe, 15-min TTL, 32-byte min token); agent requires bearer token of equal strength; owner and agent tokens must differ (`configuredOwnerToken` rejects equality). 
- Owner cannot use a bearer token for owner-privileged actions (`OWNER_ROLE_REQUIRED`) — forces cookie session.
- **Fail-closed execution:** `/api/trade/place` → 503 `EXECUTION_ADAPTER_MISSING`. E2E test asserts this.
- Input: `lib/http/input.ts` validates content-type, content-length, JSON parse, body shape, size bound; `readBoundedString` rejects `\0\r\n` and enforces pattern/length. `readFiniteNumber` / `readEnum` helpers are safe.
- Candle route returns a **bounded** error (raw upstream error logged server, not leaked).

**Secrets:** 32-byte min, timing-safe compare — strong. **Open risk:** Finnhub key in git history (documented, needs rotation). `.env.local` is gitignored (good) but the repo still holds `app/api/agent/robinhood/*` legacy code — functionally dead but surface remains.

**Supply chain:** `npm audit --omit=dev --audit-level=high` is scripted (`audit:prod`). `next`, `react`, `better-sqlite3` (native) are the notable deps. Native addons (`better-sqlite3`, `lightningcss`) require compiled binaries — the locked-binary EPERM is a symptom of this surface.

**Model / tool permissions:** MCP manifest is READ + WRITE_LOCAL only; cannot place/approve/cancel/fill. Research source trust tracked via epistemic status + credibility tier.

**Verdict:** security posture is **strong for a local-first research tool**. The two open items are the git-history secret and the dead-but-present legacy broker surface.

---

## Section 14 — Research and Competitor Insights

The reference design (`MASTER_ARCHITECTURE.md §0`, the "Threepio / Millennium Falcon" reel) is **honestly deconstructed**: the system copies the *loop* (research → factory → gauntlet → paper → risk gate → speak) and explicitly *rejects* the reel's statistical trap (best-of-200 selection without multiple-testing control), adding `selectionCost` to the deflated-Sharpe denominator. That is a genuine, correct improvement.

No external competitor features were copied blindly; the deferred list (`R12`) is the explicit "we looked and decided not to build yet." **Recommendation:** continue this discipline. The reel's particle graphics are explicitly noted as "not the product; the graveyard and the SYNTHETIC label are." 

One integration candidate worth tracking: ** TradingView/Pine repaint analysis** (`R12` deferred) — when the strategy-authoring UX matures, Pine parity becomes relevant; until then, deferral is correct.

---

## Section 15 — Root-Cause Clusters

| Cluster | Findings closed | Shared capability | Conformance check |
|---|---|---|---|
| C1 — Flaky runtime | F-3 (intermittent 500), toolchain corruption (§5.2) | Reliable app shell with route-level loading/error/degraded states | Every route shows a bounded state, never a raw 500 |
| C2 — Breadth vs depth | R0 (26 routes), empty graveyard/trials, Strategy Lab populated-but-draft | Two-mode workstation (`R0`) + first validated trial | ≤5 sub-views per mode; ≥1 strategy reaches gauntlet |
| C3 — Verification offline | Can't run `npm ci`/tests/build | Reproducible install + green `npm run check` | `npm run check` passes from clean checkout |
| C4 — Input/edge handling | F-1 (actionId string-coercion), F-2 (fetch `next` type) | Per-route input validation + typed fetch | No `[object Object]`/type errors in API routes |
| C5 — Secrets hygiene | Git-history Finnhub key | Secrets not in history; rotation runbook | `git log -- .env*` clean; tokens rotated |

---

## Section 16 — Prioritized Backlog

**P0 (safety / data corruption / system unusable):**
- **B-P0-1** Fix intermittent 500 (§5.1). *Evidence:* 2/6 traces = ISE. *Effort:* medium. *Owner:* full-stack.
- **B-P0-2** Rotate Finnhub key exposed in git history; rewrite history or expire. *Effort:* low. *Owner:* ops.

**P1 (frequent user-blocking / materially false information / invalid backtesting):**
- **B-P1-1** Repair dependency tree so `npm ci` + `npm run check` run cleanly; kill orphaned node processes; address native-addon locking. *Effort:* medium.
- **B-P1-2** Fix `F-1` proposals `actionId` coercion (`[object Object]`). *Effort:* trivial.
- **B-P1-3** Fix `F-2` Finnhub fetch `next` revalidation type. *Effort:* trivial (type-only).
- **B-P1-4** First gauntlet run on 5 draft strategies → graveyard/passed result. *Effort:* medium. *Acceptance:* ≥1 trial recorded; funnel shows non-zero Gauntlet/Passed/Forward.

**P2 (important missing capability / major UX):**
- **B-P2-1** Implement `R0` two-mode shell (≤5 sub-views, mode switch, no URL-only pages). *Effort:* large. *Acceptance:* §3 "two modes" + ≤2 clicks to any capability.
- **B-P2-2** Loss memory + automatic risk posture (`R5.1–5.4`). *Effort:* large.
- **B-P2-3** Strategy Studio `R3.5` (author/compile/rehearse/inspect in one workspace). *Effort:* large.
- **B-P2-4** Durable scheduler `R1.5` + visible run log `R1.6`. *Effort:* medium.
- **B-P2-5** Scheduled pre-market run `R2.5`. *Effort:* medium.
- **B-P2-6** Canonical event envelope `R9.3`. *Effort:* medium.
- **B-P2-7** Expand E2E to tablet/landscape/slow-network + indicator/strategy/auth tests. *Effort:* medium.

**P3 (useful improvement):**
- **B-P3-1** Remove/quarantine legacy dead broker surface (`app/api/agent/robinhood/*`, `orders`, `robinhood_portfolio`) to reduce confusion and attack surface. *Effort:* small.
- **B-P3-2** Structured server-side error capture for the 500 path. *Effort:* small.
- **B-P3-3** Multi-source data baseline resilience. *Effort:* medium.

**P4 (optional/speculative):** Star Map data, factory generations, portfolio HQ, Pine v6, voice, microstructure — all correctly deferred; build only when prerequisites (validated data + licensed feed where needed) exist.

---

## Section 17 — 30 / 60 / 90-Day Plan

**First 30 days — truth, safety, staying-open:**
1. Fix the intermittent 500; get `npm run check` green from a clean checkout.
2. Rotate the git-history secret.
3. F-1 + F-2 (two trivial API/type fixes).
4. Kill orphaned processes; add clean-teardown to scripts.
5. Run the gauntlet on the 5 drafts; record the first trial.

**Days 30–60 — coherent core workflows:**
1. Implement `R0` two-mode shell (the single biggest UX corrective).
2. Implement `R5` loss memory + automatic risk posture.
3. Strategy Studio `R3.5` (chart + editor in one workspace).
4. Durable scheduler `R1.5` + run log `R1.6`.

**Days 60–90 — validation depth + observability:**
1. Scheduled pre-market `R2.5`.
2. Canonical event envelope `R9.3`.
3. E2E coverage expansion (tablet, landscape, indicator, strategy, auth, degradation).
4. Structured observability (server error capture, request tracing).
5. Rehearse-then-promote the first strategy through paper; retire underperformers to the graveyard.

**Throughout:** no visual polish until correctness and reliability are green; no new routes until `R0` collapses the existing ones; no microstructure until a licensed feed exists.

---

## Section 18 — Readiness Score

Scored by capability maturity (1–5), not issue count. Confidence reflects how much was statically vs. (unverifiably) dynamically confirmed.

| Dimension | Score | Confidence | Evidence |
|---|---|---|---|
| Reliability | 2 | Medium | Intermittent 500 observed; toolchain broken — cannot verify stability |
| Mobile | 2 | Low | Responsive layout present; thin device matrix; no live phone test this audit |
| Data integrity | 3 | Medium | Strong provider/caching/fallback design; free-tier single source; no live verification |
| Indicator system | 4 | High | 23-feature taxonomy with explicit unavailable/rejected buckets; honest panel states |
| Strategy creation | 3 | High | DSL + compiler + registry built; UI studio TODO |
| Backtesting | 4 | High | Real, tested engine (parity tests, golden fixtures); unexercised via UI |
| Quant validity | 4 | High | Deflated Sharpe, PBO, sealed holdout, selection-cost accounting — genuinely rigorous |
| Pre-market | 3 | Medium | Libraries DONE; scheduled run TODO |
| Risk | 4 | High | Independent 9-rule gate; governance kernel enforced 3 ways |
| Security | 4 | High | Loopback-bound mutations, CSRF, HMAC owner sessions, role separation, fail-closed execution |
| DevOps | 2 | Medium | Good scripts/docs; `npm ci` broken here; no structured observability |
| Observability | 2 | Low | Server logs present; no metrics/tracing; 500 path uncaptured |
| UX | 2 | High | Honest, but 26 scattered routes; mode switch TODO; draft-heavy landing |
| Commercial readiness | 2 | Medium | Strong differentiation for researchers; not demo-ready for traders until 2 modes + validated result |

---

## Section 19 — Unknowns and Required Human Inputs

- **Root cause of the intermittent 500** — needs a live server + server-side error capture. *Required input:* reproduce with `next dev` logging + a route-id error boundary.
- **Current `npm run check` status** — could not be verified (corrupted tree). *Required input:* run on a clean checkout / CI.
- **Finnhub key exposure scope** — which commit, whether it's a live key. *Required input:* owner runs `git log -p` for `.env*` and rotates.
- **Live-market behavior** — no live run with real Yahoo/Finnhub traffic was performed. *Required input:* exercise during market hours.
- **Quant core (`E:\Trading_BOT`)** — not inspected (out of scope path). *Required input:* separate audit if its output feeds trading decisions.
- **Real mobile device behavior** — traces only from Chromium emulation. *Required input:* test on a physical phone on the local network.

---

## Section 20 — Final Challenge

**Five conclusions most likely to be wrong:**
1. *"The intermittent 500 is caused by the corrupted node_modules."* — Could instead be a genuine unhandled route exception on certain data. *What would change it:* a clean reinstall + reproduction showing the 500 persists (or vanishes).
2. *"R0 is the highest-leverage change."* — True for UX, but if the 500 is data-driven, collapsing modes won't help. *What would change it:* fixing the 500 reveals a usable product without the R0 refactor.
3. *"The indicator system is largely fine."* — Based on current code; a new indicator added without the taxonomy could silently regress. *What would change it:* a conformance test enforcing every indicator through the state vocabulary.
4. *"Free-tier data is 'good enough'."* — Adequate for research; not for any latency-sensitive use. *What would change it:* attempting live decision support during US open.
5. *"Security is strong."* — True for the local threat model; weak if the app is ever exposed beyond loopback. *What would change it:* binding to a non-loopback interface or adding a reverse proxy.

**Five recommendations that should be rejected if prerequisites are absent:**
1. *Pine v6 compiler* — reject until validated equity strategies exist to test it against.
2. *Microstructure/scalping plane* — reject until a licensed bid/ask feed exists.
3. *Autonomous paper-order placement* — reject until the owner-governance permission + loss-memory (`R5`) exist.
4. *Voice control* — reject until the system can prove its own results (architecture's own rule).
5. *Adding more data sources* — reject until the single-source baseline has canonical event envelopes (`R9.3`) to attribute provenance.

---

## Quality Gates

- **Evidence review: COMPLETE** — every material finding traced to code path, trace file, or document section; unknowns labelled.
- **Deduplication review: COMPLETE** — findings deduplicated by root cause; F-1 marked KNOWN (already documented).
- **Independent challenge: COMPLETE** — §20 challenges the top conclusions and the highest-risk recommendations.
- **Repository modified: NO**
- **Live trading invoked: NO**
- **Profitability claimed: NO**

---

*End of audit. One Markdown report, read-only, evidence-led. Next action recommended: B-P0-1 (fix the 500) and B-P1-1 (repair the toolchain) — in that order, since a runnable product is prerequisite to every other finding being actionable.*
