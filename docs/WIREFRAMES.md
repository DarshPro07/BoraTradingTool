# Wireframes — two workspaces

Implements R0. The current build has 26 pages across 5 nav sections; this collapses them to
**2 workspaces × 5 views**. Every existing capability survives — it moves, it is not deleted.

---

## Persistent chrome (both workspaces)

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ ▲ MARKETPULSE   [ RESEARCH │ EXECUTE ]        ⬤ IN CLOSED  ⬤ US REGULAR   ⌕ search   │
│                   ▲ workspace switch          ▲ live session state, both markets      │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ ⏱ autonomy: LEARNING · last cycle 4m ago · 3 actions   │ data: PARTIAL │ risk: ARMED  │
│   ▲ this line is the fix for "it says LEARNING but nothing happens"                   │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ TCS ₹2,373 -1.66%  HDFCBANK ₹734 -0.10%  AAPL $314 +0.99%  … (scrolling ticker)       │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

The autonomy strip is always visible and always specific: mode, **age of the last cycle**, and
what it did. A badge that only says `LEARNING` is exactly the complaint being fixed.

---

## RESEARCH · view 1 — Command (default)

The answer to "what did it do while I was away".

```
┌─ ACTIVITY ────────────────────────────────┬─ NOW ──────────────────────────────────┐
│ 20:34  Rehearsed 2 candidates             │  Paper equity      ₹98,412  ▼ -1.6%    │
│        → none would survive the battery   │  Open positions    3                    │
│ 20:34  2 findings across 28 memory nodes  │  Today realised    -₹340                │
│ 20:19  Processed 0 research jobs          │  Risk posture      TIGHTENED (2 losses) │
│ 19:47  Rediscovery blocked: sma_cross v1  │  ─────────────────────────────────────  │
│        → already buried, 3 trials spent   │  ⟳ Run cycle now    ⏸ Pause autonomy   │
│ …                                          │                                        │
├─ WHAT NEEDS ME ───────────────────────────┴────────────────────────────────────────┤
│ ⚠ 2 strategies reference features the engine cannot derive (market_cap, …)          │
│ ⚠ Quant core offline — 6 resources unavailable, not zero                            │
│ ⚠ 1 candidate would survive the battery — worth spending a trial?      [Review]     │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

`ACTIVITY` is a durable log, not component state — it survives a reload. `WHAT NEEDS ME` is the
introspection findings, ranked by severity, each with one action.

---

## RESEARCH · view 2 — Pre-market

```
┌─ INDIA ─────────────────────────┬─ UNITED STATES ─────────────────────────────────┐
│ CLOSED · 20:41 IST              │ REGULAR · 11:11 ET · 289 min to POST CLOSE      │
│ Opens Fri 2026-08-07 09:00      │ ▓▓▓▓▓▓▓▓▓░░░░░░  session progress               │
│ ├ PRE_OPEN_COLLECTION 09:00     │                                                  │
│ ├ PRE_OPEN_MATCHING   09:08     │  GAPS          adv 12 · dec 6 · unch 2          │
│ ├ PRE_OPEN_BUFFER     09:12     │  NVDA   +4.69% ▇▇▇▇▇▇▇                          │
│ └ REGULAR             09:15     │  RELIANCE +3.52% ▇▇▇▇▇                          │
│                                  │  TCS    -1.66% ▂▂▂                              │
├─ NOT VISIBLE TO THIS DEPLOYMENT ─┴──────────────────────────────────────────────────┤
│ ⊘ NSE pre-open equilibrium price   — needs NSE licensed feed                        │
│ ⊘ F&O ban list, price bands        — needs official NSE/BSE daily files             │
│ ⊘ Opening-cross imbalance (NOII)   — needs Nasdaq/NYSE entitlement                  │
│   Absence is listed, never assumed benign.                                           │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

---

## RESEARCH · view 3 — Studio

Author → compile → rehearse → simulate, without leaving the view.

