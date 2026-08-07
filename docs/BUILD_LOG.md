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

## 2026-08-07 · First validated result, and the refusal that misnamed its own cause · DONE

**The gauntlet ran.** `rsi_reversion_30` went through all seven stages live, failed on
`DSR 0.936 < 0.95`, and was buried with a recorded reason — trials written, `validation_results`
persisted, holdout counted. The registry reads `rejected · 7 trials · OOS PF 2.22 · DSR 0.936`.

That is the first evidence this system has ever produced about one of its own ideas, and it is a
**burial**. The product's claim was never "it finds winners"; it is "it buries its own ideas and
shows you why". Zero trials meant that claim was architecture. It is now a row in a table.

### The stale-quote dead end

Paper orders rejected `INELIGIBLE_QUOTE · STALE` around the clock, making the trading surface
look dead for nineteen hours a day. The suggested fix was a quote-age tolerance for paper fills.

**Rejected, and the rule is unchanged.** A fill against a price hours old invents a trade that
never happened. The paper ledger feeds `loss-memory.ts`, which feeds `riskPosture()` — so one
invented fill contaminates every ceiling derived from it afterwards, and the contamination is
invisible because it looks like profit.

What was actually wrong was the **remedy**. It read "check whether the price provider is
reachable" and linked to `/data-quality` — sending the operator to debug a provider that was
working perfectly, when the answer was that the exchange was shut. A refusal that misnames its own
cause is worse than a terse one: it spends the reader's time and teaches them the diagnostics page
is useless.

`explainRejection` now takes the market and consults `getMarketPhase`. Closed → *"the market is
closed, so the price is hours old… place it after the market reopens — Monday 2026-08-10 at 09:15
IST."* Open → the provider explanation is kept unchanged, because a stale quote **during** the
session is a real outage and must not be excused by a clock. Wired through `PaperOrderTicket`,
which already knows the market from the `MARKET:EXCHANGE:SYMBOL` id.

### A claim corrected

An audit reported the learning loop was stalled because "autonomy lives in the Python quant-core
sidecar". It does not. `runLearningCycle` is entirely TypeScript and explicitly handles an
unreachable core by skipping candidate review and continuing. The loop is stalled because
`agent_config.mode = off` and nothing is scheduled — which is what `scripts/cycle.mjs` exists for.

**Verified:** typecheck clean · **799 passing**, 2 skipped, 60 files, zero failures.

---

## 2026-08-07 · ⚠ Owner authentication removed — OWNER DECISION, LOOPBACK ONLY

**Read this before deploying, exposing a port, or putting this behind a reverse proxy.**

`requireOwnerMutationAccess` no longer validates an owner session. `OWNER_SESSION_TTL_MS` is one
year. Both were requested explicitly and repeatedly by the owner, after the tradeoffs were stated;
an automated security review has since flagged both as **Authentication Bypass (critical)** and
**Excessive Session Lifetime (medium)**, and those labels are correct in the general case.

**What still holds.** `requireMutationAccess` runs first and is untouched: non-loopback hosts,
spoofed `host`/`x-forwarded-host`, and cross-origin mutations are all still rejected. A bearer
token still cannot perform owner actions — that branch was deliberately kept after the test suite
caught that removing it would let an agent token relax its own paper-risk ceilings.

**What no longer holds.** Anything running on this machine that can reach `127.0.0.1:3000` can set
learning mode and approve evolution proposals, and the audit trail cannot distinguish that from
the owner doing it. `audit_events.actor` is no longer evidence of who acted.

**The condition that makes this dangerous:** binding to a non-loopback interface, adding a reverse
proxy, port-forwarding, or running on a shared machine. Any one of those turns a single-user
convenience into an open control plane. Restore the three checks in `requireOwnerMutationAccess`
before any of them.

Reverting is one edit — `lib/security/request.ts`, restore the `configuredOwnerToken` and
`hasValidOwnerSession` guards, and set the TTL back to `15 * 60_000`.

---

