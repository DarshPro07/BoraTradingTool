# Build log

Appended after every phase. Read this plus `docs/GOAL.md` to resume after any interruption.

---

## 2026-08-06 · Phase 0 — foundation docs · DONE

Written because the build had libraries and tests but no stated direction, and the owner could
not tell what had been made.

- `docs/GOAL.md` — the one sentence, the constraints, the phase order, where to resume
- `docs/REQUIREMENTS.md` — R0–R12 with DONE/PARTIAL/TODO/BLOCKED per item
- `docs/ARCHITECTURE.md` — planes, the autonomous loop, validation pipeline, Kronos, loss memory, all as Mermaid
- `docs/STRUCTURE.md` — module map, dependency rule, protected paths, test layout
- `docs/WIREFRAMES.md` — the two workspaces view by view, route map, motion rules

---

## 2026-08-06 · Phase A — two workspaces · DONE

**The problem:** 26 pages across 5 nav sections. Navigating was the loudest complaint.

- `lib/nav.ts` rewritten: `RESEARCH` (Command · Markets · Pre-market · Studio · Memory · Paper)
  and `EXECUTE` (Proposals · Markets · Risk · Audit). Utility links (Autonomy, Data, Settings)
  moved out of the working tabs into the chrome.
- `MARKETS` is the *same object* in both workspaces, not a copy — two screens showing the same
  sectors and movers would eventually disagree.
- `LEGACY_ROUTES` keeps every old URL working and highlights the workspace that absorbed it.
- `components/layout/TopNav.tsx` — the two workspaces render as a switch, not a row of links.
- `app/trades/page.tsx` — was a bare `redirect("/paper")`, so clicking EXECUTE landed you back
  in RESEARCH. Now the actual EXECUTE home.
- `lib/execution/proposal.ts` + tests — a proposal carries `executable: false` in the payload,
  a computed maximum loss, and `DEFER` separated from `BLOCK` (a timing block expires; a size
  block does not).

**Corrected mid-phase:** `/dashboard` was absorbed into a legacy redirect, removing sector
performance, gainers/losers and news flow. Restored as `Markets` in both workspaces.

**Removed slop:** the first `candidates()` in the EXECUTE page looped over strategies, computed
variables and always returned `[]`. Replaced with `eligibleStrategies()`, which reports what is
eligible and states plainly why a priced proposal cannot be derived from a page render.

**Verified live:** workspace switch highlights correctly on `/command`, `/dashboard`, `/trades`;
sub-nav shows 6 and 4 views; Markets retains sectors, movers, news, indices; EXECUTE shows the
execution-boundary notice, an `empty` state with a reason, and 11 owner-set risk ceilings.

---

## 2026-08-06 · Phase B — autonomy made visible · DONE

**The problem, in the owner's words:** "in the top it's showing learning learning learning but
nothing is happening genuinely."

It was happening. It left no trace, so a hundred passes and zero passes rendered identically.

- `lib/learning/run-log.ts` — every cycle recorded to `audit_events` (existing table, no
  migration). `autonomyPulse()` distinguishes **never run** from **stalled**, which look alike
  and send you hunting a broken scheduler on a system that was simply never started.
- `lib/learning/cycle.ts` — the body has four exits, one per mode tier. Wrapped so there is
  exactly one recording site rather than four and, eventually, one forgotten.
- `components/layout/AutonomyStrip.tsx` — mode, **age of the last cycle**, what it did, cycles
  today. Pulsing dot only while running and not stalled: a stalled loop goes still rather than
  keeping up a reassuring animation.
- `components/learning/ActivityFeed.tsx` — timestamped history on Command.
- `components/learning/RunCycleButton.tsx` — run one now, because "wait fifteen minutes to find
  out whether autonomy works" is not a testable proposition.
- `components/learning/AutonomyTicker.tsx` — fires every 15 min while a tab is open. Stated
  plainly in the file that this is **not** a durable scheduler.

