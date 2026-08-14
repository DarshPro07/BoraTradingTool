import { NextResponse } from "next/server";
import { requireMutationAccess } from "@/lib/security/request";
import { researchInstrument } from "@/lib/research/bridge";
import { authorDirectStrategy } from "@/lib/research/direct-author";
import { loadStoredCandles } from "@/lib/market/candle-store";
import { snapshotFromStore } from "@/lib/research-data/snapshot";
import { runPortfolioBacktest } from "@/lib/backtest/portfolio";
import { resolveInstrument } from "@/lib/market/instruments";

export const dynamic = "force-dynamic";

/**
 * The Golden Journey — one NSE instrument from research to backtest result.
 *
 * POST /api/golden-journey
 * Body: { instrumentId: "IN:XNSE:SBIN" }
 *
 * Chain:
 *   1. Research the instrument (LLM + evidence packet)
 *   2. Author a strategy from the research (deterministic)
 *   3. Run backtest against canonical store data
 *   4. Return the full result
 *
 * This is the proof that the autonomous chain works end-to-end.
 */
export async function POST(req: Request) {
  const denied = requireMutationAccess(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as { instrumentId?: string };
  if (!body.instrumentId) {
    return NextResponse.json({ error: "INSTRUMENT_REQUIRED" }, { status: 400 });
  }

  const instrumentId = body.instrumentId;
  const result: Record<string, unknown> = { instrumentId };

  // Step 1: Research
  const research = await researchInstrument(instrumentId);
  result.research = {
    ok: research.ok,
    events: research.events,
    envelope: research.ok ? research.envelope : null,
  };

  if (!research.ok) {
    return NextResponse.json({ ...result, stage: "RESEARCH_FAILED", message: research.message }, { status: 200 });
  }

  // Step 2: Author strategy (deterministic)
  const proposal = research.envelope.proposal;
  const authored = authorDirectStrategy({
    title: proposal.thesis,
    statement: proposal.entryConcept,
    direction: proposal.direction,
    market: instrumentId.includes("XNSE") ? "NSE" : "BSE",
  });

  result.strategy = {
    ok: authored.ok,
    reason: authored.reason ?? null,
    dsl: authored.dsl ?? null,
  };

  if (!authored.ok || !authored.dsl) {
    return NextResponse.json({ ...result, stage: "STRATEGY_REFUSED", message: authored.reason }, { status: 200 });
  }

  // Step 3: Get data and run backtest
  const instrument = resolveInstrument(instrumentId);
  const snapshot = snapshotFromStore(
    instrument.exchange === "XNSE" ? "NSE" : "BSE",
    authored.dsl.universe.resolution,
  );

  if (!snapshot.ok) {
    return NextResponse.json({ ...result, stage: "NO_DATA", message: snapshot.message }, { status: 200 });
  }

  const backtest = runPortfolioBacktest(authored.dsl, snapshot.dataset, {
    datasetFingerprint: snapshot.fingerprint,
    datasetSnapshotId: snapshot.snapshotId,
  });

  result.backtest = {
    ok: backtest.ok,
    message: backtest.ok ? null : backtest.message,
    trades: backtest.ok ? backtest.trades.length : 0,
    instrumentsEvaluated: backtest.ok ? backtest.instrumentsEvaluated : 0,
    evidence: backtest.ok
      ? {
          inSampleReturns: backtest.evidence.inSampleReturns.length,
          outOfSampleReturns: backtest.evidence.outOfSampleReturns.length,
          datasetSnapshotId: backtest.evidence.datasetSnapshotId,
        }
      : null,
  };

  if (!backtest.ok) {
    return NextResponse.json({ ...result, stage: "BACKTEST_FAILED", message: backtest.message }, { status: 200 });
  }

  return NextResponse.json({
    ...result,
    stage: "COMPLETE",
    message: `Golden journey complete: researched ${instrumentId}, authored strategy "${authored.dsl.name}", backtested with ${backtest.trades.length} trades across ${backtest.instrumentsEvaluated} instruments.`,
  });
}
