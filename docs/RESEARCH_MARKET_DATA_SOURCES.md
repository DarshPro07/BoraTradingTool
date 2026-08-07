# Market data sources — research

**2026-08-07.** Companion to [`DATA_QUALITY_ANALYSIS.md`](./DATA_QUALITY_ANALYSIS.md), which
covers what this system currently runs on and why it is thin.

Sourced from web research, cited inline. Where a commercial term is not published, this says so
rather than estimating — an invented price is the same class of error as an invented backtest.

---

## 1. The four levels, and which one this system needs

NSE distributes real-time data at four levels: **Level 1, Level 2, Level 3, and tick-by-tick**,
across Capital Market, F&O, Currency Derivatives and Wholesale Debt.
([NSE](https://www.nseindia.com/static/market-data/real-time-data-subscription),
[TrueData](https://www.truedata.in/blog/levels-real-time-data-nse-bse-mcx))

| Level | Content | Needed for |
|---|---|---|
| **Level 1** | Last trade, best bid/ask | Quotes, daily bars — *what this system uses today* |
| **Level 2** | **5 best bid/ask price levels** (MBP) | Depth, fill feasibility, Bookmap-style order flow |
| **Level 3** | 20 price levels | Serious order-flow work |
| **Tick-by-tick** | Every event | MT5-style 100% modelling quality |

The honest read for MarketPulse: **the jump that matters is not Level 1 → Level 2.** It is
*daily bars → intraday bars*. Depth answers "could this size have filled?"; intraday resolution
answers "did the stop or the target come first?" — and the second question invalidates far more
backtests than the first.

---

## 2. Providers found

| Provider | Coverage | History | Notes |
|---|---|---|---|
| [**ICE**](https://developer.ice.com/fixed-income-data-services/catalog/national-stock-exchange-india-nse) | NSE | **Up to 15 years** tick-level L1/L2/L3 | Institutional. Pricing not published. |
| [**LSEG**](https://www.lseg.com/en/data-analytics/financial-data/pricing-and-market-data/equities-market-data/national-stock-exchange-india) | NSE | **Back to 1994**; 1-second snapshots of L1, L2 (5 levels), L3 (20 levels), plus tick-by-tick | Deepest history found. Institutional. |
| [**TickData**](https://www.tickdata.com/equity-data/national-stock-exchange-of-india) | All NSE equities | **Since 2012-01-02**, historical intraday | Historical only — a research archive, not a live feed. |
| **NSE authorised vendors** | NSE | Varies | NSE requires data be taken through an authorised vendor. ([NSE](https://www.nseindia.com/static/market-data/real-time-data-subscription)) |
| [**TrueData**](https://www.truedata.in/blog/levels-real-time-data-nse-bse-mcx) | NSE/BSE/MCX | Varies | Retail-oriented Indian vendor. |
| **Finnhub** *(in use)* | US + some intl | ~Years, daily | Free tier. `lib/providers/finnhub.ts`. |

**Not verified:** none of the pricing, licence terms, redistribution rights or API shapes above
were confirmed — these are catalogue descriptions, not quotes. Treat every row as a lead.

---

## 3. The licensing constraint that shapes the decision

NSE requires data to be taken through an **authorised vendor**
([NSE](https://www.nseindia.com/static/market-data/real-time-data-subscription)). Exchange market
data is licensed, and terms typically distinguish *internal use* from *redistribution* and
*display*.

For this system that is mostly favourable: it is a single-owner local research tool that
redistributes nothing and displays to one person. But it is the owner's obligation to confirm,
and it is the reason a free scraped feed and a licensed one are not interchangeable even when the
numbers match.

---

## 4. What to change in this repository

The provider seam already exists — `lib/providers/`, with a contract test at
`lib/providers/market-contract.test.ts`. Adding a source means implementing that interface, not
restructuring anything.

**Step 1 — measure before buying.** Record modelling quality on every trial before spending money
on data. `trials.metrics` is already a JSON column, so this needs no migration (which matters:
`lib/db/migrate.ts` holds a hardcoded migration list and is owner-reviewed, so new migration files
are never applied).

```
resolution: "D" | "15m" | "1m" | "tick"
bars, instruments, gapRatio
costModel: "fixed_bps" | "variable_spread"
depth: null | 5 | 20
```

A gauntlet verdict then carries the conditions it was earned under, and "passed" stops meaning two
different things.

**Step 2 — intraday before depth.** Moving from daily to 15-minute bars removes the intrabar
ambiguity that decides stop-versus-target. Depth is a larger spend for a narrower question.

**Step 3 — India instruments.** `lib/paper/fees.ts` implements the full Indian schedule (STT,
intraday versus delivery, the ₹20 brokerage ceiling) and `lib/market/calendar.ts` knows NSE
sessions. Both are built, tested, and carry no live data. Adding NSE names to
`lib/market/catalog.ts` activates work that already exists.

**Step 4 — depth, only if order-flow strategies are actually wanted.** Nothing in the current DSL
can express a book-based rule; `DERIVABLE_FEATURES` in `lib/backtest/features.ts` is entirely
price and volume. Buying depth data before the DSL can use it would buy a feed nothing reads.

---

## 5. Owner decisions — 2026-08-07

| Question | Answer | Consequence |
|---|---|---|
| Market | **Both India and US** | NSE instruments must enter `lib/market/catalog.ts`. The India fee schedule and session calendar are already built and currently carry no data. |
| Intraday | **In scope** | Daily bars are no longer sufficient. The intrabar stop-versus-target ambiguity becomes a live correctness problem, not a theoretical one. |
| Paid data | **No** | §2 is now reference only. Everything must come from free tiers. |

### What "free tier + intraday + both markets" actually permits

This combination is the binding constraint on the whole system, so it is stated plainly rather
than discovered later:

- **Every provider in §2 is out.** ICE, LSEG, TickData and the NSE authorised-vendor route are all
  paid. They remain documented as the answer to "what would it take", not as a plan.
- **Free intraday is shallow.** Free tiers characteristically offer minute bars over a short
  window (days to a few months), not years. Free *tick* data and free *depth* effectively do not
  exist for NSE — which settles §4 below: depth is out of scope, permanently, under these
  constraints.
- **The gauntlet's arithmetic changes.** A strategy needs ≥30 trades for the simulation battery.
  On daily bars over 3 years that is hard; on 15-minute bars over even 60 days it is easy — but
  those trades come from one short window, in one regime. **More trades from less history is not
  more evidence.** The trial count rises while the independent information does not, which is
  exactly the condition the deflated Sharpe exists to punish.

That last point is the real risk of this configuration, and it argues for recording history depth
and regime coverage on every trial — see step 1 below — before any intraday strategy is trusted.

### Revised plan under these constraints

1. **Modelling-quality metric on every trial** (unchanged, now more urgent). Must include
   `historyDays` and `regimesCovered` alongside resolution, so a 60-day intraday pass cannot be
   mistaken for a 3-year daily one.
2. **Survey free intraday providers for NSE and US**, recording each one's *actual* granted limits
   — verified against the live API, not the marketing page. This is the next research task and it
   has not been done.
3. **Add NSE instruments** to the catalogue. Activates fee and calendar code already written.
4. **Depth: out of scope.** No free source exists, and the DSL cannot express a book-based rule
   anyway — `DERIVABLE_FEATURES` is entirely price and volume.

---

## Sources

- [NSE — Paid real-time data subscription](https://www.nseindia.com/static/market-data/real-time-data-subscription)
- [TrueData — The 4 levels of real-time data from NSE, BSE & MCX](https://www.truedata.in/blog/levels-real-time-data-nse-bse-mcx)
- [ICE Developer Portal — NSE](https://developer.ice.com/fixed-income-data-services/catalog/national-stock-exchange-india-nse)
- [LSEG — National Stock Exchange of India](https://www.lseg.com/en/data-analytics/financial-data/pricing-and-market-data/equities-market-data/national-stock-exchange-india)
- [TickData — NSE equity data](https://www.tickdata.com/equity-data/national-stock-exchange-of-india)
