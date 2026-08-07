/**
 * Intake record: two Humbled Trader sources on wiring Claude into a trading workflow.
 *
 *   A. "I Built an AI Trading System With Claude + TradingView" (31:20, captions)
 *   B. "I Replaced my 6AM Premarket Trading Routine with Claude + Codex" (23:29)
 *      plus its full write-up at humbledtrader.com/blog/claude-codex-ai-premarket-analyst/
 *
 * Run: npx tsx --tsconfig tsconfig.json scripts/intake/humbled-trader-ai-pipeline.ts
 *
 * Both sources are monetised (referral links to TradingView and to the products taught).
 * Neither presents a backtest, win rate, or forward performance for the pipeline itself.
 */
import {
  recordSource,
  recordClaim,
  recordHypothesis,
  recordLesson,
  recordConcept,
  linkConcepts,
  recordFailure,
  traceForward,
} from "@/lib/knowledge/repository";

console.log("=== INTAKE: Humbled Trader AI pipeline sources ===\n");

// ---------------------------------------------------------------- Source A ---
const tradingViewSource = recordSource({
  kind: "video",
  title: "Humbled Trader — I Built an AI Trading System With Claude + TradingView",
  url: "https://www.youtube.com/watch?v=IqvnryFzZD4",
  locator: "31:20, captions, watched 2026-08-06",
  license: "All rights reserved (YouTube standard)",
  authors: ["Humbled Trader"],
  content: `Connects Claude Code to the TradingView DESKTOP app via a community MCP server
(~2.9k GitHub stars) so Claude can read chart source, switch timeframes, and draw levels
(52-week highs/lows, prior-day highs/lows, pre-market highs/lows, all-time highs).

Demonstrated pipeline: pre-market gap scanner -> news briefing -> strategy definition ->
Pine Script backtest on TradingView -> alerts pushed to phone. Also covers TradingView's
own beta AI.

HARD PLATFORM CONSTRAINT (stated explicitly): the connection works on macOS. The presenter
tried it on a PC first and it did not work, attributed to a different desktop build on the
Microsoft distribution.

COSTS: Claude Code paid plan >= $20/mo (presenter uses the $100/mo Max plan); TradingView
paid desktop subscription >= ~$13-15/mo (essential tier); referral link offered.

STATED CAVEAT (verbatim sense): "AI is mostly just slop without specialized knowledge behind
it... AI won't magically make you profitable. You need real trading experience first."

NOT PRESENTED: any backtest result, win rate, expectancy, or forward performance for the
pipeline itself.`,
});
console.log(`1. SOURCE A ${tradingViewSource.id} (created=${tradingViewSource.created})`);

