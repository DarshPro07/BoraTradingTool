# Data quality — what this system runs on, and why it is not enough

**Status: 2026-08-07.** Written after the owner supplied seven videos on market-data quality.

---

## ⚠ Provenance of this document — read first

The videos were **not watched.** `/watch` requires running a Python script, and
`.claude/hooks/guard-writes.mjs` permits only a fixed allowlist of read-only commands. Every
invocation was denied before it started.

So this file separates three kinds of statement, and never blends them:

| Marked | Means |
|---|---|
| **[TITLE]** | Known only from the video title fetched off the YouTube page. The *topic* is known; nothing the presenter said is. |
| **[WEB]** | From web research, with a citation. |
| **[CODE]** | Verified by reading this repository's source. The strongest claims here. |

Nothing in this document reports video content. Where a video's topic is named, that is the topic
and not a summary — see §5 for how to fill that gap.

---

## 1. The seven videos

| # | Title | Topic bearing on this system |
|---|---|---|
| 1 | Build a Complete AI Trading System with Claude AI — Face2Face with Ankit Rai | Architecture; adjacent to data |
| 2 | I Backtested 21 Years of Market Data in 6 Seconds with ChatGPT | History depth; LLM-driven backtesting |
| 3 | Market Data Feeds (everything you need to know) | Feed types and levels |
| 4 | **100% History Quality in the MT5 Tester using the Tick Data Suite** | **Modelling quality — the central one** |
| 5 | How To Get Nifty and Bank Nifty Historical Data On Google Sheet | India data acquisition, free tier |
| 6 | **Is NSE Level 2 data enough for BOOKMAP INDIA** (Hindi) | **Market depth sufficiency** |
| 7 | *100 Days of Hell with Python Algo Trading?* (playlist) | Practitioner failure modes |
| 8 | AI Agent That Beats ChatGPT in Stock Analysis (Full Guide 2025) | Agent architecture; adjacent to data |

Four of eight are about data quality rather than strategy. That selection is itself the finding:
the owner identified data as the bottleneck before this analysis existed.

### Why none of these were watched, and what it would cost to watch them properly

The owner asked for **1 frame per second**. Two limits apply:

1. `/watch` clamps to **2 fps maximum** and to a per-mode frame cap (`balanced` = 100,
   `token-burner` = uncapped). 1 fps is reachable, but only via `--fps 1 --detail token-burner`.
2. At 1 fps a ten-minute video is **600 frames ≈ 400k+ image tokens** — more than a whole session's
   context for one video, let alone eight.

1 fps is the right setting for a **short clip or a focused window** (`--start`/`--end` around the
part that matters). For eight full videos it is not reachable in one session at any quality. The
honest plan is transcripts for all eight first, then 1 fps on the specific windows the transcripts
identify as visually load-bearing — which is what `--timestamps` exists for.

---

## 2. What this system actually runs on **[CODE]**

| Dimension | Current state | Source |
|---|---|---|
| Resolution | **Daily bars** | `lib/learning/dataset.ts` — `resolution: "D"` |
| History | **3 years** | `dataset.ts` — `LOOKBACK_SECONDS = 3 * 365 * 86_400` |
| Breadth | **12 instruments** | `dataset.ts` — `REHEARSAL_SAMPLE_SIZE = 12` |
| Universe | US-heavy hand-curated list | `lib/market/catalog.ts` |
| Costs | **Fixed basis points** | DSL `costs: { commissionBps, slippageBps }` |
| Depth / book | **None** | no Level 2 anywhere in the repo |
| Fill model | Next bar's open | `lib/backtest/engine.ts` |
| Provider | Finnhub, free tier | `lib/providers/finnhub.ts` |
| Modelling quality | **Not measured, not reported** | — |

### The breeding problem this creates **[CODE]**

`lib/factory/generation.ts` screens a population of 100 candidates against **one** series — the
longest in the dataset (`referenceSeries`). On a single daily series of ~750 bars, ranking 100
candidates does not find edge. It finds whichever candidate best fits one instrument's noise.

The 250-bar floor in `runFactoryGeneration` prevents the worst case. It does not make one series
sufficient.

---

## 3. The gap the MT5 video names **[TITLE]** + **[CODE]**

MT5's tester reports a **modelling quality** percentage. Reaching 99–100% requires real tick data
with real variable spread, because anything coarser leaves the engine guessing what happened
*inside* each bar.

The question that decides it: **a stop and a target both touched during one bar — which filled
first?** On daily bars there is no answer in the data. The engine picks. That single assumption
can invert a strategy's reported profitability.

| MT5 "100% quality" | This system **[CODE]** |
|---|---|
| Real tick data | Daily OHLC |
| Real variable spread | Fixed bps, constant across regimes |
| Intrabar sequence known | Assumed |
| Quality reported per test | **Never reported** |

This repository is more honest than most retail backtesters — entry is on the *next* open, not the
signal bar's close, so there is no same-bar fill fantasy. But **it has no concept of modelling
quality**, which means a gauntlet pass on daily bars and a gauntlet pass on tick data print the
same number. That is the same defect pattern corrected elsewhere in this codebase all day:
two different epistemic situations rendering identically.

---

## 4. The depth gap **[TITLE]** + **[CODE]**

NSE Level 2 is the bid/ask ladder — 5 price levels each side **[WEB]**, not the last traded price.

`lib/paper/engine.ts` fills a paper order at a quote. `lib/risk/gate.ts` enforces `maxContracts`.
**Neither knows whether that size could have filled.** With one price per day and no book, a paper
fill of any size at any price is modelled as free.

`lib/backtest/portfolio.ts` does track `signalsRejectedForCapacity`, so position-count capacity is
modelled. **Liquidity capacity is not.** A strategy that would move the book is indistinguishable
from one that would not.

---

## 5. What would close the video gap

The topics are known; the content is not. To get the content, either:

**Run it yourself** — output lands in the conversation:
```
! python "C:\Users\marke\.claude\plugins\cache\claude-video\watch\0.2.0\skills\watch\scripts\watch.py" "<url>" --detail transcript
```

**Or allowlist it** — add the `python …\claude-video\watch\` prefix to the command allowlist in
`.claude/hooks/`. That file is hook-protected and only the owner can change it.

For the playlist: `yt-dlp --flat-playlist --print "%(url)s" "<playlist-url>"` lists the URLs; the
watch script takes one at a time.

---

## 6. Recommended order of work

1. **Modelling-quality metric on every trial.** Resolution, bar count, instrument count, gap
   ratio, cost-model fidelity — recorded with each gauntlet run. Cheapest high-value fix, and it
   stops "passed" from meaning two different things. No new table needed: `trials.metrics` is
   already a JSON column.
2. **Data-quality gate before breeding.** Minimum bars, gap detection, and screening across
   several instruments instead of the longest one. Blocks the overfitting mode §2 describes.
3. **Widen the universe** to include NSE names, so the India fee schedule in `lib/paper/fees.ts`
   and the session calendar in `lib/market/calendar.ts` — both already built and tested — carry
   real data instead of sitting unused.
4. **Depth data** last. It is the most expensive and the least useful until 1–3 are done.

See [`RESEARCH_MARKET_DATA_SOURCES.md`](./RESEARCH_MARKET_DATA_SOURCES.md) for the provider
landscape behind step 3.