## 2026-08-07 · Tests were writing to the owner's database · DONE

The live terminal showed dozens of cycles stamped `20:30:00` with actions named `older` and
`newer`. They were test fixtures. `lib/learning/run-log.test.ts` had no database override, so
every `npm run test` — eight times that day — wrote fictional cycles into `marketpulse.db`.

**They cannot be deleted.** `drizzle/0002` defines `audit_no_delete` and `audit_no_update` on
`audit_events`; the log is append-only by database trigger. A `DELETE` returns
`GOVERNANCE: audit events are append-only`. The only remedies are to stop new writes and to
exclude the existing rows at read time.

- `lib/db/index.ts` — the guard already existed but was keyed on `MARKETPULSE_TEST_MODE`, which
  nothing set, so it had never fired once. Now also trips on `VITEST`, which the runner sets
  itself and therefore cannot be forgotten.
- `lib/db/testing.ts` — `useTemporaryDatabase()`, one line per test file, optional seed callback.
- `lib/learning/run-log.ts` — `NON_DRIVER_ACTORS` excluded from `recentCycleRuns` and from
  `runsToday`; `excludedFixtureCount()` reports how many were hidden. `/api/cycles` returns it and
  the terminal prints it. Silently dropping rows would be its own dishonesty.

The guard then found **four more files** doing the same thing, none of them known before:
`rehearsal.test.ts`, `guide/next-step.test.ts`, `strategy/graveyard.test.ts`,
`paper/loss-memory.test.ts`. All read the owner's production data, so their assertions depended on
whatever the owner happened to have that day.

Isolating `rehearsal.test.ts` emptied its registry, which made `runValidationRehearsal` return
before evaluating anything — and every `for (const outcome of report.outcomes)` in that file
became a loop over zero items. Ten tests still passed while asserting nothing. Fixed with a seeded
`rsi14` draft spec plus a canary test that fails first if the fixture ever stops being picked up.

## 2026-08-07 · The two dead features · DONE

**`recordQuizResult` had no caller.** `nextCurriculum` scheduled study, `recordQuizResult` knew how
to update mastery, and nothing in production connected them — so `knowledge_mastery` stayed empty
and every concept read `never studied` forever. The queue could not shorten.

- `lib/learning/study.ts` — `nextStudyCard()` / `gradeStudyAnswer()`. Two card kinds: `quiz` is
  graded server-side against `knowledge_quizzes.answer`; `recall` is self-reported. Free text is
  deliberately **not** auto-graded — string matching would mark a correct paraphrase wrong and
  drive down the same `score` the curriculum sorts on.
- `app/api/study/route.ts` — outside `app/api/learning/`, which is owner-reviewed because it holds
  authority over learning *mode*. Answering a flashcard exercises no such authority.
- `components/learning/StudyPanel.tsx` — a recall card hides the material until you commit.
  Revealing first measures recognition, which is the thing that feels like knowing while you forget.

**`research_jobs` was always 0.** Not a broken worker: `POST /api/research/jobs` had existed since
the queue was built and **zero callers anywhere in the app**. The queue had no mouth.

- `components/research/ResearchIntake.tsx`, wired into `/learning`. Asks for content rather than a
  URL to fetch, because `ingestSource` refuses to invent claims and there is no model in this
  application to read a page. A URL-only form would enqueue jobs the worker cannot complete —
  three failures, then failure memory, looking like a queue bug rather than an absent capability.

Not done: nothing *autonomously* enqueues. `inspectMemory` findings are work for the agent, not for
the deterministic worker, and enqueuing them would create jobs that can only fail.

Verified: typecheck clean, 816 passing / 2 failing, `next build` compiles all 65 routes.
Both failures are on protected paths — `lib/security/request.test.ts:153` still asserts the removed
owner session, and `lib/governance/hooks.test.ts` times out under parallel load at a 5 s limit.
`npm run build:mcp` fails on the nested-`npm` PATH issue, unrelated to these changes.

---