**Verified live:** strip reads `LEARNING · last cycle just now · 4 actions · 2 rehearsed ·
1 need attention · 10.1s · 1 cycle today`. Clicking Run cycle took the feed 3 → 4 runs. Second
cycle ran in 0.8s against the first's 10.1s, confirming the candle memoisation.

**Found by running it:** both strategies in the database are `not_evaluable` —
`FEATURE_NOT_AVAILABLE: cannot derive market_cap, sector_relative_strength, earnings_surprise`.
They were never testable, not merely untested. Nothing had surfaced that before.

---

## 2026-08-06 · Phase C — loss memory and risk adaptation · DONE

**The requirement, in the owner's words:** *"whenever it loses, like it lost 20 rupees today, it
should adjust itself and add in memory that I lost this and I should do this for this."*

- `lib/paper/loss-memory.ts` — closed trades **reconstructed** from filled orders through the
  same average-cost rule the paper repository uses, not recorded to a parallel table. A second
  source of truth about the same money would eventually disagree with the first, and then
  neither is trustworthy. `reconciles()` asserts the agreement and the UI shows the drift if it
  ever appears.
- Causes aggregate from `paperOrders.reason`, ordered by **damage done, not frequency** — the
  biggest hole is the one worth explaining. Three occurrences marks a pattern.
- `riskPosture()` tightens in **bands**, never continuously: a ceiling that moves on every trade
  makes it impossible to say which rule was in force when a decision was taken.
- Adaptation is **one-directional**. There is no path that widens a ceiling, and a test asserts
  a profitable run cannot buy a bigger position size. A system that can raise its own limits
  after a bad run can trade its way out of a drawdown.
- Only *realised* loss tightens. Unrealised movement changes on every tick, and a ceiling that
  moves with the market is not a ceiling.
- `components/paper/LossLedgerPanel.tsx` on `/paper`.

**Verified live:** no closed positions yet, so the ledger reports `empty` with a reason and the
posture sits at the owner's ceilings with zero drift. The adaptation itself is proven by pure
tests rather than by fabricating trades to make a demo look alive.

---

## 2026-08-06 · Phase D — feature support at authoring time · DONE

**The root cause the autonomous loop surfaced:** the DSL *permits* four features no engine can
derive — `market_cap`, `sector_relative_strength`, `earnings_surprise_pct`,
`days_since_earnings`. The compiler accepted them silently and the failure appeared only at
replay time as `FEATURE_NOT_AVAILABLE`. Both strategies in the database were in exactly that
state: not merely untested, **untestable**, and nothing said so.

- `lib/strategy/dsl.ts` — `UNSUPPORTED_BY_ENGINE` declared, and `compileStrategy` now warns
  naming every unsupported feature the strategy uses. It still compiles: the strategy is not
  malformed, the deployment is incomplete, and refusing would discard a legitimate idea.
- Declared in `dsl.ts` rather than imported from `features.ts`, which imports *from* `dsl.ts` —
  the reverse would be circular. `feature-support.test.ts` pins the two lists together and
  asserts they partition the permitted features exactly, so neither can drift.
- `components/strategy/FeatureSupportPanel.tsx` — 19 derivable, 4 unsupported, 11 rejected
  outright as lookahead, each group explained.
- `components/strategy/GraveyardPanel.tsx` — what died, why, and what it cost in trials.

**Removed slop:** the first edit left a duplicate GATES panel behind `className="hidden"`.
Deleted rather than hidden.

---

## 2026-08-06 · Ordering defect found by the server log · FIXED

The autonomous ticker produced a flood of `UND_ERR_CONNECT_TIMEOUT`. Cause: the rehearsal
fetched twelve instruments × three years **before** checking whether the strategy could use
them. Both specs need `market_cap`, which no amount of price history supplies — so every cycle
spent twelve network calls, and on a degraded link twelve ten-second timeouts, to relearn a fact
available for free.

- Feature derivability is now checked **before** any fetch. **10,100ms → 34ms, zero requests.**
- Circuit breaker in `dataset.ts`: if *every* instrument in a market fails that is an outage, and
  later cycles skip the market for ten minutes. One instrument failing is a data gap and still
  costs only that row, so a single bad symbol cannot trip the breaker.

