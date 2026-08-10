# Graph delta log

The graph in this directory (`graph.json`, `graph.html`, `GRAPH_REPORT.md`) is a snapshot taken at
**2026-08-08 23:25–23:27**: 2,772 nodes, 6,079 edges, 463 files, ~318,589 words.

Regenerating it is expensive, so changes since the snapshot are recorded here with their times.
Each entry says what moved and which graph nodes it invalidates, so the snapshot stays usable
rather than quietly going stale.

---

## 2026-08-09 00:04 — Cost engine (`lib/paper/cost-model.ts`, `cost-model.test.ts`)

**New nodes, not in the snapshot.** Sits above `Paper Fee Engine` (an existing community hub).

Effective-dated fee schedules, round-trip cost, and the capital-viability verdict. Adds the one
charge `lib/paper/fees.ts` omits: Zerodha's **DP charge — ₹13.50 + 18% GST ≈ ₹15.93 per scrip per
day, flat**, on delivery sells only.

Why it matters: every other cost in the model is percentage-based and therefore size-neutral,
which is exactly why the omission was invisible. A flat charge does not scale down.

`feeSchedule(market, product, at)` **throws** rather than applying today's rates to a historical
date. Refusing is recoverable; a confident wrong cost is not.

## 2026-08-09 00:08 — Capital model (`lib/paper/capital.ts`, `capital.test.ts`)

**New nodes.** Bridges `Paper Fee Engine` → `Strategy Breeding` (two communities the snapshot
shows as unconnected).

The system previously had **no concept of the owner's capital anywhere**. `OWNER_CAPITAL` now
states it (₹1,000, stated 2026-08-08, carrying its date because the owner says it grows).

Derived, with the arithmetic in the tests:

| Position size | Round-trip cost |
|---|---|
| ₹100 | **16.150%** |
| ₹1,000 | 1.816% |
| ₹5,000 | 0.541% |
| ₹10,000 | 0.382% |
| ₹25,000 | 0.286% |
| ₹1,00,000 | 0.238% |
| ₹10,00,000 | 0.224% |

The floor never reaches zero because delivery STT is 0.1% on **both** legs — 0.2% before anything
else. Scaling up dilutes the flat charge, not the tax.

## 2026-08-09 00:08 — Breeding now derives its costs (`lib/factory/breed.ts`)

**Modifies an existing node** in the `Strategy Breeding` community.

`baseDsl` hardcoded `{ commissionBps: 3, slippageBps: 7 }` → 20 bps a round trip, alongside
`maxPositions: 10` and `maxPositionPct: 10`. Neither figure was ever checked against the account
that exists.

Now derived from `breedingBasis()`: **₹32,000 across 5 positions → 62 bps**. The old constant
understated real cost by **3.1×** at that size, and by **80×** at the ₹100 positions that
`maxPositions: 10` implied on a ₹1,000 account.

Every candidate the factory screened before this was optimised against a market cheaper than the
one it would trade in.

## 2026-08-09 00:08 — Two of the system's own rules found to collide

Not a code change — a fact the wiring exposed, recorded because it is the most consequential thing
in this log.

- `lib/strategy/dsl.ts:188` caps one position at **25%** of the book. A compliant portfolio
  therefore holds **at least 4** positions.
- The cost structure pushes the other way: fewer, larger positions.

At small capital these are jointly unsatisfiable. Four positions each large enough to clear the
0.5% cost bar gives a hard floor of **₹23,000** (`minimumTradableCapital`). Below it, no strategy
can be executed compliantly — regardless of how good the strategy is.

The first wiring attempt failed loudly here: with 1 viable position, `maxPositionPct` computed to
100 and the DSL schema rejected **every** bred candidate. That rejection was correct.

## 2026-08-09 00:27 — Intraday reopens small capital (`lib/paper/capital.ts`)

**Corrects the entry above.** ₹23,000 is the floor for *delivery*, not for trading.