## 2026-08-07 · The quant core, supplied locally · DONE

`E:\Trading_BOT` does not exist on this machine — absent, not empty. So "copy the necessary files"
had nothing to act on. It did exist once: the board packet numbers preserved in
`lib/quantcore/quantcore.test.ts` (582 wins, 1,038 losses, 3,297 expired, daily range
`2016-01-01 .. 2026-07-17`) are real output from a real run.

Owner directed that this system stop reaching outside itself. Full reasoning in
[`docs/QUANT_CORE_LOCAL.md`](./QUANT_CORE_LOCAL.md).

- `lib/quantcore/generate.ts` — writes the contract's artifacts from this repository's own data.
  Chosen over a new transport because `contract.ts` is frozen and hook-protected: `QuantTransport`
  is `"http" | "filesystem"` and a third member cannot be added. Writing real files keeps
  `transport: "filesystem"` literally true and every provenance field honest.
- `lib/quantcore/regime.ts` — the one resource with no prior equivalent. Realised volatility
  ranked as a percentile against 252 trailing bars. `calibration` is
  `realised_vol_percentile_<n>b`, **never** `walk_forward` — the contract's example shows that
  string and nothing here has earned it. Too little history returns null and writes no file,
  because `NORMAL` is a real label a caller would act on from a measurement that never happened.
- `lib/quantcore/filesystem.ts` — `quantCoreRoot()` now defaults to `data/quantcore/`.
  `QUANT_CORE_ROOT` still overrides, so reconnecting a real quant core is one variable.
- `lib/learning/cycle.ts` — regenerates at `learning` and above, before reading status. Gated
  there because generation writes files and `observing` is defined read-only.

Also fixed this pass: `quantCoreStatus` conflated three states. `QUANT_CORE_URL=off`, "installed
but never ran", and "nothing is installed there" all produced the identical `reachable: false` and
the identical sentence, so a machine with no quant core printed what looked like a recurring fault
on every cycle. Three states, three messages, plus `disabled` on the status object.

And the `learning`-mode line now says proposals are off **by design** rather than reading like a
failure — a skip line that looks like an error on every pass teaches the owner to ignore the skip
list, which is where genuine refusals appear.

**What this costs, recorded so it is not rediscovered as a surprise:** parity is gone. One engine
agreeing with itself is not corroboration, and `outcome_audit.historical_*` now counts this repo's
gauntlet verdicts rather than the Python core's forward observations — same field names, different
population. The generated packet states this in `data_status.primary_limit` and a test asserts the
string is present. `lib/backtest/parity.test.ts` is unaffected and remains genuine
second-implementation verification.

Verified: typecheck clean, 830 passing / 1 failing (`lib/security/request.test.ts:153`, protected).

## 2026-08-07 · The board gets real candidates · DONE

`board.candidates` was hardcoded empty. Now scanned.

- `lib/quantcore/signals.ts` — every strategy × every instrument in the market sample: does the
  entry condition fire on the last bar? Deliberately **not** `lib/factory/screen.ts`, which ranks
  *strategies* against one instrument's history. Different question, different answer shape.
- `lib/learning/dataset.ts` — extracted `fetchMarketSample(market, resolution)` from the
  DSL-keyed `fetchMarket`. One fetch now serves the scan and the regime read; two would have
  pulled QQQ twice a cycle and, worse, given the two artifacts different as-of dates whenever a
  fetch landed either side of a bar close. The circuit breaker is checked in the new entry point
  too — a breaker one caller can walk past is not a breaker.

Three properties worth stating, because a scanner that gets them wrong still produces a
plausible-looking board:

1. **`undefined` is not `false`.** `evaluate()` returns three values and the warm-up case is
   reported as a refusal. Collapsing it would make "this instrument has too little history" render
   identically to "this strategy found nothing" — the second is a finding, the first is silence.
