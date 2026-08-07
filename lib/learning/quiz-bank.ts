import { getDb, schema } from "@/lib/db";
import { recordConcept } from "@/lib/knowledge/repository";

/**
 * The starting quiz bank, and the writer `knowledge_quizzes` never had.
 *
 * `nextStudyCard` offers a graded quiz only when a concept has a stored question *with options*.
 * Nothing in production ever wrote one, so every card degraded to recall — the owner self-reported
 * against material they had just read, which measures recognition rather than recall and is the
 * weakest evidence the mastery table can hold.
 *
 * ## Why seeding content here is not fabrication
 *
 * This system refuses to invent *evidence*: market data, claims, forward outcomes, anything that
 * could be mistaken for a measurement. These are none of those. Every entry below is a fact about
 * methodology or about this system's own enforced invariants, and each carries the citation that
 * makes it checkable — the same discipline `knowledge_lessons.citations` already applies.
 *
 * The distinction that matters: a fabricated backtest result is a lie about the world. A written
 * quiz question is authored material, and the answer is either right or it is a bug in this file.
 *
 * ## Why these concepts
 *
 * Each one names a way a research system silently produces a wrong number. They are the failures
 * this codebase spends most of its complexity preventing, so an owner who cannot answer them
 * cannot tell when a guardrail has been switched off.
 */

export interface QuizSeed {
  plane: string;
  concept: string;
  summary: string;
  formalDefinition?: string;
  question: string;
  /** First entry is the answer. Shuffled into a stable order on write. */
  options: [string, string, string, string];
  explanation: string;
  /** Where this is written down, so a disputed answer has somewhere to be settled. */
  citation: string;
}

export const QUIZ_BANK: readonly QuizSeed[] = Object.freeze([
  {
    plane: "research_method",
    concept: "Lookahead bias",
    summary:
      "Using information in a decision that was not knowable at the moment the decision was made.",
    formalDefinition: "A feature f is point-in-time iff f(t) is computable from data observed at or before t.",
    question: "A backtest uses a stock's full-year high to size positions in January. What is wrong?",
    options: [
      "The January decision uses a value not knowable until December — lookahead bias",
      "Position sizes will be too small",
      "The Sharpe ratio needs annualising differently",
      "Nothing, provided the same rule is applied to every stock",
    ],
    explanation:
      "Applying the flaw consistently does not remove it. The equity curve is not wrong by a little — it is a record of trades that could never have been placed.",
    citation: "lib/strategy/dsl.ts — POINT_IN_TIME_FEATURES; compileStrategy returns LOOKAHEAD_FEATURE",
  },
  {
    plane: "statistics",
    concept: "Deflated Sharpe ratio",
    summary:
      "A Sharpe ratio adjusted for how many strategies were tried before this one was selected.",
    question: "Why does the gauntlet deflate a strategy's Sharpe ratio by the number of prior trials?",
    options: [
      "Because the best of many random strategies has a high Sharpe by selection alone",
      "Because Sharpe ratios are biased upward in short samples",
      "Because transaction costs are not in the raw Sharpe",
      "Because volatility is not normally distributed",
    ],
    explanation:
      "Search inflates the maximum. Test enough coin-flipping strategies and one will look skilled; the deflation asks whether this Sharpe beats what the search itself would have produced.",
    citation: "Bailey & López de Prado (2014), The Deflated Sharpe Ratio; lib/strategy/significance.ts",
  },
  {
    plane: "statistics",
    concept: "Selection cost",
    summary: "Every candidate evaluated during a search counts toward the multiple-testing denominator.",
    question:
      "You screen 200 candidates, keep the best, and run the gauntlet on it. How many trials has that strategy cost?",
    options: [
      "200 — the selection happened at the screen",
      "1 — only one gauntlet was run",
      "2 — the screen and the gauntlet",
      "None, because screening does not record trials",
    ],
    explanation:
      "Moving the search somewhere the accounting cannot see it does not control for it. This is why screenPopulation returns selectionCost and runGauntlet requires it back.",
    citation: "lib/factory/screen.ts — the selectionCost contract",
  },
  {
    plane: "research_method",
    concept: "Out-of-sample holdout",
    summary: "Data reserved and queried once, so it cannot be fitted to.",
    question: "Why does re-querying a locked holdout destroy its value?",
    options: [
      "Each query leaks information, so the holdout becomes another in-sample set",
      "It is computationally expensive to reload",
      "The holdout period may contain a different market regime",
      "It invalidates the in-sample Sharpe ratio",
    ],
    explanation:
      "A holdout is only unbiased while it is unseen. Query it twice and the second answer is conditioned on the first — which is why re-querying it is prohibited in every learning mode here.",
    citation: "lib/governance/policy.ts — AUTONOMOUS_PROHIBITED; holdout_ledger table",
  },
  {
    plane: "data_quality",
    concept: "Survivorship bias",
    summary: "Testing only on instruments that still exist today.",
    question: "A backtest over today's index members, run across ten years of history, will tend to:",
    options: [
      "Overstate returns, because failed companies were never in the universe",
      "Understate returns, because winners are already priced in",
      "Be unbiased if the index is large enough",
      "Only affect volatility, not returns",
    ],
    explanation:
      "The universe was chosen with knowledge of who survived. That is lookahead applied to instrument selection rather than to a feature.",
    citation: "docs/ARCHITECTURE.md — data plane; lib/market/catalog.ts is a fixed curated list",
  },
  {
    plane: "execution",
    concept: "Transaction cost sensitivity",
    summary: "How much of an edge survives realistic slippage and commission.",
    question: "A strategy is profitable at 0 bps of cost and unprofitable at 10 bps. What does that tell you?",
    options: [
      "Its edge is smaller than the cost of trading it, so it is not tradable",
      "It needs a broker with lower fees",
      "The backtest period was too short",
      "It should be traded at larger size to amortise costs",
    ],
    explanation:
      "Costs scale with size; they are not amortised away. An edge thinner than the spread is a description of the spread.",
    citation: "lib/paper/fees.ts — India and US fee schedules; gauntlet cost-stress stage",
  },
  {
    plane: "risk",
    concept: "Pairwise correlation limit",
    summary: "A ceiling on how similar a new position may be to the existing book.",
    question: "Why does the risk gate refuse a correlation estimate built on too few overlapping days?",
    options: [
      "An unknown is treated as a block, never as an allowance",
      "Short windows always produce correlations near zero",
      "The estimate would be too slow to compute",
      "Correlation is only meaningful over a full year",
    ],
    explanation:
      "A limit that silently passes when its input is missing is worse than no limit, because it is believed. The gate fails closed.",
    citation: "lib/risk/gate.ts — minCommonDays; lib/portfolio/correlation.ts",
  },
  {
    plane: "evidence",
    concept: "Forward outcome",
    summary: "An observation resolved after the prediction was recorded.",
    question: "Why is one forward-resolved trade stronger evidence than a thousand backtested ones?",
    options: [
      "It was not selected with knowledge of its own outcome",
      "It uses live prices rather than historical ones",
      "It includes real transaction costs",
      "It is more recent, so the regime is more relevant",
    ],
    explanation:
      "The backtest population was chosen by a search that already saw the results. Forward observations are the only ones the search could not have peeked at.",
    citation: "docs/CONTRACT_QUANTCORE_V1.md §3.4 — 'the only unbiased evidence in the system'",
  },
  {
    plane: "statistics",
    concept: "Probability of backtest overfitting",
    summary: "The chance that the best in-sample configuration underperforms the median out of sample.",
    question: "A strategy family shows PBO of 0.7. What does that mean?",
    options: [
      "Seven times in ten, the in-sample winner is below median out of sample",
      "The strategy is profitable 70% of the time",
      "70% of the parameter space is unprofitable",
      "There is a 70% chance the Sharpe ratio is positive",
    ],
    explanation:
      "High PBO means the selection procedure is picking noise. The particular winner matters less than the fact that winning in-sample stopped predicting anything.",
    citation: "Bailey et al. (2015), The Probability of Backtest Overfitting; validation_results.pbo",
  },
  {
    plane: "market_structure",
    concept: "Stale quote",
    summary: "A price carried forward from a closed or disconnected session.",
    question: "A paper order fills against a quote from yesterday's close. Why does this system refuse it?",
    options: [
      "One invented fill contaminates every risk ceiling derived from it",
      "The fill price would be slightly inaccurate",
      "Exchanges prohibit trading on stale data",
      "The order would fail at the broker anyway",
    ],
    explanation:
      "Paper fills feed loss memory, and loss memory tightens the risk posture. A fabricated fill does not stay in one place — it propagates into every ceiling that is later believed.",
    citation: "lib/paper/explain.ts; lib/paper/loss-memory.ts → riskPosture()",
  },
]);