Intraday incurs **no DP charge** — nothing leaves the demat account on a square-off — and STT is
0.025% sell-side only rather than 0.1% on both legs. Every remaining charge is proportional, so
the cost ratio is **flat at 0.106% from ₹500 to ₹60,000**, where delivery's curve bends.

What binds at ₹1,000 is therefore **share granularity, not cost**: `MIN_POSITION_VALUE = ₹500`
(stated, not derived — a smaller position cannot buy one share of most of the liquid NSE universe).
Four positions × ₹500 = **₹2,000**, one doubling from the owner's actual capital.

`viableConfiguration()` prefers delivery wherever affordable, because an intraday position is
squared off at a time the broker chooses — converting a temporary drawdown into a realised loss.
Intraday is what makes a small account tradable, not what one should prefer.

## 2026-08-09 00:43 — The research queue gets a mouth (`lib/research/producer.ts`)

**New node. Closes the loop** flagged in community 134 of the snapshot.

`enqueue()` was reachable only from `mcp/server.ts`, one API route, and a test. The cycle drained a
queue nothing autonomous ever filled. `produceResearchJobs()` discovers published work from arXiv
q-fin, resolves content before enqueueing (the worker throws without `title` and `content`, so a
bare URL would become a permanent dead end), and dedupes on the upstream id.

Wired into `runCycleBody` **before** `runWorker`, so work found in a pass is done in that pass.
Injectable, like the two existing loaders — the first version made `learning.test.ts` fetch five
live papers and report six processed jobs against the one it enqueued.

Verified end to end: *"Discovered 20 source(s): enqueued 5 … Processed 5 research job(s)"* →
15 knowledge sources, 18 claims, 3 hypotheses, with no human action.

## 2026-08-09 00:58 — Cost-aware promotion gate (`lib/strategy/cost-gate.ts`)

**New node**, wired into `evidenceFor` (`promotion.ts`) and `advanceStrategy` (`lifecycle.ts`).

A backtest is net of whatever cost its DSL declares, so a spec claiming 20 bps yields an honest
curve for a market that does not exist. The gauntlet cannot catch this — it asks whether the edge
survives resampling *given* the stated cost, never whether the stated cost is real. Neither does
the holdout or the ladder.

The gate blocks at **every** rung, not just the first: a strategy already at `validated` was
measured the same wrong way. `undefined` is deliberately not treated as `true` — a caller that
never computed the standing must not have strategies blocked by a check nobody ran.

Live effect: three strategies with evidence now held at `draft` — *"assumes 20 bps a round trip;
the owner's capital costs 24 bps"*.

## 2026-08-09 01:09 — Navigation was already built (`lib/nav-coverage.test.ts`)

**Correction.** An earlier session note claimed "26 pages, 1 linked, no NAV array". Wrong:
`lib/nav.ts` has two workspaces, 13 linked views, 12 `LEGACY_ROUTES`, and 17 passing tests.

What was genuinely missing is a guard that *every page is reachable* — `nav.test.ts` checks the nav
is well-formed, which a well-formed nav omitting a page still passes. The new file walks `app/`
instead of the nav, and also asserts no legacy route points at an unlinked destination and no nav
link points at a missing page.

## 2026-08-09 01:15 — Paper account was 10,000× the owner's capital

The INR paper account was seeded at **₹1,00,00,000** against a stated ₹1,000. At a crore, costs
round to nothing — the one regime the owner is not in — so every paper result answered a question
about somebody else's account. The same class of error as the hardcoded 20 bps: a plausible default
nobody checked against the account that exists.

Reset to ₹1,000 (`scripts/set-paper-capital.mts`). Safe: the account had zero orders, ledger rows
and positions, so no history was lost. The script **refuses** to rewrite `startingCash` on an
account that has traded, because every drawdown and utilisation figure is derived from it.

A cycle check now reports any drift, since a reseed or restored backup would put it back.