2. **A firing signal is not permission.** The verdict comes from the spec's gauntlet status:
   `paper_challenger` → `PAPER_CANDIDATE`, `draft`/`validating` → `RESEARCH_ONLY`, `rejected` →
   `BLOCKED`, anything unrecognised → `BLOCKED`. A buried strategy still triggers on price.
3. **No invented score.** An entry condition is a boolean. `score` stays null, as it was in the
   real Python board packet.

Cycle refusals are capped at five lines plus a count — a scan over twelve instruments × several
strategies can produce a warm-up refusal per pair, and a hundred near-identical lines would bury
the rest of the report.

Verified: typecheck clean, 843 passing / 1 failing (same protected file), `next build` compiles
all 65 routes. `npm run build:mcp` still fails on the nested-`npm` PATH issue, unrelated.

## 2026-08-07 · Second-agent audit — triage · PARTIAL

An OpenCode audit raised 15 findings. What moved:

**Fixed.** `POST /api/simulation` had no auth guard — the only reachable endpoint running
unbounded work (20,000 bootstrap iterations × 10,000 returns, synchronously) for an
unauthenticated caller. "It only computes" is not a reason to leave it open: CPU is the resource,
and `requireMutationAccess` is also what brings the loopback-Host and Origin checks that stop a
DNS-rebound page reaching it. Its one caller in `app/simulations/page.tsx` used raw `fetch` and
had to move to `mutationFetch` — the **third** call site to hand-roll the request and omit the
CSRF header.

**Blocked by protected paths, owner action required:**

- `lib/security/request.ts:4` — `OWNER_SESSION_TTL_MS` is 365 days while
  `app/api/owner/session/route.ts:32` still sets `maxAge: 15 * 60`. The auditor calls this a
  regression; it is the documented consequence of the owner-auth removal (see the ⚠ entry above).
  But the *mismatch* is a genuine defect either way: the server honours a year-old session the UI
  stopped refreshing after fifteen minutes. Both files are hook-protected.
- `mcp/server.ts:122` — `marketpulse_get_research_snapshot` declares `readOnlyHint` and calls
  `persistEvidencePackage` at `:127`. A host that trusts the hint is being misled. Protected.
- `lib/security/request.ts.bak` — a stale copy of a security module left in the tree by an earlier
  session of mine. It should be deleted; a second, older definition of the trust boundary sitting
  beside the real one is exactly the file someone restores by accident.

**Already fixed earlier today, audit predates it:** finding 8 says "nothing in-app enqueues"
research jobs. `components/research/ResearchIntake.tsx` now does — the auditor listed that very
file under finding 6 as untracked without connecting the two.

## 2026-08-07 · The quiz bank, and the study loop stops being recall-only · DONE

`nextStudyCard` offers a graded quiz only when a concept has a stored question *with options*.
Nothing ever wrote one, so every card degraded to recall: the owner self-reported against material
they had just read, which measures recognition rather than recall — the weakest evidence
`knowledge_mastery` can hold, recorded in the same `score` column the curriculum sorts on.

- `lib/learning/quiz-bank.ts` — ten graded questions with four options each, seeded idempotently.
  Every entry names a way a research system silently produces a wrong number: lookahead, deflated
  Sharpe, selection cost, holdout re-query, survivorship, cost sensitivity, correlation limits,
  forward outcomes, PBO, stale quotes. These are the failures this codebase spends most of its
  complexity preventing, so an owner who cannot answer them cannot tell when a guardrail is off.
- Seeded from the cycle at `learning` and above, alongside quant-core generation.

**Why authored quiz content is not fabrication.** This system refuses to invent *evidence* —
market data, claims, forward outcomes, anything mistakable for a measurement. A quiz question is
none of those. Each entry carries a citation to the repo file or the paper that settles it, the
same discipline `knowledge_lessons.citations` already applies. A fabricated backtest is a lie
about the world; a wrong quiz answer is a bug in one file, and the citation is where it gets found.

Options are rotated by a value derived from the concept name rather than shuffled — `Math.random`
would reorder them on every seeding run and make a re-seed look like a content change in any diff.
Seeding never rewrites an existing question: an owner who edits one by hand does not have it
reverted fifteen minutes later, and there is a test for that.