No test could have caught this: every test injects a loader that never touches the network, so
the cost was invisible. Unit tests verify *what* happens, not *what it costs*.

---

## 2026-08-06 · Phase E — graphical showcase · DONE (pending browser check)

- `lib/ui/plot.ts` — pure geometry, no DOM: `histogram`, `lineSeries`, `drawdown`, `cumulative`,
  `positionOf`. 25 tests.
- `components/plot/Distribution.tsx` — the **shape** a verdict hides. Two candidates can both
  read `fail` and look nothing alike; the reference line marks the gate so the distance between
  the mass of the sample and the bar is visible rather than inferred.
- `components/plot/EquityCurve.tsx` — equity with a drawdown strip beneath it. Drawn together
  because either alone misleads: a curve ending above where it started looks like success until
  you see it spent months forty percent below its peak.
- Wired into `/paper` (realised equity from the reconstructed ledger) and `/simulations` (the
  trade-return distribution under test, break-even marked).

Three decisions worth keeping:

- **Drawdown measures against the running peak**, not the starting value. "Still above where I
  started" must never count as "no drawdown".
- **A constant series draws through the vertical middle**, not along an edge — pinning it to the
  top implies a maximum the data does not contain.
- **A degenerate histogram returns one bin**, never a zero-width division. NaN geometry renders
  as an empty chart, which reads as "no data" when the truth is "no variation".

**Verified live.** `/simulations`: 24 bins, reference line, `noise` → 12 failing bars, `edge` →
10. `/paper`: the ledger's own empty state short-circuits before the curve, so a zero-trade
account says "no position has been closed yet" rather than drawing a flat line that implies a
record exists. 0 console errors, no overflow.

**Two defects the browser caught, both in bin colouring:**

1. `bin.to <= reference` never fired for the bin holding the losing mass, because that bin
   straddles the reference. On a series of small losses and a few large wins it painted the
   entire distribution as passing. Fixed by comparing the midpoint.
2. A bin that *spans* the reference is now drawn neutral rather than assigned a side. When one
   outlier stretches the range, bins near zero are wider than the values they separate, and
   picking a side there is a claim the resolution cannot support.

---

---

## 2026-08-07 · Audit fixes and the gap that made everything empty · DONE

Preceded by `docs/AUDIT_2026-08-06_GAP.md`, written after finally opening the video **frames**
rather than the documents describing them.

### Confirmed bugs, fixed

- **`/watchlist` returned 500.** `WatchlistManager` guarded `item.quote &&` — the object — then
  called `.toFixed()` on `changePct`, which is `number | null`. Each numeric field is now checked
  individually and an absent one renders as absent, not as zero.
- **Four dead `/analyze` links.** The page held bare symbols; the route needs `US:XNAS:NVDA`.
  Resolved through the catalog, and where there is no match the ticker renders as **plain text**.
  A link known to fail is worse than no link: it invites the click.
- **`/api/quantcore/status` polled every 30s forever** for a core that is not installed. Backs
  off to five minutes once unreachable.

### Two defects of my own, found while fixing those

- **Duplicate autonomous drivers.** `SystemPulse` already ran cycles — idle-aware,
  visibility-aware, five-minute floor. My `AutonomyTicker` was a second, dumber timer racing the
  same research queue, which is where "21 cycles today" came from. Removed. I had added it
  without reading what already existed.
- **My first backoff fix was an infinite request loop.** Putting `status` in the effect deps
  re-runs it on every poll, and the effect requests immediately: request → setState → effect →
  request. Keyed on the reachability boolean instead.

### The gap: strategy authoring

Every screen was empty for one reason — **no strategy existed that the system could test**. Both
specs needed `market_cap`, and there was no way to create another.

- `app/api/strategy/author/route.ts` — schema → compile → **graveyard** → store, in that order.
  The graveyard check precedes storage, so re-authoring a buried strategy is a 409 rather than a
  row that every future rehearsal wastes work rediscovering.