## 2026-08-09 01:55 — **The bug that made the whole ladder inert** (`promotion.ts`, `0007_rehearsal_outcomes.sql`)

**The most consequential finding in this session, and it was invisible to every passing test.**

`advanceStrategy`'s `draft` rung handles all four rehearsal verdicts — `would_pass`, `would_fail`,
`not_evaluable`, `rediscovered`. It was written to be driven by the rehearsal. But `evidenceFor`
derived `rehearsalVerdict` from `validation_results`, which **only the gauntlet writes**:

```ts
rehearsalVerdict: rediscovered ? "rediscovered" : latest ? "would_pass" : undefined,
```

`runValidationRehearsal` returns `recordedNothing: true` and persists nothing. So the value was
permanently `undefined`, and **no strategy could ever leave `draft` autonomously** — a human had
to spend a gauntlet trial first. The rehearsal ran every fifteen minutes, produced a real verdict,
and threw it away.

Found by reading the live UI, not by a test: the Strategy Lab funnel said **REHEARSED 5** while
every row in the registry said **"Not yet rehearsed."** Two numbers on one screen contradicting
each other. Every unit test passed throughout.

Fixed with a new table, persistence in the cycle, and `evidenceFor` reading it. Verified:
`draft → rehearsed`, then correctly held at `gauntlet` because a trial is deliberate.

## 2026-08-09 02:05 — Transient outages no longer overwrite verdicts

Introduced by the fix above and caught immediately: a provider outage makes every candidate report
`not_evaluable`, which would then be persisted over a real `would_pass`. A network blip would read
as a permanent deployment gap.

`NO_DATA_REASON` is now exported from `rehearsal.ts` and the cycle skips persisting that specific
verdict, leaving the previous one standing and reporting the outage instead. A feature gap
("no engine derives `market_cap`") is durable and *is* persisted; a data outage is not.

## 2026-08-09 02:10 — The cycle fetched the same bars twice

`loadEvidence` pulls the US daily sample for the quant-core pass; the rehearsal's own
`marketCandleLoader` then pulled the identical twelve series seconds later. Two provider calls per
cycle for the same data — and the second is what rate-limits, producing the self-inflicted outage
above. Measured directly: `fetchMarketSample("US","D")` returned **1 of 12** instruments after
repeated runs.

The rehearsal now reuses `evidence.dataset`. Halves provider load per cycle, and stops the
artifacts and the rehearsal straddling a bar close and disagreeing about the last bar.

## 2026-08-09 02:36 — The engines became visible (`CostViabilityPanel`, `ForecastValidationPanel`)

The owner's central complaint, and it was correct: five modules with full test coverage and **not
one of them reachable from any screen**. A probe of the rendered DOM found `capital: 0`,
`Kronos: 0`, `intraday: 0`, `DP charge: 0`.

- `/paper` → **COST & CAPITAL VIABILITY**: the ladder from ₹1,000 (refused) through ₹2,000
  (intraday) to ₹23,000 (delivery), the live break-even edge, and a warning when the paper account
  disagrees with the owner's stated capital.
- `/data-quality` → **FORECAST VALIDATION — LIVE**: 15 predictions in flight, 60 bars against the
  30 the gate needs, oldest prediction date, and the in-flight table.

Verified through Playwright against the running server, not through a test asserting a component
renders. All 11 routes return 200 with zero console errors.

## 2026-08-09 07:50 — **India was absent from the entire autonomous loop**

The second structural finding, and the one that most affects the owner.

The catalog holds **30 Indian instruments against 22 American ones**. The owner trades NSE, in
rupees, through Zerodha, at ₹1,000. Every autonomous path defaulted to the United States:

| Location | Effect |
|---|---|
| `cycle.ts:162` — `fetchMarketSample("US","D")` | Evidence, artifacts, rehearsal and trade board all US |
| `breed.ts:229` — `input.market ?? "US"` | The factory bred American strategies |
| `generate.ts:276` — `options.market ?? "US"` | Quant core handed a US universe |

