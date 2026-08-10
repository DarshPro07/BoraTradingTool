# Intraday capability — plan, 2026-08-09

## Why this is the next thing

The system holds 94 days of 5-minute NSE bars and cannot use them, and every strategy it can test
is for a product the owner cannot afford. Three facts that only make sense together:

| Fact | Source |
|---|---|
| ₹2,000 trades **intraday only**; delivery needs ₹23,000 | `lib/paper/capital.ts` |
| 30,832 five-minute bars held, 94-day span, `beyondProvider: 6` | `intradayDepth()` |
| **0 of 8 strategies are intraday** — all `resolution: "D"` | strategy registry |

Closing that mismatch is the only work that moves the system toward answering "does this earn?"
at the capital that actually exists.

## Two blockers found before planning

**B1 · The declared resolution is ignored.** `marketCandleLoader` reads `dsl.universe.market` and
never `dsl.universe.resolution`; the resolution comes from the loader's own closure, which the
cycle sets to `"D"`. An intraday strategy would be rehearsed on **daily bars, silently** — the DSL
validates it as intraday, warns about spreads and bar-counting, then hands it the wrong series.
Nothing downstream could detect it. This is the highest-severity item here.

**B2 · The DSL cannot express square-off.** `exit` offers `afterDays`, `stopLossPct`,
`takeProfitPct`, `condition` — no time of day. NSE force-closes MIS positions around 15:20, so a
backtest can currently model holding a position the broker would have closed, at a price that
never existed for it.

Both must be fixed *before* authoring intraday strategies, or the strategies produce confidently
wrong results — the exact failure this codebase is built to prevent.

## Owner decisions taken (2026-08-09)

1. **Square-off: hard cap with tighter opt-in.** A non-negotiable session ceiling no spec can
   exceed, plus an optional earlier exit per strategy.
2. **Paper only, with a defined trigger.** Nothing reaches real capital on a schedule. An explicit
   forward-evidence bar opens a conversation; it does not authorise anything by itself.
3. **Strategy families: chosen from research**, all four options open.
4. **Gauntlet: autonomous, least human interaction** — *and* one trial spent now to prove the
   machinery end to end.

### How "autonomous gauntlet" is constrained

`CLAUDE.md`: *"Do not run the validation gauntlet speculatively — every trial permanently raises
the statistical bar for that strategy."* Autonomy therefore cannot mean "run it when idle". A
trial is spent automatically only when **all** hold:

- the persisted rehearsal verdict is `would_pass`;
- the strategy is tradable at the owner's capital (`viableConfiguration` accepts its product);
- its declared cost clears `costStanding` — no strategy priced for a market the owner cannot reach;
- a per-day trial budget is not exhausted;
- the strategy is not already at or past `validated`.

Anything short of that stays a recommendation. This is the difference between an autonomous system
and an unsupervised one.

## B3 · Two clocks in one candle series (found 2026-08-09, after B1)

`price_candles` held **two incompatible timestamp conventions in the same instrument's series**.

| Source | A 09:15 IST bar is stored as | Convention |
|---|---|---|
| Yahoo accumulator | `03:45Z` | true UTC — correct |
| `quant/tv_history.py` | `09:15Z` | IST wall-clock stamped as UTC — wrong |

`tv_history.py:68` said so in a comment: *"Consistency matters more than absolute offset here, because
every consumer compares these bars only with each other."* That stopped being true the moment both
sources wrote to one table. Six tickers — RELIANCE, TCS, INFY, ITC, HDFCBANK, ICICIBANK — carried
both, 5h30m apart, and in the `09:15–10:00Z` overlap `UNIQUE(ticker,resolution,time)` silently
merged a 09:15 IST bar with a 14:45 IST one: one price won, chosen by insert order.

Every time-of-day rule in this plan — square-off (B2), the opening range (item 4) — would have read
the wrong clock for half the intraday universe, silently. **Repaired before B2**, because a
session-relative feature computed over a mixed clock is not approximately right, it is meaningless.

The repair does not need a re-fetch: `data/quantcore/nse-tv-5m.json` survived and is *pure*
tvdatafeed (6 × 5000 bars, 75 session slots each), so it shifts unambiguously.

## Owner decisions taken (2026-08-09, second round)

