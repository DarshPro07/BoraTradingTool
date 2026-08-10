# Owner brief, verified system state, and plan — 2026-08-08

Everything decided in the 2026-08-08 interview, plus what the system verifiably is today, plus
what to build. This supersedes the scattered assumptions in earlier docs.

---

## 1. Owner decisions (from the interview)

| Question | Answer | Consequence |
|---|---|---|
| Market | **NSE cash equities + ETFs, and US equities** | No futures, no options. See §5 — this deletes ~40% of the master prompt. |
| Historical data | **Free / live-fetched only** | No purchased 1-minute data. Intraday research is not possible. |
| Success bar | Monthly income → learning first → beat NIFTY → capital preservation (all four, in that order) | Goals conflict; see §6. |
| Strategy origin | Published strategies + ICT/Silver Bullet + novel quant + "whatever survives" | ICT is blocked on data. Rest is live. |
| Capital | **~₹1,000, "starting from less money"** | **The binding constraint on everything.** See §2. |
| Max drawdown | Delegated to me | Set at 20%; see §6. |
| Holding period | All / "let the system decide", wants autonomous self-adjustment | Resolved to positional-swing; see §6. |
| Promotion gate | Delegated to me | Set to paper-forward-only; see §6. |
| Broker | Kite (Zerodha), later task | Not built. See §8. |

---

## 2. The cost wall — the central finding

**At ₹1,000 of capital, transaction costs exceed any realistic strategy edge by roughly an order
of magnitude.** This is arithmetic, not strategy quality.

Verified 2026-08-08 against public sources: Zerodha charges **₹0 brokerage on equity delivery**,
but levies a **DP charge of ₹13.50 + 18% GST ≈ ₹15.93 per scrip, per day** on every delivery
*sell* — flat, regardless of quantity or value. It is split CDSL ₹3.50 / broker ₹10.25 and is
collected on settlement.

Round trip on a ₹1,000 delivery position:

| Charge | Approx. |
|---|---|
| Brokerage (delivery) | ₹0 |
| STT 0.1% both sides | ~₹2.00 |
| Exchange txn + SEBI + GST | ~₹1.00 |
| Stamp duty 0.015% buy | ~₹0.15 |
| **DP charge on sell (flat)** | **₹15.93** |
| **Total** | **≈ ₹19 → ~1.9% round trip** |

The DP charge alone is **1.6% of a ₹1,000 position**. Published daily equity strategies have edges
measured in fractions of a percent per trade.

**Thresholds implied by the flat charge:**

> **Corrected 2026-08-09.** The table first written here showed the DP charge *as a share of the
> position* and read the verdict off that column alone. That understated the true cost at every
> size, because it omitted STT — which is 0.1% on **both** delivery legs and does not shrink.
> The figures below are total round-trip cost, computed by `lib/paper/cost-model.ts` and asserted
> in its tests.

| Position size | Total round trip | Of which flat DP | Verdict |
|---|---|---|---|
| ₹100 | **16.150%** | ₹15.93 | Impossible |
| ₹1,000 | 1.816% | ₹15.93 | Unworkable |
| ₹5,000 | 0.541% | ₹15.93 | Marginal |
| ₹10,000 | 0.382% | ₹15.93 | Workable |
| ₹25,000 | 0.286% | ₹15.93 | Workable |
| ₹1,00,000 | 0.238% | ₹15.93 | Workable |
| ₹10,00,000 | 0.224% | ₹15.93 | Floor |

**The cost never falls below ~0.22%.** Growing the position dilutes the flat DP charge to nothing
but cannot touch the 0.2% of STT. Any strategy whose edge per trade is under a quarter of a
percent is unprofitable at *every* account size, not merely at small ones.

**The delivery floor is ₹23,000**, and it comes from two of this system's own rules colliding:

- `lib/strategy/dsl.ts:188` caps one position at **25%** of the book, so a compliant portfolio
  holds **at least 4 positions**.
- Cost requires each delivery position to be **≥ ~₹5,735** to keep the round trip under 0.5%.

4 × ₹5,735 ≈ **₹23,000**. At ₹1,000 delivery, break-even edge is **1.82%** per trade and annual
cost drag is **21.8%** of capital.

### 2.1 Intraday removes the wall — added 2026-08-09

**The ₹23,000 figure is the floor for *delivery*, not for trading.** Intraday changes the picture
completely, because **no DP charge arises** — nothing leaves the demat account on a square-off —
and STT is **0.025% sell-side only** instead of 0.1% on both legs.