India data was never the problem — measured directly, `fetchMarketSample("IN","D")` returns 12
instruments and 741 bars for RELIANCE. The loop simply never asked.

Fixed: `marketEvidence` now fetches both markets into one merged dataset (ids are market-prefixed,
so keys cannot collide), with a per-market regime proxy — NIFTYBEES for India, QQQ for the US.
Reading a NIFTY regime off the Nasdaq is not a regime read.

**A trap worth recording:** `OWNER_CAPITAL.market` is a *country* (`IN`), while the DSL's
`universe.market` is an *exchange* (`US` | `NSE` | `BSE`). Passing `"IN"` straight through failed
every candidate against the schema and `breedGeneration` returned an empty population — the
factory looked like it had simply found nothing. Translated at the boundary now.

Measured before and after, same cycle:

```
before:  Would survive: sma_cross_20_50 (90 trades / 12 instruments)   0 past draft
after:   Would survive: sma_cross_20_50 (165 trades / 24 instruments)  2 past draft
```

## 2026-08-09 07:56 — Self-repair, and the line it holds (`lib/learning/self-repair.ts`)

Runs each cycle at `learning` and above. The refusal matters more than the repairs:

> **Repair only what is provably a defect against an external fact. Report everything that is a
> judgement.**

- **Repaired:** a strategy declaring less round-trip cost than the published schedule charges.
  Wrong by arithmetic, against rates this system did not invent, and no reading of the evidence
  makes it correct. Verified end to end — a spec was deliberately set to 4 bps and the next cycle
  reported *"Declared cost raised from 4 to 24 bps"*, with an `auditEvents` row to match.
- **Reported, never repaired:** the paper account disagreeing with `OWNER_CAPITAL`. Equally wrong,
  but which figure is current is a fact about the owner's intent that nothing here can read. A
  loop that rewrites either has decided how much money they have.
- **Never automated:** deleting the validation rows a repair invalidates. Evidence destroyed on a
  schedule cannot be reviewed before it goes; the stale rows are reported for the owner to clear.

Every repair is written through `recordAudit` with both figures, because a write the owner did not
ask for must be answerable with what, when and why. An unlogged self-repair is indistinguishable
from a bug.

## 2026-08-09 09:31 — **The intraday ceiling is removed** (`lib/market/intraday-accumulator.ts`)

The constraint was stated exactly right in `lib/learning/dataset.ts`, and its conclusion was wrong:

> Yahoo serves roughly sixty days at 1-minute resolution, which is not enough bars to validate an
> intraday strategy — **and no amount of waiting fixes it, because the window slides.**

True of any single fetch. False the moment something *keeps* what falls off the back. Fetch the
window daily and persist it, and the store outgrows the provider's window within a quarter —
history assembled rather than purchased, entirely inside the owner's "free, live-fetched only"
constraint.

Every piece already existed: `price_candles`, `persistCandles` (idempotent on
`ticker + resolution + time`), `loadStoredCandles`, and a reader that already prefers stored bars
over the live feed. **Nothing accumulated.**

**First run kept 4,282 settled NSE intraday bars** across 12 instruments × 3 resolutions.

Two safety properties, both tested:

- **Only settled bars.** Not merely the forming bar — the entire current session. A session can be
  halted, extended, or revised after the close, and a mid-session bar later corrected upstream
  becomes a permanent disagreement inside the store that nothing reconciles. `SETTLE_SECONDS` is
  26 hours, measured from a bar's **close**, not its open.
- **This is not a live-feed cache.** `candle-store.ts` warns that persisting the live feed "would
  create a second source of truth about the present". Correct, and this does not: a five-minute
  bar from two sessions ago is settled history that no later fetch will contradict.

## 2026-08-09 09:36 — …and the load problem it immediately created

Caught by reasoning about the cycle rather than by a test: 12 instruments × 3 resolutions is **36
requests**, and the cycle runs every fifteen minutes — 96 passes a day to discover nothing new has
settled. That is exactly the load that rate-limited the feed earlier and made the rehearsal report
"No stored candles" for a market whose data was fine.

