# Plan — backtest hardening, then India + USA pre-market

Written 2026-08-06. Supersedes nothing; complements `docs/MASTER_ARCHITECTURE.md` §7 and
`docs/AUDIT_TRIAGE_2026-08-06_DELTA.md`.

## Context

Three changes were implemented earlier today against the delta-audit triage — gauntlet
significance, crossover/crossunder DSL operators, and a PBO slice guard — and **none of them
have been compiled or tested**, because no shell is available in this session. Verifying by
reading found one real defect I introduced, plus a latent performance problem the change made
load-bearing.

Phase A closes that. Phase B then builds the pre-market capability that was the headline ask:
proper pre-market analysis for India and the USA.

---

## Phase A — fix and verify the backtest stack

Nothing new is built until this is green. Stacking features on an unverified base is how the
first audit's findings came back re-reported as "new".

**Status: A1, A2, A3 written 2026-08-06. A4 (verification) is outstanding and blocks Phase B.**

### A1 — DEFECT: the portfolio engine is blind to crossover — *done*

`lib/backtest/portfolio.ts:150` and `:186` call `evaluate(condition, vector)` with two
arguments. `previous` is **optional**, so this compiles, silently passes `undefined`, and
`evaluate` correctly answers "unknowable" for a crossing event with no prior bar.

Result: **a crossover strategy never fires in the multi-instrument engine.** It reads as
permanently warming up — zero trades, zero evidence, no error — in the engine the Factory will
use for every sweep. The parity gate cannot catch it: `lib/backtest/parity.test.ts` only
exercises `runBacktest` against a hand-written reference and never compares the two engines.

Fix at both sites. The prior bar is `index - 1` **in that instrument's own series**, never the
previous entry on the merged timeline — instruments have different trading calendars, which is
why `indexByTime` exists (`portfolio.ts:103-105`):

```ts
const previous = index > 0 ? item.panel.at(index - 1) : undefined;
// exits  (:150): evaluate(dsl.exit.condition, item.panel.at(index), previous)
// entries (:186): evaluate(dsl.entry,          item.panel.at(index), previous)
```

This mirrors the single-instrument engine exactly, which is what keeps the equivalence test
honest.

*Lesson worth keeping:* making `previous` optional converted a compile error into a silent
runtime hole. A required parameter would have failed the build and pointed straight at the bug.

### A2 — Hoist the array allocations out of `at()`

`lib/backtest/features.ts:195-196` calls `bars.map(...)` twice **inside** `at()`, allocating
two full-length arrays per call. `at()` is therefore O(N), not O(window), and a backtest walk
is already O(N²); calling `at()` twice per bar doubles the constant.

Move the two `bars.map()` calls up beside the existing `closes`/`volumes` (line 147-148) and
pass the hoisted arrays into `rollingExtreme`. Pure refactor. Removes any need for vector
caching in either engine.

### A3 — Regression test so this cannot reship

`lib/backtest/portfolio.test.ts:47` already has
`describe("agreement with the single-instrument engine")`. Add a second case there using a
`crossover` entry, one instrument, one slot, asserting portfolio trades match `runBacktest`
exactly. Reuse the fixture builders already in that file. **Before A1 this test fails**
(portfolio yields zero trades); after A1 it passes.

### A4 — Verification gate (requires you — I have no shell)

```
npx tsc --noEmit
npx vitest run lib/backtest lib/strategy lib/scalping
```

| Result | Meaning | Response |
|---|---|---|
| Typecheck fails in `dsl.ts`/`engine.ts` | A union-narrowing branch was missed | Fix it — research says unlikely; only 3 files consume `Condition` |
| `crossover.test.ts` fails on trade indices | My hand-computed SMA20 warm-up arithmetic is off | Recompute from the actual failure output |
| `strategy.test.ts` no-trade cases fail | `maxNoTradePValue` / `minNoTradeEdge` mis-calibrated | Tune against the printed edge and p-value |
| `lib/scalping` fails | This morning's golden-bar fixture needs tuning | The `no_setup` result names the exact failing condition |
| Green | Phase A done | Start Phase B |

