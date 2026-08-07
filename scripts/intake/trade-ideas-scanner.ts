/**
 * Intake record: Humbled Trader — "Trade Ideas Scanner Tutorial 2026" (32:44).
 *
 * Run with: npx tsx --tsconfig tsconfig.json scripts/intake/trade-ideas-scanner.ts
 *
 * The source is a tutorial for a commercial scanner, published with a discount code for
 * that product. Its criteria are the presenter's discretionary preferences; no backtest,
 * cost model, or forward evidence appears anywhere in the video. This script records it
 * that way rather than laundering preferences into findings.
 */
import {
  recordSource,
  recordClaim,
  recordHypothesis,
  recordLesson,
  recordConcept,
  recordFailure,
  recordStrategySpec,
  traceForward,
} from "@/lib/knowledge/repository";
import { registerReproduction, recordObservation } from "@/lib/knowledge/reproductions";
import { compileStrategy } from "@/lib/strategy/dsl";

const CONTENT = `Humbled Trader — "Trade Ideas Scanner Tutorial 2026 (Scanner Settings Download)", 32:44,
watched via captions 2026-08-06. Commercial scanner tutorial; description carries a 15-30% discount
code and a Trade Ideas cloud strategy-share link.

LARGE/MID-CAP PRE-MARKET GAP SCANNER
  gap from previous close >= 3%
  price >= $1
  volume today (pre-market) >= 20,000 shares
  market cap >= $1B
  float / short float deliberately left blank
  Columns tracked: symbol, price, float, change from close, volume, relative volume,
  average daily volume, market cap, sector.

SMALL-CAP PRE-MARKET GAP SCANNER
  change from close >= 10%
  price >= $1  (explicitly to avoid penny stocks)
  volume today >= 20,000
  relative volume >= 1
  market cap <= $1B
  float / short float deliberately left blank

MULTI-STRATEGY ALERT (new-high breakout)
  relative volume filter, volume today >= 100,000 shares
  price >= 3% from previous close
  market cap >= $1B
  52-week-high variant: new high over 365 days

FIVE CONFIGURED STRATEGIES: small-cap high-volume breakout (<$1B), large-cap new-high-of-day
breakout, large-cap 52-week-high breakout, gap reversal, trend long, daily SMA cross (swing).

OPERATIONAL PRACTICE
  "Don't repeat symbol for 5 minutes" — suppresses duplicate alerts during a sustained breakout.
  Colour-coding applied to volume, relative volume and float.
  Dedicated alert windows per favourite strategy so tickers are not lost in a combined feed.

STATED REASON FOR LEAVING FLOAT BLANK: Trade Ideas sometimes lacks float data for a symbol;
defining a float filter silently drops those symbols from results. The presenter widens the net
to avoid losing candidates to missing vendor data.

NOT PRESENTED IN THE VIDEO: any backtest, win rate, expectancy, sample size, cost/slippage model,
or forward performance for any of the criteria.`;

console.log("=== INTAKE: Trade Ideas scanner tutorial ===\n");

const source = recordSource({
  kind: "video",
  title: "Humbled Trader — Trade Ideas Scanner Tutorial 2026",
  url: "https://www.youtube.com/watch?v=e69ZES9xlI4",
  locator: "32:44, captions, watched 2026-08-06",
  content: CONTENT,
  license: "All rights reserved (YouTube standard)",
  authors: ["Humbled Trader"],
});
console.log(`1. SOURCE ${source.id} (created=${source.created})`);

const claims = [
  {
    key: "largecap",
    statement:
      "A large/mid-cap pre-market gap screen used in practice: gap >= 3% from previous close, price >= $1, pre-market volume >= 20,000 shares, market cap >= $1B.",
    epistemicStatus: "known" as const,
    locator: "02:41-03:10",
    confidence: 0.9,
    indiaRelevant: false,
  },
  {
    key: "smallcap",
    statement:
      "A small-cap pre-market gap screen used in practice: change from close >= 10%, price >= $1, volume >= 20,000, relative volume >= 1, market cap <= $1B.",
    epistemicStatus: "known" as const,
    locator: "12:30-13:20",
    confidence: 0.9,
    indiaRelevant: false,
  },
  {
    key: "missingdata",
    statement:
      "Applying a filter on a field the data vendor does not populate silently removes those symbols from results, so a screen can lose valid candidates to missing data rather than to the criterion itself.",
    epistemicStatus: "known" as const,
    locator: "09:30-11:00",
    confidence: 0.85,
    indiaRelevant: true,
  },
  {
    key: "dedupe",
    statement:
      "During a sustained breakout the same symbol re-alerts repeatedly; suppressing repeat alerts per symbol for a fixed window keeps the feed readable.",
    epistemicStatus: "known" as const,
    locator: "24:00-25:30",
    confidence: 0.85,
    indiaRelevant: true,
  },
  {
    key: "unvalidated",
    statement:
      "No backtest, win rate, expectancy, sample size, cost model, or forward performance is presented for any of these criteria in the source.",
    epistemicStatus: "known" as const,
    confidence: 0.95,
    indiaRelevant: true,
  },
];