`accumulationDue()` gates it to once per 20 hours via an `audit_events` marker. A bar settles once
a session; so does the accumulator. An unreadable marker returns *due* — silently ceasing to
accumulate is worse than one extra pass.

Surfaced at `/data-quality` → **INTRADAY HISTORY — ACCUMULATED**, which is deliberately honest
about not yet being useful: 36 series, 4,282 bars, 30-day span, `beyond provider: 0`, "still
within the live window". It becomes unobtainable-elsewhere history at day 60.

## 2026-08-09 09:46 — Graph rebuild found a literal NUL byte in source (`candle-store.ts`)

AST extraction over 353 source files reported one syntax error, and it was real:

```
lib/market/candle-store.ts:59   `${candle.ticker}<NUL>${candle.resolution}`
```

Three template literals contained a **literal 0x00 byte** as a key separator. The choice is sound —
a NUL cannot occur in a ticker or resolution, so the dedupe key can never collide the way a space
or colon could — and all three sites used it consistently, so `persistCandles` was correct.

The cost was in tooling, and it was already being paid:

- `grep` classified the file as **binary**, so `grep -n "export function"` returned
  `Binary file matches` and nothing else. This was hit during this session and worked around
  without asking why.
- The AST parser failed on it, so `candle-store.ts` was **partially extracted** into the graph —
  its symbols and edges were incomplete in every prior analysis.
- It is invisible in an editor, so any hand-edit could silently drop or duplicate it.

Replaced with the ` ` escape: byte-identical at runtime, so existing stored keys still match
and no migration is needed, while the file is now pure ASCII. `grep` works; AST parses clean.

## 2026-08-09 09:48 — Two dead paths the graph surfaced

Neither is a live hole. Both are recorded because their *code* claims a capability the project says
does not exist, which is a hazard for whoever reads them next.