| # | Decision | Consequence |
|---|---|---|
| 5 | **Repair by fix + purge + re-import** | `tv_history.py` emits true UTC and stamps `timeBasis`; the six tickers' 5m rows are purged and reloaded from the surviving export |
| 6 | **Square-off ceiling = 15:20 IST** | Zerodha's actual MIS equity square-off, not the 15:30 exchange close. Non-negotiable; no spec may exceed it |
| 7 | **Autonomous trial budget = 1/day** | With all five guards, at most ~30 trials a month |
| 8 | **Repos: tulipy and GNews**, after the four tasks | tulipy widens the feature vocabulary; GNews is context, not signal |

### The governance constraint on decision 7

`run_gauntlet` **is not in `AUTONOMOUS_PERMITTED`** (`lib/governance/policy.ts`), and that file is
protected — *"The governance policy cannot amend itself."* The allowlist is denied-by-default, so
no autonomous actor may spend a trial today. That is a designed answer, not an oversight, and
routing around it would be the single most damaging thing an agent could do here.

So the machinery is built complete and **self-activating**: `runAutonomousGauntlet` asks the policy
first. Today it is denied, so it persists a fully-guarded recommendation instead of spending the
trial. The day the owner adds one line to `AUTONOMOUS_PERMITTED` — an edit only they may make — the
same code begins spending trials at 1/day with every other guard already in force. Nothing else
changes. Both paths are tested.

## Build order

| # | Item | Why this order |
|---|---|---|
| 1 | **B1 — resolution reaches the loader** | Everything intraday is meaningless until bars match the declared resolution |
| 2 | **B3 — one clock in the candle store** | A session-relative rule over a mixed clock is meaningless, not merely imprecise |
| 3 | **B2 — session-end exit in the DSL** | An intraday spec cannot be honest without it |
| 4 | Session features (`minutes_since_open`, `opening_range_high/low`) | An opening-range breakout is not expressible without an opening range |
| 5 | Remove `collision_probe`, `dup_probe_1` | Debug artefacts polluting the registry |
| 6 | Author intraday strategies | Now expressible and testable |
| 7 | Guarded autonomous gauntlet | Only meaningful once tradable candidates exist |
| 8 | Playwright + unit verification | Acceptance, per the standing rule |

## Strategy families — the research position

Opening-range breakout is first because it is the most documented Indian intraday pattern and the
cheapest to express with features already derivable here. First-hour momentum is second for the
same reason — it needs nothing new. VWAP reversion is third: it requires VWAP as a derived
feature, which this deployment does not currently compute, so it carries a build cost the other
two do not. Factory breeding is last deliberately — a genetic search over intraday space raises
the multiple-testing denominator very fast, and doing it before any hand-authored intraday
strategy has been rehearsed would spend that budget blind.

**Stated up front:** published edges for all three families come from other markets and other
decades. They are reasons to test, never evidence. The break-even bar at ₹2,000 intraday is
~0.11% per trade, and nothing here has cleared it.

---

## Outcome, 2026-08-09

All six items delivered. 1,216 unit tests, 66 e2e (desktop + mobile), typecheck clean.

| # | Item | State |
|---|---|---|
| 1 | B1 — resolution reaches the loader | done, 7 tests |
| 2 | B3 — one clock in the candle store | done; 30,000 bars rebuilt, 0 outside session |
| 3 | B2 — session-end exit in the DSL | done, 10 tests, both engines |
| 4 | Session features | done, 8 tests |
| 5 | `collision_probe`, `dup_probe_1` removed | done, guarded by evidence check |
| 6 | Intraday strategies authored | `orb_nse_5m`, `first_hour_momentum_nse_5m` |
| 7 | Guarded autonomous gauntlet | done, 15 tests; refuses by policy, self-activating |
| 8 | Playwright verification | done, 5 new specs × 2 projects |

### A third instance of the same defect, found while wiring

The cycle had begun reusing `evidence.dataset` — **daily** bars fetched for the quant-core pass —
for any strategy whose *market* matched. That re-created B1 one layer above the fixed loader and
would have silently undone it. Three occurrences now, all the same mistake: something knew the
strategy's market and assumed that settled which bars, or which clock, to give it. Pinned by
`lib/learning/cycle.resolution.test.ts`, which was confirmed to fail without the guard.

### What the strategies actually did

Rehearsed against all 30,000 repaired 5-minute bars across six NSE instruments:

| Strategy | Trades | Wins | Net (sum) | Exits |
|---|---|---|---|---|
| `orb_nse_5m` | 73 | 28 (38%) | **−16.34%** | 38 stop, 20 target, 15 square-off |
| `first_hour_momentum_nse_5m` | 87 | 25 (29%) | **−27.82%** | 52 stop, 21 target, 14 square-off |

Both lose money. That is the honest result and it is the system working: the machinery is now
correct end to end — entries fall inside their declared windows, no exit lands after 15:20, the
square-off fires — and on this sample neither pattern clears its 29 bps round trip. Both will
rehearse as `would_fail`, so the first guard correctly refuses to spend a trial on either.

Nothing here is evidence that these patterns do not work; 67 sessions on six large caps is a thin
sample and the parameters were chosen a priori rather than fitted. It is evidence that the pipeline
no longer flatters them.

---

## P0 · Research identity — started 2026-08-09, after external review

Review found a defect that outranks everything above: **every strategy spec has
`hypothesis_id = NULL`**, so `countSelectionTrials` walked a family of one and deflated the Sharpe
ratio against a denominator of 1. The sealed-holdout budget was keyed on `(holdoutId, specId)`, so
a rename bought a second look at data that may be looked at once — behaviour *asserted as correct*
by `strategy.test.ts` under the name "tracks budgets per strategy, not globally".

Unlike the intraday defects, this one was producing wrong numbers rather than permitting future
wrong ones.

### The invariant now being enforced

> Changing the name, id, version, parameters or representation of an idea must never erase the
> statistical history that informed its selection.

### The distinction that stops the fix becoming the next bug

A **family** is methodological lineage — one economic hypothesis and its variants. A **selection
trial** is one configuration actually tested and allowed to influence which candidate was chosen.
Ten opening-range variants are *one family* and *ten selection trials*. Keying the denominator to
the family label would understate `N` exactly as badly as keying it to the spec id does today, so
the two live in separate tables and are counted by separate functions.

### Delivered

| Item | State |
|---|---|
| **P0.0 · Freeze** on gauntlet trials and holdout reads | done — refused at both production doors, pinned by a test that must be edited to thaw |
| Research-identity schema (campaign → family → identity → trials → access) | written, **blocked**, see below |
| Fingerprints: semantic (params stripped) and configuration (params included) | done |
| Fail-closed identity resolution and validation standing | done |
| Selection-trial ledger and family-scoped denominator | done |
| Two-gate atomic holdout entitlement | done |
| Adversarial suite T1–T8, T11 + mutation check T12 | done, 18 tests |
| Backfill **classifier** (read-only, proposes, never writes) | done |

### Two owner-only edits stand between this and live

1. **`lib/db/migrate.ts`** — protected. Move `drizzle/pending/0008_research_identity.sql` up to
   `drizzle/` and add it to `MIGRATIONS`, together. It sits in `pending/` deliberately:
   `migrate.test.ts` asserts every `.sql` in `drizzle/` is registered, and that guard is the
   defence against a migration that looks applied and is silently skipped. Turning it red would
   train everyone to ignore it.
2. **Campaign and family declarations** for the eight existing specs. The classifier groups
   `sma_cross_20_50` and `sma_cross_ui_probe` as structurally identical; the other six come back
   `UNKNOWN` and fail closed. Placing them is a claim about an economic hypothesis, which is the
   owner's to make.

### Two bugs the tests caught in this work

**A collision in the entitlement id.** `hoa_${generation.slice(0,8)}_${family.slice(0,8)}` mapped
`holdout_2026_h1` and `holdout_2026_h2` to the same primary key, so a *legitimate* new holdout
generation was reported as a spent budget — silently making every future sample unusable. Caught
by the control test asserting the gates are not too blunt, which is why guards need a test proving
they still let the right things through.

**The mutation check.** `selectionTrialCount` was temporarily reverted to return `1` on missing
identity; T7 failed as required, then the fix was restored. The suite detects the defect rather
than merely compiling alongside it.

### Not done, deliberately

Automation stays off. No indicators, no new strategies. Broker execution profiles, the capital
feasibility engine, the broker axis on fee schedules, and CI determinism all queue behind identity,
because a system that cannot say which strategies are related should not be computing
multiple-testing corrections for any of them.