**Verified as safe by inspection** (no action needed): only `dsl.ts`, `engine.ts` and
`portfolio.ts` consume the `Condition` union — no UI, MCP, API or fixture does; nothing pins
`COMPILER_VERSION` or a literal strategy hash, so the 1.1.0 → 1.2.0 bump is clean;
`panel.at()` always returns an object (`Partial<Record<DerivableFeature, number>>`), so the
`previous` handling is type-correct; `close` and `sma20` are both valid point-in-time features.

---

## Phase B — India + USA pre-market

**Status 2026-08-06 18:05 — B0–B4 are done and browser-verified. `/premarket` renders both
markets with 0 page console errors; DOM and `/api/premarket` agree across 3 passes; the API
returns 400 on an unparseable `at`. `lib/premarket/report.test.ts` is the one piece still
outstanding (B4's second test file).**

Added after the browser pass exposed it: `nextSessionOpen`. At 17:59 IST India read `CLOSED`
with no countdown at all, because `minutesToNextBoundary` is null once the day is over — so the
screen said nothing at the exact hour someone would ask "when does it next open?". It is
reported as a local date and clock time rather than a minute countdown on purpose: a countdown
spanning a DST boundary is wrong by an hour twice a year.

Also delivered this session, beyond the original plan: the investment-mode simulation battery
(`lib/simulation/battery.ts`, five simulations), learning-mode idle detection and memory
self-inspection (`lib/learning/introspection.ts`), whole-graph memory projection
(`lib/knowledge/memory-graph.ts`), three API routes and the `/simulations` screen.

### B0 — The blocker nobody has hit yet: two session vocabularies — *done*

`lib/market/calendar.ts:3` emits `"CLOSED" | "PRE_OPEN" | "REGULAR" | "EXTENDED"`.
`lib/scalping/core.ts` expects `"PRE_OPEN" | "POST_CLOSE" | "CLOSED" | "REGULAR"`.
`EXTENDED` ≠ `POST_CLOSE`, so **piping the calendar into the scalping evaluator is a type
error today**. Reconcile before anything else: one exported session union, imported by both.
Keep `EXTENDED` (it is the accurate word for US post-close trading) and update scalping.

### B1 — Model market *phases*, not one flat pre-open

Today India's whole 09:00–09:15 is a single `PRE_OPEN` label, and the US bucket spans
04:00–09:30 ET — 5.5 hours in one state (`calendar.ts:11-12`). Neither can express what a
pre-market pipeline needs to know.

Add `lib/market/phases.ts` beside the existing calendar (do **not** rewrite `getMarketSession`;
it has callers across the dashboard and paper engine). New function
`getMarketPhase(market, at)` returning a coarse `session` (the existing union, for
compatibility) plus a fine `phase`:

- **IN:** `PRE_OPEN_COLLECTION` (09:00–~09:08, randomised close), `PRE_OPEN_MATCHING`
  (09:08–09:12), `PRE_OPEN_BUFFER` (09:12–09:15), `REGULAR`, `CLOSED`.
- **US:** `EARLY_TRADING` (04:00–07:00), `PRE_MARKET` (07:00–09:25),
  `OPENING_AUCTION_IMBALANCE` (09:25–09:30), `REGULAR`, `POST_CLOSE` (16:00–20:00), `CLOSED`.

Also add `nextPhaseBoundary()` so screens can count down instead of polling — the current
calendar cannot answer "when does this change?" at all.

Model US early closes (the half-days after Thanksgiving and on Christmas Eve) alongside the
existing `HOLIDAYS` set, and bump `holidaySource` to `MARKETPULSE_2026_V2` so a stale calendar
is visible rather than silent.

### B2 — Be honest about what data we can actually get

This is the part where the pasted audit oversold. What we genuinely have:

| Wanted | Reality | Plan |
|---|---|---|
| Overnight gap, prior official close, extended-hours price | Yahoo provides pre/post bars | **Build it** |
| Index/sector context, breadth across a universe | Existing `getNormalizedQuote` + catalog | **Build it** |
| US earnings-date calendar | `getEarnings()` returns *historical* records, not scheduled dates | Refuse with `RESOURCE_NOT_PROVIDED` |
| NSE pre-open equilibrium price / imbalance | Needs NSE's licensed feed. Not available. | Refuse explicitly |
| F&O ban list, price bands, ASM/GSM | Needs NSE/BSE official files | Refuse explicitly |
| US auction imbalance (NOII), LULD, halts | Needs Nasdaq/NYSE entitlement | Refuse explicitly |

Every unavailable input returns a typed refusal carrying *why*, matching the existing
`RESOURCE_NOT_PROVIDED` / `QUANT_CORE_UNAVAILABLE` discipline in `CLAUDE.md`. **Missing is not
zero** — a fabricated imbalance of 0 would read as "balanced book", which is a lie.

### B3 — The pipeline

`lib/premarket/report.ts` — one pure function per market producing a typed
`PreMarketReport`: phase and time-to-open, overnight gap vs prior official close, extended
session liquidity quality (or a refusal when there are no extended bars), index/sector breadth,
candidate table reusing the scoring in `app/api/top-picks/route.ts`, and an explicit
`unavailable: RefusalReason[]` list so the screen shows what it could not see.

Feature derivation reuses `buildFeaturePanel` (`lib/backtest/features.ts`) rather than a
second indicator implementation — the DSL's point-in-time guarantee is the whole reason that
module is separate.

### B4 — Surface and tests

- `app/api/premarket/route.ts` — GET by market, no-store, returns the report plus provenance.
- `app/premarket/page.tsx` — phase timeline with countdown, gap table, breadth, and a visible
  panel listing every refused input. Nav entry in `lib/nav.ts`.
- Tests: `lib/market/phases.test.ts` with a **frozen clock** (deterministic boundary cases at
  each transition, weekend, holiday, early close, and the IST/ET daylight-saving edges), and
  `lib/premarket/report.test.ts` asserting that missing inputs produce refusals rather than
  zeros.

---

---

## Phase C — graphical memory (learning mode)

**Status 2026-08-06 18:25 — done and browser-verified.**

`buildMemoryGraph` already projected the whole graph, but only into JSON on
`/api/introspection`. The `/memory` screen printed edges as text — `a1b2c3… supports → d4e5f6…`
— which is a graph in the same sense that a list of coordinates is a map. The two shapes worth
seeing are precisely the ones a list hides.

- `lib/knowledge/graph-layout.ts` — pure layered layout, no dependency. Six lanes in the order
  evidence flows (sources → claims → hypotheses → strategies → tests → outcomes), one
  barycentre pass to uncross edges, per-lane cap with both numbers reported. An edge running
  right-to-left is marked `backwards` and drawn static and dashed, so an argument that runs
  against its own provenance is visible rather than merely tangled.
- `components/memory/MemoryMap.tsx` — server-rendered SVG. No client JavaScript; the only
  motion is a CSS dash animation, disabled under `prefers-reduced-motion`.
- `/memory` gains the map plus two panels the data always supported and nothing displayed:
  **connected to nothing** (orphans) and **failures seen more than once**.

**What it found on first render, against the live database:** both strategies are orphans and
`TESTS 0` — two strategies exist that were never linked to a hypothesis and have never been
tested. That was true before this screen existed; nothing surfaced it.

---

## Sequencing

A1 → A2 → A3 → **A4 verification gate** → B0 → B1 → B2/B3 → B4.

B0 and B1 are pure and independently testable with a frozen clock, so they can land before any
provider work.

## Out of scope

Owner-only, hook-protected: `app/api/proposals` strict schema, the `plansRoot` hook allowance
(this plan lives in `docs/` because of it), and rotating the leaked Finnhub key. No broker
adapter and no execution — `EXECUTION_ADAPTER_MISSING` stands.
