# MarketPulse OS — Audit Annex: Research-Backed Findings & Concrete Change Ideas

**Annex to:** `AUDIT_2026-08-07_COMPREHENSIVE.md`
**Date:** 2026-08-07
**Sources:** Web research (Next.js issue tracker, npm issue tracker, Playwright docs, quant-trading architecture references) + static code inspection + 44 in-repo Playwright browser traces.

---

## A1 — Why the intermittent 500 happens (research-backed)

### A1.1 A known Next.js 16 bug matches the symptom exactly

The observed failure — **intermittent `500 Internal Server Error` with no browser message, flipping between working and failing on the same route within minutes** — matches a documented upstream Next.js 16 defect:

- **vercel/next.js#86373** — *"Race condition in Node.js middleware body cloning still causing production errors"*
  - Symptom: `TypeError: Response body object should not be disturbed or locked` thrown intermittently, **especially under load or with concurrent requests**, in production (Docker standalone) and under load in dev.
  - Root cause: Next.js calls `requestData.body.finalize()` **without awaiting it**, leaving the stream in an inconsistent state; a concurrent request then clones a corrupted `Request`.
  - Confirmed fix (merged but released only in a later patch): `await requestData.body.finalize()`.
  - Reproduction characteristics line up with what was observed: intermittent, load-dependent, worse with concurrent requests.

**What this means for MarketPulse:** The app uses `force-dynamic` layout + many API routes and runs under Next 16.3.0. Under the dev server with multiple polling clients (several routes poll providers on timers), concurrent request-body handling can hit this exact race. The fix is upstream — **ensure Next.js is patched to a version containing the awaited-finalize fix** (or apply the documented `.patches/next@...` workaround via `pnpm patchedDependencies`, or downgrade the dev concurrency).

### A1.2 Next.js hides the real error from the browser — look at the terminal

Per Next.js docs and the Prismix/AppHosts guides: **Next.js intentionally returns a blank `500` body in production** so stack traces never leak. The real error — with message, file path, and line — is always printed to the terminal running `next dev` / `next start`. 

**Actionable fix for diagnosis:** reproduce the 500 while watching the dev terminal; the actual exception (and the route that threw) will be printed there. This single step converts the 500 from "mysterious flakiness" to "route X threw Y at line Z."

### A1.3 Error boundaries the app may not yet have

Per the Next.js App Router error-handling guide (nextjslaunchpad.com / Next.js docs), production-grade error handling requires **all six** of:
1. Root `app/error.tsx` — catches unexpected errors app-wide.
2. Root `app/not-found.tsx` — handles unmatched URLs.
3. Root `app/global-error.tsx` — catches root layout/template errors.
4. Route-specific `error.tsx` — for sections needing custom error UIs.
5. Route-specific `not-found.tsx`.
6. Server Action error handling (`useActionState`).

**Key gotcha:** an `error.tsx` only catches errors rendered *below* it — page and children, **not** its own layout. Layout errors in a segment bubble to the parent's `error.tsx` or ultimately `global-error.tsx`. Without each boundary, a thrown error becomes a hard 500 / full-screen crash instead of a graceful degraded panel.

**Concrete change idea:** add `app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx` and per-route `error.tsx` for the chart/data-heavy routes (`/analyze/[ticker]`, `/dashboard`, `/strategies`). Each boundary should render a bounded "this panel is unavailable — reason + retry" UI consistent with the existing 14-state panel vocabulary, and log the error via `useEffect` (error boundaries swallow errors from global handlers unless you log them explicitly).

---

## A2 — Why `npm ci` fails with EPERM and `install` hangs (research-backed)

The two environment failures observed are both well-documented Windows/npm issues with known causes and fixes.

### A2.1 `npm ci` → `EPERM: operation not permitted, unlink lightningcss-win32-x64-msvc.node`

**Causes (in order of likelihood):**
1. **A `node.exe` process is holding the `.node` native binary open.** This is the single most common cause. The npm/cli maintainers note the locking process is often *npm's own child node process*. (Confirmed in 40+ orphaned `node.exe` processes observed on this machine — see §5.3 of the main report.)
2. **Antivirus real-time scanning** of `node_modules` (Windows Defender, or third-party AV) locking files mid-rename. npm/cli#568 documents exactly this on Windows.
3. **An editor (VS Code) or its file watcher** holding handles in `node_modules`.

