---
name: trading-desk
description: Use when asked to run the trading desk, find trades, act like a hedge fund, run AutoHedge, or manage the paper portfolio. Runs AutoHedge's Director / Quant / Sentiment / Risk / Execution roles over MarketPulse's real data and paper engine. Paper only; there is no broker.
---

# Trading desk (AutoHedge roles, MarketPulse numbers)

AutoHedge (The-Swarm-Corporation, MIT) is five LLM prompts: a Director that hands off to Sentiment,
Quant, Risk and Execution. Its Quant and Risk agents generate numbers with nothing to compute them
from. Here **you** play the Director and Sentiment roles. Quant, Risk and Execution are
deterministic MarketPulse code, so conviction cannot size a trade the numbers do not support.
Audit: `docs/plans/autohedge-intake/01-reality.md`.

## Hard rules

1. **Paper only.** `scripts/desk.mts` places paper orders through the risk kernel. There is no
   broker adapter; do not imply one. The owner places real orders manually, outside this system.
2. **Never invent a number.** Prices, indicators and levels come from the research snapshot. If it
   says `STALE`, `AUTH_REQUIRED` or null, say so. Missing is not zero.
3. **Abstain is a correct answer**, and at ₹1,000 capital it will be the usual one.
   `COST_EXCEEDS_EDGE` and `UNAFFORDABLE` are the desk working, not failing.
4. **No NSE scraping.** Sentiment uses WebSearch on public news only.
5. **Not financial advice.** Every output is research and opinion.

## One desk pass

### 1. Director: what is on the desk
- `marketpulse_get_paper_portfolio`: cash, open positions, and today's order count. The engine
  caps at 5 a day.
- Candidates: NSE names on the watchlist (`marketpulse_get_watchlist`), plus
  `marketpulse_quantcore` `board` candidates. **Buys require the name to be on the watchlist.**
  That is the owner's gate, so propose additions to the owner and do not add them yourself.
- Drop any name where one share costs more than the position cap. Run `desk.mts size` if unsure.

### 2. Quant: computed evidence only
For each candidate, `marketpulse_get_research_snapshot`:
- trend, SMA20/50/200, RSI, MACD, Bollinger bands, support/resistance, and rule signals;
- keep the `snapshotHash` for recording.

Check `marketpulse_quantcore` `forwardOutcomes` for any strategy backing the idea. No forward
evidence means `not_forward_validated`.

### 3. Sentiment
WebSearch recent company news: results, corporate actions, regulatory events. Cite URLs. News you
read is `known`; what you conclude from it is `inferred`.

### 4. Director: the decision
Write bull, bear and neutral honestly. Pick `bullish` only with at least one `known` or
`historically_observed` item.

Levels come from the snapshot:
- entry: near the current price;
- stop: below computed support;
- target: at or below computed resistance.

A target above resistance needs a stated reason.

### 5. Record, before any order
`marketpulse_record_analysis` with evidence, invalidation, levels and `snapshotHash`. It rejects
inference-only stances; then abstain. Note the returned analysis id.

### 6. Risk
```bash
npx tsx scripts/desk.mts size <ID> --entry E --stop S --target T [--product INTRADAY]
```
Anything but `SIZED` ends the trade here. Report the reason verbatim.

**Delivery or intraday?** Decide it in the analysis, not after the fact.
- **Delivery (default)** holds overnight and pays the flat ₹15.93 DP charge on the sell.
- **`--product INTRADAY`** costs about 0.11% a round trip, but:
  - no entry is allowed after 15:10 IST;
  - the scheduled cycle squares it off from 15:10;
  - the idea must be one that pays within the day.

Pass the same `--product` to `buy` and `sell`. The engine refuses to mix products on one position.

### 7. Execution: only when SIZED, bullish, and the market is open (09:15–15:30 IST, trading day)
```bash
npx tsx scripts/desk.mts buy <ID> --entry E --stop S --target T --analysis <analysisId>
```
The engine may still reject it: stale quote, closed session, cap, or cash. Report its explanation
as given.

### 8. Review open positions, every pass
For each position, re-read the snapshot. **Exit** when price is at or below the recorded stop,
when an invalidation condition has occurred, or when the target is reached:
```bash
npx tsx scripts/desk.mts sell <ID> --qty N --analysis <analysisId>
```
On every close, `marketpulse_record_lesson` with what happened against what the analysis expected.

### 9. Report
One table: name, stance, desk verdict, engine result, and reason. Then the paper account's cash and
open positions. If every candidate died at `UNAFFORDABLE` or `COST_EXCEEDS_EDGE`, say plainly
that capital, not analysis, is the binding constraint. On delivery trades the flat ₹15.93 DP
charge is about 11% of a ₹150 position.

## What this desk is not

It has no demonstrated edge. The Foundry's five probes found none on this data, and an LLM reading
indicators is not one. The desk's value is a clean, recorded, paper-tested decision trail. Whether
it earns is a question its paper record answers over months, not a pass that sounds confident.