| Position | Delivery | Intraday |
|---|---|---|
| ₹1,000 | 1.816% | **0.106%** |
| ₹10,000 | 0.382% | **0.106%** |
| ₹25,000 | 0.286% | **0.106%** |

Every intraday charge is proportional, so **the ratio does not change with size** (until the ₹20
brokerage cap binds around ₹66,000). Delivery's curve bends because ₹15.93 is flat; intraday's is
a straight line. That is precisely why intraday reaches down to a small account and delivery
cannot.

**What actually binds at ₹1,000 is share granularity, not cost.** A position must be able to buy
at least one share; `MIN_POSITION_VALUE = ₹500` is the stated floor (raise it for a large-cap-only
universe). Four positions × ₹500 = **₹2,000**.

The ladder `viableConfiguration()` produces:

| Capital | Product | Shape | Round trip |
|---|---|---|---|
| ₹1,000 | — | **refused** | — |
| **₹2,000** | **INTRADAY** | 4 × ₹500 | **0.106%** |
| ₹5,000 | INTRADAY | 10 × ₹500 | 0.106% |
| ₹23,000 | DELIVERY | 4 × ₹5,750 | 0.499% |
| ₹1,00,000 | DELIVERY | 17 × ₹5,882 | 0.493% |

Delivery is preferred wherever affordable — it is the lower-risk product, since an intraday
position is squared off at a time the broker chooses, converting a temporary drawdown into a
realised loss. Intraday is what makes a small account tradable, not what one should prefer.

> **Note on the position count.** `maxViablePositions` returns the *largest* count that stays
> under 0.5%, which maximises diversification and pushes cost to the ceiling. At ₹1,00,000 that is
> 17 × ₹5,882 at 0.493%; four positions of ₹25,000 would cost 0.286%. This is a deliberate
> preference for diversification over cost, and it is worth revisiting once real edge is measured.

**Two constraints remain, and they are now the binding ones:**

1. **Intraday needs intraday bars.** The owner's "free / live-fetched only" constraint is now the
   limiting factor, not capital. This is what blocks the ICT detectors too.
2. **Break-even edge is ~0.11% per trade.** Low, but not zero — and it must be *measured*, not
   assumed.

**This does not stop the project.** It determines what the project is *for* right now — see §6.

---

## 3. What the system verifiably is today

Measured, not assumed, on 2026-08-08.

**Green — built and tested (1,055 passing tests):**

| Capability | Where |
|---|---|
| Governance kernel, `place_order` prohibited every mode | `lib/governance/policy.ts:77` |
| 7-stage gauntlet, walk-forward, cost stress, Monte Carlo | `lib/strategy/gauntlet.ts` |
| Deflated Sharpe (Euler–Mascheroni), PBO/CSCV, paired bootstrap | `lib/strategy/statistics.ts` |
| Sealed holdout, budget 1, append-only | `lib/strategy/holdout.ts` |
| Promotion ladder — stage **derived** from evidence, never stored | `lib/strategy/lifecycle.ts` |
| Graveyard + rediscovery blocking | `lib/strategy/graveyard.ts` |
| Forward record, R fixed at open, re-resolution refused | `lib/strategy/forward.ts` |
| Trial ledger | `lib/knowledge/repository.ts` |
| Trade board — eligible → signal → priced ticket → gate verdict | `lib/execution/board.ts` |
| Component ablation (incremental + leave-one-out) | `lib/research/ablation.ts` |
| PriceDomain + typed PriceFrame, static + runtime enforced | `lib/market/price-domain.ts` |
| Point-in-time contract master (survivorship firewall) | `lib/market/contract-master.ts` |
| Causal loader — domain/as-of/universe/holdout gates | `lib/market/loader.ts` |
| Broker mode ladder + paper simulator, trade-through fills | `lib/execution/broker.ts` |
| **14-state panel language** | `lib/ui/panel-state.ts` |
| Kronos reader + persistence-baseline scorer | `lib/forecast/` |

**Red — the three real gaps:**

### 3.1 Navigation: 26 pages, 1 linked

```
$ find app -name "page.tsx" | wc -l      → 26
$ grep -oE 'href="/[a-z-]+"' components/layout/TopNav.tsx | sort -u
"/command"
```

There is no `NAV` / `LINKS` / `SECTIONS` array. **Twenty-five of twenty-six screens are
unreachable by clicking.** This is the whole of "the UI is not in proper flow or structure" — the
panels and the state vocabulary exist and are good; the shell that connects them does not.