const claimIds: Record<string, string> = {};
for (const claim of claims) {
  const { key, ...rest } = claim;
  claimIds[key] = recordClaim({ sourceId: source.id, ...rest });
  console.log(`2. CLAIM [${claim.epistemicStatus}] ${claim.statement.slice(0, 62)}...`);
}

// --- Translate the screens into our bounded DSL -------------------------------
// The source specifies entry criteria only. An exit, stop, size and cost model had to be
// supplied to make these compile — those numbers are ours, and that is recorded below.
const LARGE_CAP = {
  name: "gap_largecap_premarket",
  description: "Large/mid-cap pre-market gap screen transcribed from the Trade Ideas tutorial.",
  universe: { market: "US" as const, maxPositions: 10 },
  entry: {
    all: [
      { feature: "gap_pct", op: "gte" as const, value: 3 },
      { feature: "close", op: "gte" as const, value: 1 },
      { feature: "volume", op: "gte" as const, value: 20_000 },
      { feature: "market_cap", op: "gte" as const, value: 1_000_000_000 },
    ],
  },
  exit: { afterDays: 1, stopLossPct: 3 },
  sizing: { maxPositionPct: 5 },
  costs: { commissionBps: 1, slippageBps: 15 },
};

const SMALL_CAP = {
  name: "gap_smallcap_premarket",
  description: "Small-cap pre-market gap screen transcribed from the Trade Ideas tutorial.",
  universe: { market: "US" as const, maxPositions: 5 },
  entry: {
    all: [
      { feature: "gap_pct", op: "gte" as const, value: 10 },
      { feature: "close", op: "gte" as const, value: 1 },
      { feature: "volume", op: "gte" as const, value: 20_000 },
      { feature: "rvol", op: "gte" as const, value: 1 },
      { feature: "market_cap", op: "lte" as const, value: 1_000_000_000 },
    ],
  },
  exit: { afterDays: 1, stopLossPct: 5 },
  sizing: { maxPositionPct: 2 },
  costs: { commissionBps: 1, slippageBps: 40 },
};

console.log("\n3. DSL COMPILATION");
const compiled = { large: compileStrategy(LARGE_CAP), small: compileStrategy(SMALL_CAP) };
for (const [label, result] of Object.entries(compiled)) {
  if (result.ok) {
    console.log(`   ${label}: ok hash=${result.hash} features=[${result.features.join(", ")}]`);
    result.warnings.forEach((warning) => console.log(`      WARNING ${warning}`));
  } else {
    console.log(`   ${label}: FAILED ${result.code}: ${result.message}`);
  }
}

const specIds: string[] = [];
if (compiled.large.ok) {
  specIds.push(recordStrategySpec({ name: LARGE_CAP.name, version: 1, dsl: LARGE_CAP, createdBy: "claude_code" }));
}
if (compiled.small.ok) {
  specIds.push(recordStrategySpec({ name: SMALL_CAP.name, version: 1, dsl: SMALL_CAP, createdBy: "claude_code" }));
}
console.log(`   recorded ${specIds.length} strategy spec(s)`);

// --- Reproduction ------------------------------------------------------------
const repro = registerReproduction({
  sourceId: source.id,
  claimId: claimIds.largecap,
  language: "typescript",
  codePath: "lib/strategy/dsl.ts:compileStrategy",
  notes:
    "Tests only that the published criteria are expressible in our point-in-time vocabulary and compile without lookahead. It says nothing about whether the screen is profitable.",
  expected: { largeCapCompiles: true, smallCapCompiles: true, noLookaheadFeatures: true },
  tolerance: 0,
});