// ---------------------------------------------------------------- Source B ---
const premarketSource = recordSource({
  kind: "documentation",
  title: "Humbled Trader — Claude + Codex AI Premarket Analyst (video 23:29 + full write-up)",
  url: "https://www.humbledtrader.com/blog/claude-codex-ai-premarket-analyst/",
  locator: "blog post and companion video PKFkJ4TprVo, read 2026-08-06",
  license: "All rights reserved",
  authors: ["Humbled Trader"],
  content: `A keyless pre-market analyst pipeline delivering an emailed HTML report before the open.

ARCHITECTURE
  scan.py collects raw data ONLY into packet.json and performs ZERO analysis.
  Two models then read that same packet independently and never see each other's output.
  A merge step fills a fixed REPORT_TEMPLATE.md, keeping each model's calls attributed.

DATA (all free, no API key)
  yfinance      market snapshot (9 instruments), day_gainers + most_actives screeners,
                5-min bars for pre-market high/low/VWAP, 1-year daily bars for 200-day SMA
  feedparser    RSS from MarketWatch, CNBC, Yahoo Finance, Google News Markets
  requests      ForexFactory free econ calendar JSON, cached 4 hours

DETERMINISTIC ELIGIBILITY FLAGS (computed in code, before any model sees the data)
  day_eligible   : gap > 3%, price > $3, market cap > $1B, RVOL > 1.5, price > prior high
  swing_eligible : gap >= 8%, price > $3, open > prior high, open > 200-day SMA,
                   market cap >= $800M, real catalyst present
  Pre-filter to gap >= 4% and price >= $3, top 12 movers.

PROMPT CONTRACTS (quoted)
  prompt_claude.md : "Use ONLY packet data. Never invent catalysts, numbers, or headlines.
                      Treat catalyst_found:false as a SKIP."
  prompt_codex.md  : "It gets ONE input, packet.json; it has NOT seen anyone else's analysis
                      and must not ask for it; form its own read."
  prompt_merge.md  : "Claude's calls stay Claude's, Codex's stay Codex's. NEVER average or
                      rewrite either side's conviction."
  Conviction key: green = both agree, yellow = conflict, red = disagreement. The report ends
  with a "Where the two brains landed" section.

DELIVERY: markdown -> HTML via python-markdown, styled, written to reports/premarket_DATE.html,
emailed via Resend (free tier, sandbox sender only delivers to the account's own address).

STATED LIMITATIONS
  "The rules pick the watchlist, the two AIs judge quality, and you are still the one who
   makes the trade."
  "This is decision support, not signals."
  yfinance reports ~0 pre-market volume, so a true pre-market RVOL needs a pre-market feed
  (e.g. Alpaca); full-day relative volume is the keyless stand-in.
  Market-wide earnings coverage only partial; intraday levels need intraday bars.
  Does NOT place trades. Execution deferred to a separate IBKR part 2.

COSTS: Claude Pro $20/mo + ChatGPT Plus $20/mo; $0 marginal if already subscribed.

NOT PRESENTED: any backtest, win rate, expectancy, sample size, or forward performance for
the pipeline or for the eligibility thresholds.`,
});
console.log(`2. SOURCE B ${premarketSource.id} (created=${premarketSource.created})`);

// ------------------------------------------------------------------ Claims ---
const claims: Record<string, string> = {};
const add = (key: string, sourceId: string, statement: string, status: "known" | "inferred", extra: { locator?: string; confidence?: number; indiaRelevant?: boolean } = {}) => {
  claims[key] = recordClaim({ sourceId, statement, epistemicStatus: status, ...extra });
  console.log(`   CLAIM [${status}] ${statement.slice(0, 68)}...`);
};

console.log("\n3. CLAIMS");
add(
  "macos",
  tradingViewSource.id,
  "The TradingView-to-Claude MCP connection is demonstrated working on macOS only; the presenter states it failed on a PC due to a different desktop build.",
  "known",
  { locator: "~04:30", confidence: 0.9, indiaRelevant: true },
);
add(
  "separation",
  premarketSource.id,
  "Separating data collection from judgement — a collector that performs zero analysis and writes one packet, with models reading only that packet — prevents a model from inventing inputs it was never given.",
  "known",
  { confidence: 0.9, indiaRelevant: true },
);
add(
  "dualbrain",
  premarketSource.id,
  "Running two models independently over the same evidence packet, with neither seeing the other's output, and merging without averaging their conviction, surfaces disagreement as a signal rather than hiding it in a blend.",
  "known",
  { confidence: 0.9, indiaRelevant: true },
);
add(
  "gates",
  premarketSource.id,
  "Deterministic eligibility computed in code before any model sees the data: day_eligible = gap>3%, price>$3, mcap>$1B, RVOL>1.5, price>prior high; swing_eligible = gap>=8%, price>$3, open>prior high, open>200-day SMA, mcap>=$800M, real catalyst.",
  "known",
  { confidence: 0.9, indiaRelevant: false },
);
add(
  "rvol",
  premarketSource.id,
  "yfinance reports approximately zero pre-market volume, so a pre-market relative-volume figure computed from it is not a true RVOL; full-day relative volume is a stand-in that changes what the number means.",
  "known",
  { confidence: 0.9, indiaRelevant: true },
);
add(
  "unvalidated",
  premarketSource.id,
  "Neither source presents a backtest, win rate, expectancy, sample size, or forward performance for the pipeline or for its eligibility thresholds.",
  "known",
  { confidence: 0.95, indiaRelevant: true },
);

