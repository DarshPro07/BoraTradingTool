# PRD — MarketPulse Autonomous Paper Fund

2026-09-19. Owner: "it should be automated — every trade, every strategy, every metric, every
decision — on NSE and crypto … first it gets my trust that it can earn me … AutoHedge fund code too."

## 1. The problem

The owner wants a system that runs a portfolio of strategies by itself and proves, before any real
money moves, that it can earn. Today:

- **Nothing trades by itself.** The desk (`trading-desk` skill) needs a Claude Code session for
  every pass.
- **Nothing measures a strategy as a fund would.** There is no equity curve, no benchmark, no
  drawdown and no track record.
- **"Can it earn?" has no defined answer.** It has no threshold and no time horizon, so no
  outcome could ever earn trust or lose it.

## 2. Who

A single owner in India with small real capital (₹1,000 stated), who places real orders manually
today and wants that to change once the system has proved itself.

## 3. What "earn my trust" means

Trust is earned by a **forward record**, meaning decisions committed before their outcomes existed.
Backtests are never used for it. Five probes on this data found no edge in backtests, and published
backtests of simple rules routinely fail forward. So:

1. **Strategies are frozen before any result is seen.** Each is a published rule with fixed
   parameters and a hash-pinned contract. No parameter is ever tuned on this data.
2. **Every decision is recorded before its outcome exists.** Ledger rows are append-only
   (`audit_events`, protected by a BEFORE DELETE trigger), and that includes the no-trade decisions.
3. **The expectations are declared up front,** including when the honest expectation is "will not
   beat buy-and-hold on return".
4. **Three numeric trust gates** are frozen in code (§7). The system reports its gate status. It
   **never** switches to real money itself.

## 4. Strategy mandates, v1

All are rule-based and deterministic, and chosen from published evidence, not from our data.

| id | market | rule | evaluated | benchmark | declared prior |
|---|---|---|---|---|---|
| **FN1** NIFTY trend core | NSE | hold NIFTYBEES while its close is above its 200-session SMA, else cash | last session of each month (Faber 2007: monthly checks cut whipsaw) | buy-and-hold NIFTYBEES | **lower drawdown, likely lower return** than buy-and-hold; a 2010–22 NIFTY study found the daily 50/200 variant underperformed on return and cut drawdown only modestly |
| **FC1** SOL trend | Solana | hold SOL while its trailing 28-day return is positive, else USDC | weekly, at the Monday 00:00 UTC close | buy-and-hold SOL | time-series momentum is documented for BTC (Liu & Tsyvinski); **transfer to SOL is UNPROVEN** |
| **FC2** BTC trend | Solana (WBTC) | the same rule on BTC | weekly | buy-and-hold BTC | documented for BTC; costs and venue (a Solana wrapped token) differ from the studies |

Capital: the NSE book is ₹25,000 paper, and FN1's sleeve is limited by the risk kernel's 15% cap
(₹3,750). The crypto book is 300 USDC: FC1 and FC2 get 25% each. Returns are measured as a
percentage of each sleeve.

Candidates that are deliberately **not** in v1:
- **V01** (return × volume): awaiting independent confirmation. Running it here would mix a
  research question with the fund record.
- **Momentum on this cohort**: rejected by M02 and M01.
- **Anything intraday**: no strategy has evidence yet.

## 5. User journeys

1. **The owner does nothing.** The Windows cycle evaluates mandates on schedule, places paper
   orders at the next open (NSE) or immediately (crypto), marks every sleeve daily, and updates
   the gates.
2. **The owner opens `/fund`.** They see each mandate:
   - its rule, its prior, and its sleeve value against the benchmark;
   - drawdown, trades and costs;
   - its gate status;
   - the decision log with every input.
3. **The owner asks Claude Code "how is the fund doing?"** A read-only report is built from the
   same ledger.
4. **A mandate breaches its kill rule.** It goes flat and stops trading. The breach is a recorded
   decision, and it resumes only by owner action.
5. **All three gates pass.** `/fund` shows "eligible to propose live". The owner decides; the
   Kite or wallet work described in `autohedge-intake` begins only then.

## 6. Every metric

Tracked per mandate and for the whole fund, each against its benchmark over the same window:
- sleeve NAV series;
- total return;
- max drawdown;
- volatility;
- daily Sharpe;
- excess return;
- trades and turnover;
- costs paid;
- hit rate;
- days live;
- decisions recorded;
- days of track record still needed (MinTRL).

## 7. Trust gates (frozen)

| gate | passes when |
|---|---|
| **T1 Operational** | ≥ 30 days live; every scheduled decision date has a ledger row; every failed order has a recorded reason |
| **T2 Behaves as declared** | ≥ 90 days live and ≥ 3 decision points; the mandate's declared benefit holds against its benchmark over the same window (FN1: max drawdown ≤ benchmark's; FC1/FC2: return ≥ benchmark's **and** max drawdown ≤ benchmark's) |
| **T3 Statistical** | Minimum Track Record Length (Bailey & López de Prado, 2012) for Sharpe > 0 at 95% confidence is met by live daily returns. At a Sharpe of 1 that is about 2.7 years: trust at this level takes time, and the page shows the countdown |
| **LIVE** | T1 + T2 + T3 **and** explicit owner approval. Never automatic |

Kill rules: sleeve drawdown beyond 25% (FN1) or 50% (FC1/FC2) means flat and suspended.

## 8. AutoHedge mapping

AutoHedge's desk becomes deterministic code where it matters.

| Role | Implementation |
|---|---|
| Director | mandate scheduler |
| Quant | rules on computed bars |
| Risk | sleeve limits, kill rules, risk kernel |
| Execution | paper engines |

The LLM roles, Director review and news, stay in the `trading-desk` skill as an **advisory**
layer. They can record analyses and flags, but they cannot place fund orders. A scheduled
headless Claude Code review is a later, owner-approved phase, because it uses the owner's
subscription quota.

## 9. Non-goals

- Real-money execution of any kind.
- Tuning any parameter on this data.
- Leverage or margin.
- Shorting.
- Tax modelling. The report states that Indian crypto gains are taxed at 30% plus 1% TDS, and
  that equity has STCG/LTCG.

## 10. Failure conditions (the build is wrong if…)

- a decision date passes with no ledger row;
- any metric is computed from a price the ledger does not cite;
- a mandate's parameters change after registration without a new id and hash;
- the page or report shows "earning" language before T2;
- anything can move toward real money without owner action.

## Research sources

- Faber, *A Quantitative Approach to Tactical Asset Allocation* (2007): monthly 10-month SMA timing.
- Trend-following on the Nifty 50, 2010–2022: https://zenodo.org/records/21308597
- Liu & Tsyvinski, *Risks and Returns of Cryptocurrency* (RFS 2021): BTC time-series momentum.
  Summaries: https://link.springer.com/article/10.1057/s41283-026-00234-7 ·
  https://www.sciencedirect.com/science/article/abs/pii/S1062940821000590
- Bailey & López de Prado, *The Sharpe Ratio Efficient Frontier* (2012): MinTRL.
- SEBI retail algo framework, binding since 2026-04-01; under 10 orders/sec needs no algo
  registration: https://www.sebi.gov.in/legal/circulars/sep-2025/extension-of-timeline-for-implementation-of-sebi-circular-dated-february-04-2025-on-safer-participation-of-retail-investors-in-algorithmic-trading-_96979.html
- AutoHedge audit: `docs/plans/autohedge-intake/01-reality.md`.