### 3.2 Autonomy: the loop runs on human interaction, not on a schedule

`data/quantcore/` artifacts were regenerated at `2026-08-08 23:41` and, before that, at
`2026-08-08 00:11` — about 23.5 hours apart, not the 15-minute cadence the cycle is designed for.
They regenerate when the app is opened.

`components/layout/AutonomyStrip.tsx` already names the problem in its own code:

> `"this tab"` … means autonomy stops the moment the browser closes, so a run log that looks
> healthy right now will simply end. The scheduler survives a reboot; the daemon does not.

So: `scripts/cycle.mjs` and `scripts/daemon.mjs` exist and work.

> **Corrected 2026-08-09.** This section previously concluded "the Windows scheduled task was never
> registered … that single missing registration is the entirety of 'it is only learning but not
> autonomously'." **That was wrong.** Checked directly:
>
> ```
> TaskName : MarketPulse Cycle     State : Ready
> LastRunTime : 8/8/2026 11:56:01 PM     LastTaskResult : 0
> NextRunTime : 8/9/2026 12:11:00 AM     NumberOfMissedRuns : 0
> ```
>
> The task is registered, fires every 15 minutes, and exits cleanly. The 23.5-hour artifact gap
> was read off file timestamps that the cycle does not rewrite when nothing changed.

**The real gap is narrower.** The loop genuinely does a great deal autonomously — it refreshes
quant-core artifacts, seeds the quiz bank, introspects memory, runs the promotion pass, drains the
research queue, rehearses validation, builds the trade board, and at `evolving` breeds new
strategies. What it cannot do is **acquire ideas from outside itself**:

`enqueue()` in `lib/research/queue.ts` is called from exactly three places — `mcp/server.ts`
(an agent, by hand), `app/api/research/jobs/route.ts` (a human POST), and one test. The consumer
side is complete and working (`lib/research/worker.ts` → `claimNextJob`). So the system drains a
queue that only a human fills.

That is the whole of "it learns but is not autonomous": the loop turns, and nothing feeds it.

### 3.3 Data: essentially none

`data/quantcore/` holds six small JSON/JSONL files. Zero Kronos forecasts. No stored candle
history of consequence. Every strategy module is machinery waiting for input.

---

## 4. The UI target — the Threepio reel, and the actual gap

From `threepio_reel_package/analysis/ui_inventory.md`, the target is:

**Top operational rail** — India session *and* USA session, provider health, event-time watermark
and freshness, research scheduler, backtest workers, learning state, risk gate, confirmation
queue, incidents, `live execution: disabled`.

**Left navigation, 19 sections** — Command, Pre-market, Markets, Research Vault, Knowledge Graph,
Hypotheses, Strategy Factory, Strategy Studio, Experiments, Gauntlet, Graveyard, Portfolio HQ,
Risk Gate, Confirmations, Data Quality, Jobs, Incidents, Audit, Settings.

**Main canvas** — resizable panels with saved layouts.

**Required state language** — every panel must distinguish: loading, streaming, current, delayed,
stale, partial, unavailable, unsupported, unauthorized, invalid, compute error, retrying, offline,
empty.

**Mobile** — a monitoring and confirmation client, not a compressed workstation.

**Gap assessment:** the state language is **done** (14 states, `lib/ui/panel-state.ts`). The
panels largely exist across the 26 pages. What is missing is the **shell**: a left nav, a complete
top rail, and saved layouts. That is a far smaller job than "rebuild the UI", and it is the single
highest-visibility fix available.

The reel's top rail already calls for India *and* USA sessions, which matches the owner's
both-markets answer exactly.

---

## 5. Scope deleted by "cash equities only"

No longer needed, and should not be built:

- Roll engine and roll methodologies (§13–16)
- Futures contract/expiry model, `roll_events.parquet`, roll inspection CLI (§35)
- Dual raw + back-adjusted series (§6), yearly adjustment report (§16)
- `CONTINUOUS_ADDITIVE` / `CONTINUOUS_RATIO` as *futures* domains — the enum stays for
  `EQUITY_CORP_ACTION_ADJUSTED`, which does still matter
- Options cost basis (premium vs notional), Greeks
- Intrabar ambiguity (§69) — daily bars deciding on close and filling at next open already avoid it
- Intraday session labelling, pre-open states (§20–25) — low priority for daily strategies
- FVG / sweep / MSS / displacement detectors (§40–52) — intraday, and blocked on data anyway

**Still needed:** corporate actions, point-in-time equity universe, effective-dated costs,
dataset manifests, the holdout firewall, and the whole robustness lab.