// ---------------------------------------------------------------- Concepts ---
const separation = recordConcept(
  "system",
  "Collector/judge separation",
  "The component that gathers evidence performs no analysis, and the component that analyses can read nothing but that evidence. Removes the path by which a model supplies its own inputs.",
);
const dualBrain = recordConcept(
  "system",
  "Independent second opinion",
  "Two analysts read identical evidence without sight of each other. Agreement raises confidence; disagreement is reported, never averaged away.",
);
linkConcepts(separation, dualBrain, "prerequisite_of");
console.log(`\n4. CONCEPTS ${separation}, ${dualBrain}`);

// -------------------------------------------------------------- Hypothesis ---
const hypothesis = recordHypothesis({
  claimId: claims.dualbrain,
  title: "Model disagreement as a risk filter",
  statement:
    "On a shared evidence snapshot, instruments where two independently-prompted models reach opposing stances resolve worse than instruments where they agree. If so, disagreement is usable as a skip filter rather than merely as display.",
  rationale:
    "The source treats disagreement as something to show the reader. Whether it carries information is an empirical question this system can answer, because every analysis is already stored against a server-issued snapshot hash and forward outcomes are tracked separately.",
  market: "NSE",
  createdBy: "claude_code",
});
console.log(`5. HYPOTHESIS ${hypothesis}`);

// ------------------------------------------------------------- Limitations ---
const macosFailure = recordFailure(
  "system",
  "tradingview_mcp_macos_only",
  "The TradingView-to-Claude MCP integration is demonstrated on macOS and reported by the source as not working on PC. This operator runs Windows 11, so that integration path is unavailable without either a macOS machine or a different chart-data route.",
  undefined,
  "Do not plan chart-drawing or Pine Script work around the TradingView MCP on this machine. Use the quant core's own data path instead.",
);
const rvolFailure = recordFailure(
  "data",
  "premarket_rvol_is_not_rvol",
  "A relative-volume figure derived from a feed that reports ~0 pre-market volume is a full-day RVOL wearing a pre-market label. Any gate written as 'RVOL > 1.5 pre-market' silently means something different from what it says.",
  undefined,
  "State the measurement window alongside any relative-volume threshold, and check the feed actually carries pre-market prints before trusting one.",
);
console.log(`6. LIMITATIONS recorded as failure memory #${macosFailure}, #${rvolFailure}`);

// ------------------------------------------------------------------ Lesson ---
const lesson = recordLesson({
  conceptId: dualBrain,
  plane: "system",
  level: "quant",
  title: "Two brains, one packet, no averaging",
  body: `The strongest idea in these sources is structural, not about markets. The collector writes one packet and performs zero analysis. Two models then read that packet — and nothing else — with neither able to see the other's output. A merge step fills a fixed template while keeping each model's calls attributed, under an explicit instruction never to average or rewrite either side's conviction.

That last constraint is the interesting one. Averaging two opinions destroys exactly the information you most want: where they diverge. Blending a bullish and a bearish read into a mild positive produces a number that no analyst actually holds, and it hides the fact that the evidence supported two readings. Keeping them separate turns disagreement into a visible state.

This system already has the hard parts. Analyses are bound to a server-issued evidence snapshot, so two models can be guaranteed identical inputs by construction rather than by convention. Both an Anthropic and an OpenAI adapter already exist behind one interface. What is missing is running them independently over the same snapshot and treating the divergence as a first-class result.

Worth separating what the sources establish from what they assert. The architecture is demonstrated and reproducible. The specific thresholds — gap > 3%, RVOL > 1.5, market cap > $1B — are stated without any backtest, win rate, sample size, or forward performance behind them, in either source. And one of them does not mean what it says: the free feed reports roughly zero pre-market volume, so the pre-market RVOL gate is really a full-day figure. A threshold whose measurement window is wrong is worse than no threshold, because it looks specific.`,
  citations: [premarketSource.id, claims.dualbrain, claims.separation, claims.rvol, claims.unvalidated],
});
console.log(`7. LESSON ${lesson}`);

for (const [label, id] of [["A", tradingViewSource.id], ["B", premarketSource.id]] as const) {
  const trace = traceForward(id);
  console.log(`   TRACE ${label}: ${trace.nodes.length} nodes, ${trace.edges.length} edges`);
}
console.log("\nINTAKE COMPLETE — decision: ADAPT (dual-brain disagreement is worth building; thresholds are unvalidated; TradingView MCP is macOS-only and unavailable here)");