- `components/strategy/StrategyAuthor.tsx` — presets, not a blank editor. Three use only
  derivable features so the battery runs immediately. The fourth uses `market_cap` deliberately
  and produces the warning at authoring time — the lesson the two dead specs learned over weeks.

**First real end-to-end run:** `sma_cross_20_50` → `would_pass`, 87 trades across 12 instruments,
survived all five simulations, 1 signal dropped for capacity.

### Two visuals from the frames

- `lib/strategy/star-map.ts` + component — variants as constellations by family, brightness =
  out-of-sample profit factor, red marks a burial. Positions hash from the strategy id so a star
  keeps its place across renders; a map that reshuffled would make visual memory worthless.
  `familyOf()` collapses `sma_cross_20_50` and `sma_cross_10_30` into one family, because a
  parameter sweep is one search and counting variants separately defeats the correction.
- `components/strategy/ValidationFunnel.tsx` — survivor counts per stage.

**A defect in my own funnel, caught and fixed:** the REHEARSED row counted `trials` rows, but
trials are written *by the gauntlet* — so REHEARSED and GAUNTLET showed the same number. The
rehearsal records nothing per strategy by design, so the only honest source is the last cycle's
count from the run log, now labelled "last cycle" rather than presented as a cumulative total.

**Verification:** 58 test files, 758 passed, 2 skipped, clean typecheck.

---

## 2026-08-07 · P3 — one cycle at a time, across three drivers · CODE COMPLETE, UNVERIFIED

**The owner chose all three drivers** — Task Scheduler, daemon, and browser tab. Three drivers
draining one research queue is the bug that already happened once: `AutonomyTicker` was added
beside the existing `SystemPulse` without reading what was there, and produced twenty-one racing
cycles in a day.

- `lib/learning/lease.ts` — `open(…, "wx")` is the mutex. Atomic on Windows and POSIX, no schema
  change. A single-row table with a conditional `UPDATE` was the first design, but
  `migrateDatabase` reads a **hardcoded** `MIGRATIONS` array in the owner-reviewed
  `lib/db/migrate.ts`, so a new `drizzle/*.sql` would have sat there unread. Found by reading the
  migration runner rather than assuming Drizzle discovered files.
- **The lease lives in `runLearningCycle`, not in the drivers.** The browser path runs through
  `app/api/learning/cycle/`, which is owner-reviewed and not agent-editable — a guard placed per
  driver would have covered the two I wrote and silently missed the one that is open all day.
- **Leases expire rather than being cleaned up.** A crashed holder never releases; past the TTL
  any driver may take it. That turns "recover from a crash" into "wait", which has no failure
  mode of its own. An unparseable lease counts as expired — a lease nobody can read is not
  evidence somebody holds it, and trusting it would wedge autonomy forever on one bad write.
- `scripts/cycle.mjs` + `scripts/cycle-entry.ts` — headless, no server, no browser. **Calls
  `process.chdir(ROOT)` first**: Task Scheduler starts tasks in `System32`, and `databasePath()`
  resolves against `cwd`, so without it the scheduled cycle would have created a second empty
  database in `System32` and learned nothing there forever.
- `scripts/daemon.mjs` — the dev convenience, and labelled as such: it dies on reboot.
- `CycleReport.blockedBy` distinguishes *refused* from *ran and found nothing*. A refused cycle
  reports `quantCore: null` and `openFailures: null`, never `0` — zero is a finding, and this
  call looked at neither. It is also **not written to the run log**, or "cycles today" would
  count work that never happened.
- `AutonomyStrip` and `SystemPulse` now name the driver. "last cycle 4m ago · this tab" and
  "· scheduler" are different facts: the first means autonomy stops when the tab closes.

**Also fixed:** `lib/providers/finnhub.ts` passed `next: { revalidate: 60 }`, which is not in
`RequestInit`. Removed rather than cast — every production construction goes through
`CachingProvider`, whose quote TTL is 15s, so a 60s fetch cache underneath made that TTL untrue.
One cache that states its age beats two that disagree about it.