```
┌─ STRATEGY ──────────────────────┬─ CHART + INDICATORS ────────────────────────────┐
│ name  sma_cross_v2              │      ╱╲    ╱╲                                    │
│ market US ▾   maxPositions 10   │    ╱╲  ╲╱╲╱  ╲   ← candles, SMA20/50/200         │
│                                  │  ╱      entry ▲   exit ▼                        │
│ entry  crossover(sma20, sma50)  │ ────────────────────────────────────             │
│ exit   afterDays 10 · stop 5%   │ RSI ▁▂▅▇▅▂▁▂▅▇                                  │
│ costs  5bps + 5bps slippage     ├─ COMPILE ───────────────────────────────────────┤
│ sizing 5% max position          │ ✓ compiles · v1.2.0 · hash 8f3a…                │
│                                  │ ⚠ features not derivable: —                     │
│  [Compile]  [Rehearse]          │ ⚠ zero costs would overstate edge: no            │
├─ REHEARSAL (costs no trial) ────┴─────────────────────────────────────────────────┤
│ 12 instruments · 340 trades · 8 signals dropped for capacity                        │
│ monte_carlo ✓ · block_bootstrap ✓ · walk_forward ✗ · permutation ✓ · cost_stress ✓ │
│                                                                                     │
│   ▁▂▅█▇▅▂▁   ← distribution of resampled profit factors, p05 marked                │
│                                                                                     │
│ WOULD FAIL — only 2 of 5 time slices profitable. Not spent a trial finding out.     │
│ [Send to gauntlet — costs 1 trial, raises this strategy's bar permanently]          │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

The compile panel reporting **underivable features at authoring time** is the fix for the two
strategies currently in the database that reference `market_cap` and `sector_relative_strength`
— features the engine cannot compute, discovered only when a replay was attempted.

---

## RESEARCH · view 4 — Memory

```
┌─ THE WHOLE GRAPH ───────────────────────────────────────────────────────────────────┐
│ SOURCES 4      CLAIMS 14/16     HYPOTHESES 3    STRATEGIES 2   TESTS 0   OUTCOMES 3 │
│ ┌────────┐     ┌────────┐       ┌────────┐      ┌────────┐              ┌────────┐  │
│ │ source │────▶│ claim  │──────▶│ hypoth │─────▶│ strat  │  (none)     │ lesson │  │
│ └────────┘  ╲  └────────┘   ╲   └────────┘      └╌╌╌╌╌╌╌╌┘ ◀ dashed =   └────────┘  │
│              ╲                ╲                    ORPHAN     never tested          │
├─ CONNECTED TO NOTHING ──────────────┬─ FAILURES SEEN MORE THAN ONCE ────────────────┤
│ STRATEGY  gap_largecap_premarket    │ ×4  insufficient_bars                         │
│ STRATEGY  gap_smallcap_premarket    │ ×3  feature_not_available                     │
├─ GRAVEYARD ─────────────────────────┴───────────────────────────────────────────────┤
│ sma_cross v1  buried 2026-07-01 · 3 trials · deflated Sharpe below bar              │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## RESEARCH · view 5 — Paper

```
┌─ EQUITY ────────────────────────────────────┬─ POSITIONS ────────────────────────┐
│ ₹100k ┤                        ╱╲            │ RELIANCE  12 @ ₹1,290  +₹420      │
│       ┤          ╱╲      ╱╲  ╱    ╲          │ TCS        5 @ ₹2,410  -₹185      │
│  ₹98k ┤   ╱╲   ╱    ╲  ╱      ╲    ╲         │ AAPL       3 @ $310    +$12       │
│       ┤ ╱    ╲╱      ╲╱          ╲           ├─ RISK POSTURE ────────────────────┤
│       └───────────────────────────────       │ Max position   5% → 3.5% TIGHTENED│
│         drawdown ▁▂▅▃▁▂▇▅▂                   │ Daily stop     2% → 1.4%          │
├─ LOSS LEDGER ────────────────────────────────┴───────────────────────────────────┤
│ CAUSE                        COUNT   TOTAL     LESSON                             │
│ stop_loss on gap-down          4    -₹1,240   "Gap risk not modelled overnight"   │
│ time_limit with no edge        3      -₹340   —                                   │
│  ▲ 3+ occurrences becomes a lesson with citations, and tightens posture           │
└───────────────────────────────────────────────────────────────────────────────────┘
```

---

## EXECUTE · view 1 — Proposals

```
┌─ PROPOSAL ──────────────────────────────────────────────────────────────────────────┐
│ RELIANCE.NS · BUY · from strategy sma_cross_v2 (paper challenger, 47 fwd obs)       │
│                                                                                      │
│   Quantity     12          Entry ₹1,290 limit      Stop ₹1,225 (-5.0%)              │
│   Target       ₹1,420      Max loss ₹780           R:R 2.0                           │
│   Expires      09:20 IST   Evidence snapshot #a91f (immutable)                        │
│                                                                                      │
│   RISK GATE   ALLOW_FOR_CONFIRMATION · policy v4                                     │
│     ✓ position ≤ ceiling   ✓ daily loss headroom   ✓ correlation < 0.6              │
│     ⚠ data quality PARTIAL — quant core offline                                      │
│                                                                                      │
│   ┌──────────────────────────────────────────────────────────────────────────────┐  │
│   │ This software cannot place this order. Place it yourself with your broker.    │  │
│   │ [ Copy order ticket ]   [ Mark as placed ]   [ Reject with reason ]           │  │
│   └──────────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

No button submits an order. `Mark as placed` records what the owner did so forward outcomes can
be tracked; it does not transmit anything.

---

## Route map (old → new)

| Old | New |
|---|---|
| `/command`, `/system`, `/jobs`, `/audit` | `/research` (Command) |
| `/premarket`, `/dashboard`, `/scanner`, `/news`, `/watchlist` | `/research/premarket` |
| `/strategies`, `/experiments`, `/simulations`, `/edge-factory` | `/research/studio` |
| `/memory`, `/library`, `/research`, `/analyst`, `/ai` | `/research/memory` |
| `/paper`, `/portfolio` | `/research/paper` |
| `/trades`, `/settings`, `/data-quality`, `/learning` | `/execute`, plus settings in the chrome |

Old routes redirect rather than 404, so nothing already open in a tab breaks.

---

## Motion rules

Movement is for **state change**, never decoration.

| Element | Motion | Why |
|---|---|---|
| Ticker tape | 32s linear scroll, pause on hover | Reads as a live market |
| Price | 400ms flash green/red on change | The change is the information |
| Panels | Staggered 60ms entrance | Establishes reading order |
| Memory edges | 2.2s dash flow | Direction of provenance |
| Activity feed | New row slides in | Something happened just now |
| Cycle running | Pulsing dot in the autonomy strip | Work in progress |

All of it disabled under `prefers-reduced-motion`.