---

## 6. Decisions made on the owner's behalf, with reasons

**Max drawdown → 20%.** NIFTY has itself drawn down more than that repeatedly. A 5–10% cap halts
legitimate strategies constantly; a 30% cap is one most people abandon mid-drawdown. 20% is the
range a real equity strategy needs. It is not the primary protection — the promotion gate is.

**Promotion gate → nothing trades real money until paper-forward proves it.** The only option that
directly answers the stated fear of loss, costs nothing at current capital, and is already
implemented (`forward.ts`, `MIN_FORWARD_OBSERVATIONS = 20`).

**Holding period → positional / swing, weeks to months.** Not a preference — a consequence. Cost
drag is the binding constraint and turnover multiplies it. Intraday is doubly impossible: no data,
and the flat DP charge is per scrip *per day*.

**Resolving the goal conflict.** Monthly income and capital preservation pull opposite ways on
turnover and risk. Given ₹1,000 and no intraday data, the reachable goal today is **"learning
first"**, and the honest sequence is:

1. Now → accumulate forward evidence at zero risk while capital grows
2. At ~₹25,000 → smallest viable live allocation, only for a paper-proven strategy
3. At ~₹1,00,000 → diversified basket, the point at which "beat NIFTY" becomes measurable
4. Monthly income → not a near-term target, and should not gate anything

**This turns the capital constraint into an asset:** the months spent accumulating capital are
exactly the months needed to accumulate forward observations. By the time there is money to
deploy, there would be real unbiased evidence rather than a backtest.

---

## 7. On "autonomous, self-adjusting, rebuilds itself after losses"

This is achievable and mostly built, but one word has to change meaning.

**Adjusting a parameter after a loss until it stops losing is not learning — it is searching.**
The 25,000-config study found 6,190 configurations "made money after costs" and only 420 survived
trial correction, cross-instrument testing and a locked holdout. A bot that tweaks itself after
every loss manufactures members of that 6,190. The second video is a live demonstration: ~2 hours
of agent tuning, then a reported 101% return / 6.2% max drawdown, with no trial count.

The honest version already exists here:

| Wanted | Existing mechanism |
|---|---|
| "doesn't repeat the same mistake" | Graveyard — a buried strategy can never be rediscovered under a new name |
| "learns from losses" | Trial ledger + deflated Sharpe — every adjustment raises the family's bar permanently |
| "least human interaction" | `runLearningCycle` runs headless; needs only the scheduler registered (§3.2) |
| "rebuilds itself" | `evolution_proposals` + the strategy factory breed new candidates each cycle |

**Rule to preserve:** autonomy is fine; *free* self-adjustment is not. Every self-change must cost
a trial, or the output is untrustworthy by construction.

---

## 8. Build order

1. **Effective-dated cost engine with flat per-trade charges (§74).** `feePolicyFor()` takes no
   date and models no DP charge, so *every backtest in this repo currently understates real cost*.
   This is the module that answers "can this earn at my capital?" — and at ₹1,000 it will answer
   no, with the threshold.
2. **Register the scheduler.** One command; converts "learning" into "autonomous".
3. **Navigation shell + full top rail.** Connects 25 orphaned pages; highest visible improvement
   per unit of work.
4. **Wire the 8 direct `INSTRUMENT_CATALOG` importers through the causal loader.** Makes the
   survivorship and as-of guards load-bearing rather than decorative.
5. **Research factory (§79–105)** — 20 published daily candidates, preregistered, gauntleted.
6. **Kronos point-in-time forecast archive** — unblocks `forecast_return_1d/5d`.

Deferred: broker adapter (owner: Kite, explicitly a later task); ICT detectors (blocked on
intraday data).

---

## 9. Open questions

- **US equities access** — via an Indian broker under LRS, or a separate US brokerage? Affects
  cost model and currency handling.
- **Is the ₹1,000 a starting figure that grows monthly?** A ₹5,000/month SIP into the system
  reaches the ₹25,000 threshold in five months and changes the timeline materially.
- **Corporate-action source for NSE** — no free reliable feed is currently wired.

## 10. Sources

- [Zerodha — brokerage charges](https://zerodha.com/charges/)
- [DP charges in Zerodha explained](https://select.finology.in/articles/broker/dp-charges-in-zerodha)
- [Zerodha brokerage charges 2026](https://www.cashoverflow.in/zerodha-charges/)
- [Zerodha brokerage calculator 2026](https://accelpix.com/brokerage-calculator/brokers/zerodha.html)