const outcome = recordObservation(repro, {
  largeCapCompiles: compiled.large.ok,
  smallCapCompiles: compiled.small.ok,
  noLookaheadFeatures: compiled.large.ok && compiled.small.ok,
});
console.log(`\n4. REPRODUCTION ${outcome.status}`);
outcome.mismatches.forEach((mismatch) => console.log(`   MISMATCH ${mismatch}`));

// --- Concept, hypothesis, limitation, lesson ---------------------------------
const concept = recordConcept(
  "market_microstructure",
  "Screen versus strategy",
  "A screen selects candidates; a strategy also specifies entry timing, exit, stop, size and cost. A screen alone has no expectancy.",
);

const hypothesis = recordHypothesis({
  claimId: claimIds.smallcap,
  title: "Gap-and-RVOL screen transferred to NSE liquid mid-caps",
  statement:
    "A pre-market gap screen (gap >= 3%, relative volume >= 1, with price and liquidity floors) applied to NSE liquid mid-caps produces candidates whose forward returns beat no-trade after realistic Indian round-trip costs.",
  rationale:
    "The source's criteria are US day-trading screens with no validation. The transferable part is the shape — gap plus relative volume plus a liquidity floor — not the thresholds. Indian cash-market costs (STT, exchange fees, GST, SEBI turnover, stamp duty) are materially higher than US commissions, so the same thresholds are unlikely to survive.",
  market: "NSE",
  createdBy: "claude_code",
});
console.log(`5. HYPOTHESIS ${hypothesis}`);

const failureId = recordFailure(
  "strategy",
  "screen_without_exit_or_costs",
  "The source specifies entry screens only — no exit rule, stop, position size, or cost model. Compiling them required supplying an exit (1 day, 3-5% stop) and costs (1bp commission, 15-40bps slippage). Those numbers are the implementer's, not the source's, so any result attributed to these specs tests our assumptions as much as the published screen.",
  specIds[0],
  "Never treat a published screen as a strategy. Record which parameters were supplied by the implementer.",
);
console.log(`6. LIMITATION recorded as failure memory #${failureId}`);

const lesson = recordLesson({
  conceptId: concept,
  plane: "market_microstructure",
  level: "quant",
  title: "What a scanner tutorial can and cannot give you",
  body: `The video supplies concrete, usable screening criteria: gap >= 3% with market cap >= $1B for large caps, gap >= 10% with relative volume >= 1 and market cap <= $1B for small caps, a $1 price floor to exclude penny stocks, and a 20,000-share volume floor so a position can actually be exited. Both screens compiled cleanly into our point-in-time DSL, which confirms the criteria are knowable at decision time and contain no lookahead.

What it does not supply is an edge. There is no exit rule, no stop, no position size, no cost model, no win rate, no sample size and no forward evidence anywhere in 32 minutes. Compiling these as strategies required supplying an exit and a cost assumption, so any backtest of them tests those assumptions as much as the presenter's screen. The video is also monetised — it carries a discount code for the product being taught — which is not disqualifying but is a reason to weight the claims as preferences rather than findings.

The most genuinely transferable insight is a data-quality one, and it is easy to miss: the presenter leaves float filters blank because the vendor sometimes has no float value for a symbol, and applying the filter silently drops those symbols. A screen can therefore lose valid candidates to missing data rather than to the criterion. That failure mode is invisible unless you look for it, and it applies directly to our own scanner — a filter on a field the quant core does not populate would quietly shrink the universe with no error raised anywhere.

The second transferable practice is alert de-duplication: during a sustained breakout the same symbol re-alerts continuously, so suppressing repeats per symbol for a few minutes keeps the feed usable. That is the same class of problem as the re-appended forward-journal entries we already collapse on read.`,
  citations: [source.id, claimIds.largecap, claimIds.smallcap, claimIds.missingdata, claimIds.unvalidated],
});
console.log(`7. LESSON ${lesson}`);

const trace = traceForward(source.id);
console.log(`\n8. TRACE ${trace.nodes.length} nodes, ${trace.edges.length} edges`);
console.log("\nINTAKE COMPLETE — decision: ADAPT (criteria shape reusable; thresholds are US day-trading and unvalidated)");
