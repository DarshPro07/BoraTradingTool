import { getDb, schema } from "@/lib/db";
import { researchInstrument } from "@/lib/research/bridge";
import { authorDirectStrategy } from "@/lib/research/direct-author";
import { snapshotFromStore } from "@/lib/research-data/snapshot";
import { runPortfolioBacktest } from "@/lib/backtest/portfolio";
import { recordAgentRun } from "@/lib/runtime/agent-runs";
import { loadStoredCandles } from "@/lib/market/candle-store";

/**
 * Autonomous Golden Journey — the complete chain from instrument to backtest result.
 *
 * This is the proof that MarketPulse can operate autonomously:
 *   1. Find an NSE instrument with sufficient data
 *   2. Research it (LLM + evidence packet + source verification)
 *   3. Author a strategy (deterministic pattern matching)
 *   4. Backtest against canonical store data
 *   5. Record everything in the audit trail
 *
 * Runs as part of the autonomous learning cycle.
 */

export interface GoldenJourneyResult {
  ok: boolean;
  instrumentId?: string;
  stage: "RESEARCH" | "STRATEGY" | "BACKTEST" | "COMPLETE" | "NO_INSTRUMENT" | "NO_DATA";
  message: string;
  trades?: number;
  snapshotId?: string;
}

/** Find the best NSE instrument to research (most daily bars). */
function selectInstrument(now: Date): string | null {
  const db = getDb();
  const tickers = db
    .selectDistinct({ ticker: schema.priceCandles.ticker })
    .from(schema.priceCandles)
    .all()
    .map((row) => row.ticker)
    .filter((t) => t.startsWith("IN:XNSE:"));

  let best: { ticker: string; bars: number } | null = null;
  for (const ticker of tickers) {
    const bars = loadStoredCandles(ticker, "D");
    if (bars.length >= 60 && (!best || bars.length > best.bars)) {
      best = { ticker, bars: bars.length };
    }
  }
  return best?.ticker ?? null;
}

/**
 * Run the golden journey for one instrument.
 * Returns a result describing what happened at each stage.
 */
export async function runGoldenJourney(
  instrumentId?: string,
  actor = "autonomous_golden_journey",
  now = new Date(),
): Promise<GoldenJourneyResult> {
  // Select instrument if not specified.
  const targetInstrument = instrumentId ?? selectInstrument(now);
  if (!targetInstrument) {
    return { ok: false, stage: "NO_INSTRUMENT", message: "No NSE instrument with sufficient data found." };
  }

  // Step 1: Research.
  const research = await researchInstrument(targetInstrument);
  if (!research.ok) {
    return {
      ok: false,
      instrumentId: targetInstrument,
      stage: "RESEARCH",
      message: research.message,
    };
  }

  // Step 2: Author strategy.
  const proposal = research.envelope!.proposal;
  const authored = authorDirectStrategy({
    title: proposal.thesis,
    statement: proposal.entryConcept,
    direction: proposal.direction,
    market: "NSE",
  });

  if (!authored.ok || !authored.dsl) {
    return {
      ok: false,
      instrumentId: targetInstrument,
      stage: "STRATEGY",
      message: authored.reason ?? "Strategy authoring failed.",
    };
  }

  // Step 3: Backtest.
  const snapshot = snapshotFromStore("NSE", authored.dsl.universe.resolution);
  if (!snapshot.ok) {
    return {
      ok: false,
      instrumentId: targetInstrument,
      stage: "NO_DATA",
      message: snapshot.message,
    };
  }

  const backtest = runPortfolioBacktest(authored.dsl, snapshot.dataset, {
    datasetFingerprint: snapshot.fingerprint,
    datasetSnapshotId: snapshot.snapshotId,
  });

  if (!backtest.ok) {
    return {
      ok: false,
      instrumentId: targetInstrument,
      stage: "BACKTEST",
      message: backtest.message,
    };
  }

  // Record the run.
  recordAgentRun({
    id: `gj_${Date.now()}`,
    capability: "RESEARCH",
    provider: "golden_journey",
    model: "direct_author",
    status: "COMPLETED",
    trigger: "LEARNING",
    instrumentId: targetInstrument,
    evidenceFingerprint: snapshot.fingerprint,
    envelope: null,
    refusalCode: null,
    refusalMessage: null,
    tokens: null,
    cost: null,
    costCurrency: null,
    fallbackReason: null,
    startedAt: now,
    completedAt: new Date(),
  });

  return {
    ok: true,
    instrumentId: targetInstrument,
    stage: "COMPLETE",
    message: `Golden journey complete: researched ${targetInstrument}, authored "${authored.dsl.name}", ${backtest.trades.length} trades.`,
    trades: backtest.trades.length,
    snapshotId: snapshot.snapshotId,
  };
}