**Fixes, in priority order:**
1. Kill all node processes before install: `taskkill /f /im node.exe` (after saving work). Also `taskkill /f /im Code.exe` if VS Code is watching the tree.
2. Add AV exclusions for: the project `node_modules`, `%APPDATA%\npm`, `%LOCALAPPDATA%\npm-cache`. (Permanent fix; persists.)
3. As a retry-on-failure workaround, some CI teams wrap `npm ci` in a retry loop (give up after ~5 retries) since the lock is transient.
4. Switching to **pnpm** or **Bun** (fewer file-lock issues; Bun's native file ops are less prone) is the deeper fix used by teams that hit this repeatedly.

**Recommended immediate action for this repo:** close all running dev servers / Playwright / VS Code, `taskkill /f /im node.exe`, clear AV-locked handles, then `npm ci`. If it still fails, add AV exclusions and retry.

### A2.2 `npm install` hangs with no output

**Causes (SoftPlix, CSNAINC, StackOverflow, npm/cli#6517):**
1. Corrupted npm cache.
2. Network/registry timeout (npm defaults to 30 s; slow or blocked registry → silent hang).
3. Corrupted or registry-drifted `package-lock.json`.
4. A single package stalling the ideal-tree fetch.

**Fixes, in order:**
1. `npm cache clean --force` then retry.
2. `rm -rf node_modules package-lock.json` (PowerShell: `Remove-Item -Recurse -Force node_modules; Remove-Item package-lock.json`) then `npm install`.
3. `npm install --verbose` to see exactly which package/step it stops on — that's the culprit.
4. Raise the timeout: `npm config set timeout 60000`.
5. Reset registry: `npm config set registry https://registry.npmjs.org/`.

**Recommendation:** combine 1+2+4, run with `--verbose`. If it hangs on a single large package every time, that package is the problem — install it separately or pin it.

---

## A3 — The corrupted `node_modules` (zero `.d.ts` in `next`)

A `next@16.3.0` install that ships **zero `.d.ts` files in `next/dist`** and an **empty `node_modules/.bin`** is a classic signature of an **interrupted/incomplete install** — consistent with `npm install` having been hung and killed (§A2.2). The packages are partially unpacked; native binaries (`.bin` symlinks, `.d.ts` bundles) that arrive later in the install were never written.

**Fix:** a clean reinstall is the only reliable repair:
```
taskkill /f /im node.exe
Remove-Item -Recurse -Force node_modules
Remove-Item package-lock.json
npm cache clean --force
npm install --verbose
```
Then `npm run check` should restore the documented "typecheck clean · tests green · build clean" baseline. Until this is done, **no build/test-based verification is trustworthy** — treat all "passing" claims as pre-corruption.

---

## A4 — Concrete change ideas grounded in research

### A4.1 Reliability epic: survive errors gracefully (REQUIRED NOW)

**Idea:** Wrap every route group in `error.tsx` + `not-found.tsx`; add a root `global-error.tsx`; give each data panel a bounded degraded state from the existing 14-state vocabulary instead of crashing to a 500.

**Why local patches aren't enough:** the 500 originates at the Next.js route-handler / RSC boundary layer — it's not a bug in one page, it's the *absence* of a boundary that catches whatever any page throws. Only route-level boundaries close it everywhere.

**Evidence:** vercel/next.js#86373 (race condition) + Next.js error-boundary guide (6 files needed) + observed 500s.

**Acceptance:** throw an exception in any route handler → the user sees a bounded "unavailable — retry" panel, never a blank 500; dev terminal still shows the real stack trace.

### A4.2 DevOps epic: make the toolchain reliable (REQUIRED NOW)

**Idea:** Add an AV-exclusion step to `SETUP.md`, add a `pretaskkill`/clean script that runs `taskkill /f /im node.exe` before installs, and add a `.patches/next@...` (or pin to a known-good Next 16 patch) until the awaited-finalize fix is in the installed release. Optionally evaluate **pnpm** to sidestep npm's Windows file-lock issues.

**Evidence:** npm/cli#568 (EPERM = orphaned node / AV); vercel/next.js#86373 (Next race); 40+ orphaned node processes observed.

**Acceptance:** `npm ci` succeeds from a clean checkout on a freshly rebooted Windows machine with default AV; `npm install` completes without hanging.

### A4.3 UX epic: two-mode workstation R0 (REQUIRED LATER — biggest single value unlock)

**Idea:** Collapse 26 routes into **RESEARCH** (command, dashboard, premarket, strategies, simulations, paper, learning, memory, library, jobs) and **EXECUTE** (proposals, trades, portfolio, audit, data-quality, settings), with one top-level mode switch, ≤5 sub-views each, and no page reachable only by URL.

**Design reference (research):** Bloomberg-terminal UX principles — dark-only surfaces, monospace data fonts, tabular layouts, data density via gestalt principles (proximity, similarity, closure, symmetry). Two open references exist: `sandeep-jaiswar/terminal-ui` (Bloomberg-inspired React component lib, Turborepo, Tailwind) and Open Design's `trading-terminal` system (dark `#0d0d0d`, cyan `#00d4aa` buy / coral `#ff4757` sell). These are *style references only* — adopt the **density and color-grammar**, not copy components wholesale.

**Why this over more routes:** §REQUIREMENTS.md R0 is the single acknowledged loudest complaint; 26 routes with mostly-TODO requirements is the "AI-generated filler" tell.

**Acceptance:** new user reaches any capability in ≤2 clicks from the mode switch; ≤5 sub-views per mode.

### A4.4 Quant epic: event-driven order book / microstructure (CONDITIONAL — needs licensed data)

**Idea:** Per research (QuantInsti, TradeJS, efekumru/backtest-framework), a production-grade engine needs: event-driven simulation core, realistic cost/market-impact modeling, walk-forward with purging/embargo, Monte Carlo robustness, **and an order book** for scalping. The current `lib/execution/orders.ts` already has resting orders / partial fills / OCO / TIF — good groundwork.

**Condition:** only build after a licensed bid/ask feed exists (`market_quotes` with bid/ask + availability flag). Without it, any spread/scalp claim is unbacked (the architecture already says so honestly).

### A4.5 Walk-forward on the 5 draft strategies (REQUIRED NOW — produces the first validated result)

**Idea:** Close the "honest but empty" gap by running the existing gauntlet on the 5 draft strategies via the UI (`R3.5`). Per QuantInsti/BreakOrb research: walk-forward validation is the difference between a curve-fitted backtest and a strategy that actually has edge; **profit factor > 5 or win rate > 70% are overfitting red flags**. The graveyard should start getting real entries.

**Acceptance:** ≥1 trial recorded; funnel shows non-zero Gauntlet/Passed/Forward; graveyard has ≥1 entry with a reason.

---

## A5 — Idea disposition matrix (research → decision)

| External idea | Source | Decision | Reason |
|---|---|---|---|
| `terminal-ui` (Bloomberg-inspired component lib) | github.com/sandeep-jaiswar/terminal-ui | Adopt grammar (density, mono, dark), not components | Avoids lock-in; matches existing Tailwind/shadcn stack |
| Open Design `trading-terminal` color system | opendesigner.io | Adopt color tokens only | Portable; doesn't dictate components |
| Next.js View Transitions API | nextjslaunchpad.com | Defer | Premature before R0 exists |
| pnpm / Bun to fix npm file-locks | npm/cli#568, research | Adopt pnpm (evaluate) | Fewer EPERM hangs; workspace-friendly |
| Pine v6 compiler | TradingView / R12 | Reject (now) | Needs validated strategies first (prerequisite) |
| Star Map (strategy correlation) | MASTER_ARCHITECTURE.md §7 | Required later | Risk gate's `maxPairwiseCorrelation` needs this data |
| LLM-discovered rules → deterministic runtime | TradeJS | Adapt | Fits the "Claude proposes, deterministic engine executes" design |

---

## A6 — Research / source references

| # | Title | Publisher | URL | Claim supported |
|---|---|---|---|---|
| 1 | Race condition in Node.js middleware body cloning (Next.js 16) | vercel/next.js #86373 | github.com/vercel/next.js/issues/86373 | Intermittent 500 root cause; awaited-finalize fix |
| 2 | Next.js API Route 500 Error guide | Prismix | prismix.dev/guides/nextjs-api-route-error | 500 hides real error in terminal |
| 3 | Next.js error.tsx Complete Guide 2026 | Next.js Launchpad | nextjslaunchpad.com/article/nextjs-app-router-error-handling-complete-guide | 6 error-boundary files needed |
| 4 | [BUG] npm ci fails with EPERM/unlink on Windows | npm/cli #568 | github.com/npm/cli/issues/568 | EPERM = orphaned node / AV |
| 5 | npm install Not Working — Complete Guide 2026 | SoftPlix | softplix.com/category/node-js/error/npm-install-not-working | Cache/timeout/lock fixes for hangs |
| 6 | npm install hangs (npm/cli#6517, #11361) | npm/cli | github.com/npm/cli/issues/6517 | Hang causes + --verbose diagnosis |
| 7 | Bloomberg Terminal UX design principles | Bloomberg UX / cgaa.org | bloomberg.com/ux/ | Density, dark surfaces, data-first |
| 8 | terminal-ui (Bloomberg-inspired React lib) | sandeep-jaiswar | github.com/sandeep-jaiswar/terminal-ui | Design-system reference |
| 9 | Event-driven backtesting architecture | QuantInsti, Inferensys | blog.quantinsti.com/walk-forward-optimization-introduction | Event-driven engine + WFO pattern |
| 10 | Walk-forward validation: why most backtests lie | BreakOrb | breakorb.com/blog/walk-forward-validation-trading.html | Overfitting red flags; WFO necessity |

*All sources accessed 2026-08-07. Factual claims are limited to what these sources support.*

---

*End of research annex. Combined with the main audit report, this gives: verified findings (trace/code-backed), suspected-but-unverified issues with their disambiguation conditions, environment failures with explicit fixes, and a set of change ideas each grounded in a specific external source and marked integrate/adapt/defer/reject.*