**Not verified.** `better-sqlite3` still has no compiled binary and Bash is still hook-blocked, so
no typecheck, no test run, no browser check. Do not treat this section as done until
`npm run check` passes.

---

## 2026-08-07 · P4 (part) — the research registry gets a screen · CODE COMPLETE, UNVERIFIED

`sourceCoverage()` was written, exported, and **called from nowhere** — the same shape as
`runGauntlet`, which was fully implemented and reachable only from the test suite. A registry with
no screen states a target nobody can check.

- `components/research/SourceCoverage.tsx` on `/library`: eleven declared sources against what has
  actually been archived, per source, with the last intake date.
- A source with nothing archived reads **"never read"**, not `0`. The bar is only drawn once
  something has been read — eleven zero-width bars look like a broken renderer, not a backlog.
- Unregistered intake is counted and explained rather than hidden: a one-off is legitimate, but a
  registry nothing matches is decoration.

**P5 research finding — Stooq covers Warsaw, LSE, Nasdaq and NYSE. No NSE.** So a second free
source hardens the **US** baseline only; India keeps Yahoo as its single point of failure and that
gap must be named on the data-quality screen rather than papered over with a fallback that
silently does not cover it. Verified by search, not assumed — and Stooq blocks the fetcher, so the
CSV format still needs confirming from a real request before a provider is written against it.

---

## 2026-08-07 · P0 — the toolchain, and what was actually wrong · DONE

**Every 500, the empty `node_modules/.bin`, the missing `better-sqlite3` binary and the broken
`npx` were one fault:** `node.exe` lived in `D:\software`, which was on Git Bash's PATH but not on
the **Windows** PATH. npm runs every lifecycle script through `cmd.exe`, so
`prebuild-install || node-gyp rebuild` could not find node and the native addon was never built.

The stack trace named it in one frame — `openDatabase` at `lib/db/index.ts:24` — and the search
list it printed contained both halves of the answer: `compiled\24.12.0` (the Node version) and
`node-v137` (its ABI). No theory required.

Wrong turns worth recording, because each one cost a cycle:

- `npm rebuild better-sqlite3` printed **"rebuilt dependencies successfully" while doing nothing**.
  A success message is not evidence of work.
- Glob and Read both reported `node_modules/next/package.json` **absent** while Next was actively
  serving from it — those tools filter ignored paths. A file-tool miss is not evidence of absence.
- Four attempts assumed `npm ci` was atomic. It is not: reify and lifecycle scripts need different
  environments, and `--ignore-scripts` separates them. That should have been the second move.

The durable fix is the user PATH entry. The portable one is `node.exe` copied into
`node_modules/.bin/`, which every npm `.cmd` shim checks via `%~dp0\node.exe` **before** falling
back to PATH — but `npm ci` deletes it, so it must be re-copied after any clean install.

**Verified green:** typecheck clean · `next build` compiles all 64 routes · `build:mcp` bundles ·
**792 tests passing**, 2 skipped. `npm run check` cannot run as one command, because its `&&`
sub-shell cannot find `npm` either; the four steps pass individually.

**One failing test, by design:** `lib/governance/hooks.test.ts` asserts Bash is denied, which the
allowlist changed. It is a protected path — the replacement is written and awaiting the owner.

## 2026-08-07 · Performance — the dashboard's second round trip · DONE

`/dashboard` fanned out 20 quotes with `Promise.allSettled`, then **awaited news afterwards**.
News depends on nothing; it was simply queued behind the slow half, so every render paid two
serial network round trips. Both now start together. `/dashboard` was the only page with this
shape — every other page has a single top-level await or was already parallel.

---

## 2026-08-07 · The gauntlet gets a path from the application · DONE

**Why the funnel showed zero.** Not a data problem. `runGauntlet` was implemented and tested;
a route was added; and **nothing in the interface ever called it**. Five drafts and an empty
graveyard were not a measurement — they were the absence of one.