/** Stable, readable, and collision-free across planes. */
function quizId(seed: QuizSeed): string {
  const slug = `${seed.plane}_${seed.concept}`.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return `qz_${slug}`;
}

/**
 * Deterministic rotation, not a shuffle.
 *
 * `Math.random` would reorder the options on every seeding run, and a re-seed would then look like
 * a content change in any diff. Rotating by a value derived from the id keeps the answer off
 * position zero without making the output unstable.
 */
function orderOptions(seed: QuizSeed): string[] {
  const options = [...seed.options];
  const offset = seed.concept.length % options.length;
  return [...options.slice(offset), ...options.slice(0, offset)];
}

export interface SeedReport {
  conceptsTouched: number;
  quizzesWritten: number;
  alreadyPresent: number;
}

/**
 * Idempotent. Safe to call on every cycle: existing quizzes are left alone rather than rewritten,
 * so an owner who edits a question by hand does not have it reverted on the next pass.
 */
export function seedQuizBank(now = new Date()): SeedReport {
  const db = getDb();
  const report: SeedReport = { conceptsTouched: 0, quizzesWritten: 0, alreadyPresent: 0 };

  for (const seed of QUIZ_BANK) {
    const conceptId = recordConcept(seed.plane, seed.concept, seed.summary, seed.formalDefinition);
    report.conceptsTouched += 1;

    const id = quizId(seed);
    const existing = db.select().from(schema.knowledgeQuizzes).all().find((row) => row.id === id);
    if (existing) {
      report.alreadyPresent += 1;
      continue;
    }

    db.insert(schema.knowledgeQuizzes)
      .values({
        id,
        conceptId,
        question: seed.question,
        options: JSON.stringify(orderOptions(seed)),
        answer: seed.options[0],
        // The citation travels with the explanation so a disputed answer has somewhere to be
        // settled other than an argument.
        explanation: `${seed.explanation}\n\nSource: ${seed.citation}`,
        createdAt: now,
      })
      .onConflictDoNothing()
      .run();
    report.quizzesWritten += 1;
  }

  return report;
}