**`app/api/agent/robinhood/{heartbeat,portfolio}/route.ts`** — `CLAUDE.md` states plainly there is
"no Robinhood path". The routes still exist. They are genuinely neutered — `GET` returns
`{broker: null, snapshot: null}` and mutations return 503 `EXECUTION_ADAPTER_MISSING` — but their
comments still describe the removed behaviour ("The agent pushes the Agentic account's portfolio
here after reading it from the Robinhood MCP"). A reader would reasonably conclude the path works.

**`lib/trading/telegram.ts`** — 116 lines, **zero inbound references anywhere in the repo**. It
implements `sendTelegram()` (outbound POST to `api.telegram.org`), `approveRejectButtons(orderId)`,
and `drainTelegramDecisions()`, which reads approve/reject callbacks from Telegram. That is an
**order-approval channel operated from outside the app**, in a system whose stated design is that
orders are placed manually by the owner and that only an authenticated owner session may approve
anything. Dead today; wiring it up later would create an approval path that bypasses owner auth
entirely. Deleting it is the owner's call, not a self-repair.

**Note on `graph.json`:** this pass ran AST-only (no semantic subagents, by request), producing 2,346
nodes against the stored graph's 2,963. graphify's guard refused to overwrite the richer graph with
the thinner one — correctly — so `graph.json` remains the 2026-08-08 semantic build. The AST
analysis above was run against fresh extraction without clobbering it.

## 2026-08-09 10:18 — **The e2e suite had never run** (`playwright.config.ts`, `e2e/engines.spec.ts`)

Two blockers, either of which alone made it impossible:

1. `webServer` shells out to `npm run dev`; Playwright's spawn shell on this machine has no `npm`
   on PATH — `'npm' is not recognized`, before a single test executed.
2. The Chromium binaries were never downloaded — `Executable doesn't exist at
   D:\playwright-browsers\...`.

So the six existing tests had produced no signal, ever. An e2e suite that cannot start is worse
than none: it looks like coverage while asserting nothing, which is how UI regressions reach a
screen with a green run behind them.

Fixed by adding `MARKETPULSE_E2E_BASE_URL`, which points the suite at an already-running server and
omits the `webServer` block entirely when set.

**`e2e/engines.spec.ts` — 10 tests asserting meaning, not presence.** Every defect this session was
individually-correct code that was not wired up; none was reachable by a unit test. These assert
computed figures (`0.106%`, `refused`, `NONE / below every floor`), honest empty states, that every
ladder stage carries a reason, that every nav link resolves in the browser, and that both refusal
layers hold.

Four of the ten failed first — all four were **my** test bugs, not app bugs, and each is worth
recording:

- Assertions on `BEYOND PROVIDER` / `STAGE` matched the *styled* text; `innerText` returns
  "Beyond provider" because the uppercase is CSS. Asserting the styled form tests the stylesheet.
- Two tests called `page.evaluate(fetch("/api/..."))` **before** navigating, so the page was
  `about:blank` with no base URL. "Failed to parse URL" would have read as a passing refusal.
- `/api/trade/place` refuses at the **CSRF layer** before reaching the execution check. A bare POST
  proves nothing about whether orders can be placed. The test now sends
  `x-marketpulse-csrf: 1` and asserts both layers separately.

Two pre-existing tests (`AI desk`, `paper order`) require `MARKETPULSE_TEST_MODE` fixtures the
managed server installs. Against an external server they now **skip with a stated reason** rather
than fail — an assertion loosened until it passes in both environments would stop testing the
fixture path in either.

## 2026-08-09 09:56 — `lib/trading/telegram.ts` deleted

116 lines, zero inbound references, implementing an order approve/reject channel operated from
Telegram in a system where only an authenticated owner session may approve anything. Removed on the
owner's instruction. No references remained anywhere after deletion.

---

## Method note — why the tests did not catch these

Every defect above passed the entire unit suite. Tests proved each module behaves correctly in
isolation; they could not prove the modules were *connected*, or that anything reached a screen.
The ladder bug in particular was two contradicting numbers rendered side by side — visible in
three seconds of looking, invisible to 1,100 passing assertions.

---

## Corrections to earlier findings in `GRAPH_REPORT.md`

The snapshot's community 134 lists four claims about the autonomy loop. Two were re-checked
against the machine on 2026-08-09 and only partly hold:

- ✅ *"Windows Task Scheduler 'Market Pulse Cycle' registered and Ready"* — **confirmed.**
  `LastTaskResult: 0`, `NumberOfMissedRuns: 0`, running every 15 minutes. An earlier session note
  claiming the task was never registered was wrong.
- ⚠️ *"research_jobs always 0: the queue has no mouth"* — **half right.** The queue has a working
  consumer (`lib/research/worker.ts` → `claimNextJob`, reachable from the cycle and from
  `POST /api/research/worker`). What it lacks is an autonomous **producer**: `enqueue()` is called
  only by `mcp/server.ts`, `app/api/research/jobs/route.ts`, and a test. The loop drains a queue
  that only a human or an agent fills by hand.

## Still absent from disk

- **Kronos weights.** Searched `~/.cache/huggingface` (does not exist), `Downloads`, all of `E:`,
  and the user profile to depth 6: no `*.safetensors`, no `NeoQuasar`, nothing named Kronos
  outside this repo's own `docs/` and `lib/forecast/kronos.ts`. The `kronos-test-*` directories in
  `%TEMP%` are this repo's test fixtures. Python 3.11.15 and torch 2.12.1+cpu **are** installed,
  so the runner could execute — the checkpoint is what is missing.
- **`QUANT_CORE_ROOT`** defaults to `E:/Trading_BOT`, which does not exist. `docs/KRONOS_RUNNER.md`
  expects forecasts at `<QUANT_CORE_ROOT>/data/forecasts/kronos/`. Both the model and its output
  directory are absent, so this is two gaps, not one.