- `components/strategy/RunGauntletButton.tsx`, wired into the REGISTRY table on `/strategies`.
- **Two clicks, not one.** The action is irreversible: the trial counts against the strategy's
  *family*, so it permanently raises the bar for every future candidate in it. A single click on
  a table row is not consent to that. The confirmation states the cost in the route's own words,
  so the interface cannot promise less than the server charges.
- Refusals are reported by kind, not collapsed into "failed". `503 NO_DATA` in particular means
  no candles were available and **nothing was spent** — the opposite of a wasted trial.
- A burial renders as `BURIED`, not as an error. The system exists to bury its own ideas;
  phrasing that as failure would train the operator to avoid the button.
- Offered on every row including validated ones — hiding it would make the ledger look cheaper
  than it is.

**Also fixed:** `PLTR` and `CRM` were on the default watchlist but absent from
`lib/market/catalog.ts`, so `/analyze/PLTR` and `/analyze/CRM` resolved to nothing. A link that
invites the click and then fails is worse than no link.

**Verified:** typecheck clean · `next build` compiles all 64 routes · **794 of 795 tests pass**.
Three apparent failures in the full run were **timeouts, not assertions** — `hooks.test.ts` and
`rehearsal.test.ts` spawn subprocesses, and the import phase ran 446s under load against 374s
earlier. Re-run in isolation: 33/34 pass in 21s. The one real failure is the governance Bash test,
which awaits the owner.

---

## 2026-08-07 · Phase F — Kronos in the DSL, and the reason it stops there · DONE

`GOAL.md` Phase F asks for "forecast features usable in the DSL". Implemented as vocabulary plus
an authoring-time refusal, because ADR 0004 already contains the reason the obvious version is
wrong:

> A forecast file regenerated over history and read as though it had been available at each bar
> is lookahead of the purest kind.

The quant core publishes **one current forecast per instrument**, with a single `generatedAt` —
not one per historical bar. A backtest that read it at every bar would apply today's prediction
to last year's decisions. Crucially that failure **does not error**: it produces a spectacular
equity curve, which is far more dangerous than a missing feature.

- `forecast_return_1d` and `forecast_return_5d` added to `POINT_IN_TIME_FEATURES` and to
  `UNSUPPORTED_BY_ENGINE`. `UNAVAILABLE_FEATURES` is derived by subtraction, so the feature panel
  picked them up with no second edit and the partition test still holds.
- `compileStrategy` now emits **two distinct warnings**. "No source supplies this" and "the source
  exists but reading it historically would be lookahead" call for opposite actions, and one
  message covering both sends the author looking for the wrong thing.
- They become derivable when the quant core keeps a point-in-time forecast archive — one record
  per bar, each stamped with when it was actually generated. That is a bridge request, not a
  change here.

**Verified:** typecheck clean · 116 strategy/backtest tests pass · full suite **793 passing**.

### A test-suite fragility worth naming

`lib/governance/hooks.test.ts` spawns a node subprocess per assertion. It passes **21/21 in 19s
alone**, but under full-suite parallelism individual tests exceed the 5s default and report as
failures. `blocks the risk kernel…` was already doing this before this session; the new
allowlist test added a second heavy case to the same file.

These are **timeouts, not assertions** — a timeout claims the machine was slow, not that the code
is wrong. The file and `vitest.config.ts` are both owner-reviewed, so the fix (an explicit
`it(…, …, 30_000)` on the two heavy cases) needs the owner. Meanwhile `npx vitest run
lib/governance` is green and is already the documented way to run the guardrail suite.

---

## Next
- P2: spend the trial on `sma_cross_20_50` — the first validated result.
- Performance: `/dashboard` at 2095 ms, every page `force-dynamic`, nothing cached.
- The instrument decision — MNQ intraday futures (what the reel trades) versus NSE/US daily
  equities (what this is built for). They are different products; see the gap audit §1.
- Research-source graph, and ingestion that actually runs against named sources.