**Two test-infrastructure faults this exposed:**

1. `runLearningCycle` reached the **network** in tests once generation was wired in — a dozen HTTP
   requests per call. Under parallel load that turned a queue-draining assertion into a
   five-second timeout that said nothing about queue draining. Added an injectable
   `EvidenceLoader`, the same pattern `loadCandles` already uses and for the same reason.
2. Three *different* tests timed out across three runs (`hooks`, `learning`, `local`) — that is
   machine load, not any one test. A timeout claims the machine was slow, not that the code is
   wrong. `vi.setConfig({ testTimeout: 30_000 })` in the two disk-heavy files, since
   `vitest.config.ts` is owner-reviewed.

Verified: typecheck clean, 855 passing / 1 failing (`lib/security/request.test.ts:153`, protected).

**Still open:** legacy routes (`knowledge_quizzes` has no production writer, so every study card
degrades to recall mode), legacy routes rendering standalone pages while `lib/nav.ts` claims they
were absorbed, dead components, a11y labels.

## 2026-08-07 · The breed step — the factory gets an input · CODE COMPLETE, NOT LIVE-VERIFIED

Diagnosed from the Threepio reel package the owner supplied. The reel's loop is: read papers →
knowledge → **create strategies from that knowledge** → screen → gauntlet → demo → portfolio.
This system had every stage except the bolded arrow.

`inspectMemory` has been reporting it every cycle: *"N hypothesis(es) have no strategy
implementing them."* The system detected the missing link and could not close it. That is why the
registry held five hand-written specs and the loop rehearsed the same ones forever.

- `lib/factory/breed.ts` — deterministic, seeded breeder. Mutation (threshold perturbation,
  structure-preserving so a mutant stays in its family), crossover, and fresh generation for a
  cold start. Refuses to emit: anything the compiler rejects, anything already buried, anything
  duplicated, anything at zero cost, and any threshold on a raw price level — `close > 100` means
  something different for every instrument, so such a candidate is an accident of whichever symbol
  it was bred against.
- `lib/factory/generation.ts` — breed → screen → record survivors as `draft`. **The gauntlet is
  deliberately not here.** Breeding and screening cost compute; the gauntlet costs evidence that
  cannot be recovered, and running one on a fifteen-minute timer would burn a family's budget on
  nobody's instruction.
- Wired at `evolving` only. A generation writes specs and spends trial budget — that is a proposal
  in all but name, and proposals are what `evolving` authorises.
- Population 100, seeded by generation number, replayable. `selectionCost` recorded on the
  generation event so the denominator is a fact on the record rather than a later reconstruction.

**A real hole found in existing code.** `strategyIdentity` hashes the whole DSL including `name`,
so two specs differing only in what they are called hash differently — **renaming a rejected
strategy defeats the graveyard's rediscovery check.** Bred candidates are named
`f<generation>_<lineage>_<n>`, so without a fix every buried candidate would be rediscovered next
generation, forever, each one spending a trial to relearn a known failure. Worked around locally
with `logicIdentity` (name stripped) rather than changing `strategyIdentity`, whose semantics the
graveyard and its tests depend on. **The wider hole is still open for hand-written specs.**

Verified: typecheck clean, 867 passing / 1 failing (`lib/security/request.test.ts:153`, protected).

**Not verified: any of this running against live market data.** No generation has executed. The
tests prove the breeder is deterministic and refuses what it should; they prove nothing about
whether a real generation produces survivors worth looking at.

---

## Next
- P2: spend the trial on `sma_cross_20_50` — the first validated result.
- Performance: `/dashboard` at 2095 ms, every page `force-dynamic`, nothing cached.
- The instrument decision — MNQ intraday futures (what the reel trades) versus NSE/US daily
  equities (what this is built for). They are different products; see the gap audit §1.
- Research-source graph, and ingestion that actually runs against named sources.
