import fs from "node:fs";
import { sessionDatesFrom, sessionOpenEpoch } from "@/lib/market/session-calendar";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDbForTests, getDb, schema } from "@/lib/db";
import { persistCandles } from "@/lib/market/candle-store";
import { createRandom } from "@/lib/strategy/statistics";
import { assessPairMode, runStatArbWalkForward } from "./statarb-trading";

/**
 * Phase F.2 invariants. The one that matters most: a trade may only occur AFTER the formation
 * window that selected its pair, on frozen parameters — no trading-window knowledge may reach
 * back into selection.
 */

const temporaryDirectories: string[] = [];
let previousPath: string | undefined;

beforeEach(() => {
  previousPath = process.env.MARKETPULSE_DB_PATH;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marketpulse-sawf-"));
  temporaryDirectories.push(directory);
  process.env.MARKETPULSE_DB_PATH = path.join(directory, "wf.db");
  closeDbForTests();
  getDb();
});

afterEach(() => {
  closeDbForTests();
  if (previousPath === undefined) delete process.env.MARKETPULSE_DB_PATH;
  else process.env.MARKETPULSE_DB_PATH = previousPath;
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

// Real NSE sessions inside VERIFIED calendar coverage. Two reasons: a flat 86,400s stride
// manufactures weekend and holiday bars; future-dated bars are SESSION_UNVERIFIED, which research
// withholds; and dates before 2024-01-01 predate every broker cost profile, so roundTripCost
// correctly refuses and every trade loses its economics. The window has to satisfy all three.
// research withholds by design — either way the failure has nothing to do with pair trading.
const SESSIONS = sessionDatesFrom("2024-01-02", 1400).map((d) => sessionOpenEpoch(d) + 2700);
const OPEN = SESSIONS[0]!;
const LENGTH = 700;

/** B is a Gaussian random walk; A = 2·B + mean-reverting AR(1) noise; C is an unrelated walk. */
function seedCointegratedMarket(): void {
  const random = createRandom(4242);
  const gauss = (draw: () => number) =>
    Math.sqrt(-2 * Math.log(Math.max(draw(), 1e-12))) * Math.cos(2 * Math.PI * draw());
  const noise = createRandom(7);
  const walkB: number[] = [200];
  for (let index = 1; index < LENGTH; index += 1) walkB.push(walkB[index - 1] + gauss(random) * 1.5);
  let ar = 0;
  const seriesA = walkB.map((value) => {
    ar = 0.85 * ar + gauss(noise) * 2;
    return 2 * value + ar + 100;
  });
  const randomC = createRandom(31337);
  const walkC: number[] = [150];
  for (let index = 1; index < LENGTH; index += 1) walkC.push(walkC[index - 1] + gauss(randomC) * 1.5);

  const seed = (ticker: string, closes: number[]) =>
    persistCandles(
      closes.map((close, index) => ({
        ticker,
        resolution: "D",
        time: SESSIONS[index]!,
        open: close,
        high: close + 0.5,
        low: close - 0.5,
        close,
        volume: 1_000,
      })),
    );
  seed("IN:XNSE:RELIANCE", seriesA);
  seed("IN:XNSE:TCS", walkB);
  seed("IN:XNSE:HDFCBANK", walkC);
}

describe("pair mode — cointegration never buys execution eligibility", () => {
  it("an overnight equity pair is RESEARCH-blocked without verified borrow", () => {
    const assessment = assessPairMode({ resolution: "D", hasSquareOffProfile: false });
    expect(assessment.mode).toBe("OVERNIGHT_EQUITY_SLB");
    expect(assessment.executionEligible).toBe(false);
    expect(assessment.reasons.join(" ")).toMatch(/naked short selling is prohibited/i);
  });

  it("verified borrow makes the overnight pair eligible — and only then", () => {
    const assessment = assessPairMode({ resolution: "D", hasSquareOffProfile: false, shortBorrowVerified: true });
    expect(assessment.executionEligible).toBe(true);
    expect(assessment.reasons.join(" ")).toMatch(/VERIFIED borrow/);
  });

  it("intraday MIS with a square-off profile is eligible; without one it is not", () => {
    expect(assessPairMode({ resolution: "5m", hasSquareOffProfile: true }).executionEligible).toBe(true);
    const noProfile = assessPairMode({ resolution: "5m", hasSquareOffProfile: false });
    expect(noProfile.executionEligible).toBe(false);
    expect(noProfile.mode).toBe("RESEARCH_ONLY");
  });

  it("futures pairs are refused until a contract/margin/roll model exists", () => {
    const assessment = assessPairMode({ resolution: "D", hasSquareOffProfile: false, instrumentsAreFutures: true });
    expect(assessment.mode).toBe("FUTURES");
    expect(assessment.executionEligible).toBe(false);
  });
});

describe("walk-forward — formation freezes, trading only observes", () => {
  it("every trade occurs strictly after its formation window, on frozen parameters", () => {
    seedCointegratedMarket();
    const result = runStatArbWalkForward({ market: "NSE", resolution: "D", formationBars: 200, tradingBars: 100 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trades.length).toBeGreaterThan(0);

    for (const fold of result.folds) {
      const foldStart = (fold.fold - 1) * fold.tradingBars;
      const formationEnd = foldStart + fold.formationBars;
      for (const trade of fold.trades) {
        // The load-bearing assertion of this whole phase.
        expect(trade.entryIndex).toBeGreaterThanOrEqual(formationEnd);
        expect(trade.exitIndex).toBeGreaterThanOrEqual(trade.entryIndex);
        expect(trade.exitIndex).toBeLessThan(formationEnd + fold.tradingBars);
        expect(trade.parameterHash).toMatch(/^[0-9a-f]{16}$/);
      }
    }
  });

  it("finds the engineered pair and never trades the unrelated walk against it", () => {
    seedCointegratedMarket();
    const result = runStatArbWalkForward({ market: "NSE", resolution: "D", formationBars: 200, tradingBars: 100 });
    if (!result.ok) throw new Error("walk-forward refused");
    const traded = new Set(result.trades.flatMap((trade) => [trade.a, trade.b]));
    expect(traded.has("IN:XNSE:RELIANCE")).toBe(true);
    expect(traded.has("IN:XNSE:TCS")).toBe(true);
    expect(traded.has("IN:XNSE:HDFCBANK")).toBe(false);
  });

  it("prices BOTH legs and records the hedge error a whole-share pair actually achieves", () => {
    seedCointegratedMarket();
    const result = runStatArbWalkForward({ market: "NSE", resolution: "D", formationBars: 200, tradingBars: 100 });
    if (!result.ok) throw new Error("walk-forward refused");
    for (const trade of result.trades) {
      expect(trade.costReturn).not.toBeNull();
      expect(trade.costReturn!).toBeGreaterThan(0); // two legs are never free
      expect(trade.netReturn!).toBeCloseTo(trade.grossReturn - trade.costReturn!, 12);
      expect(Number.isFinite(trade.hedgeError)).toBe(true);
    }
    expect(result.summary.meanHedgeError).not.toBeNull();
  });

  it("exit reasons are real and z-thresholds are respected at entry", () => {
    seedCointegratedMarket();
    const result = runStatArbWalkForward({ market: "NSE", resolution: "D", formationBars: 200, tradingBars: 100, entryZ: 2 });
    if (!result.ok) throw new Error("walk-forward refused");
    for (const trade of result.trades) {
      expect(["mean_reversion", "stop", "timeout", "window_end"]).toContain(trade.exitReason);
      expect(Math.abs(trade.entryZ)).toBeGreaterThanOrEqual(2 - 1e-9);
      if (trade.side === "LONG_SPREAD") expect(trade.entryZ).toBeLessThan(0);
      else expect(trade.entryZ).toBeGreaterThan(0);
    }
  });

  it("the manifest carries the APPROXIMATE method label, the pair mode, and the full search count", () => {
    seedCointegratedMarket();
    const result = runStatArbWalkForward({ market: "NSE", resolution: "D", formationBars: 200, tradingBars: 100 });
    if (!result.ok) throw new Error("walk-forward refused");
    expect(result.manifest.cointegrationMethodStatus).toBe("APPROXIMATE_PARITY_MEASURED");
    expect(result.manifest.cointegrationLabel).toMatch(/agreement with statsmodels/);
    // Daily equity pair with no verified borrow: research-only, whatever the statistics say.
    expect(result.manifest.pairMode).toBe("OVERNIGHT_EQUITY_SLB");
    expect(result.manifest.executionEligible).toBe(false);
    // Search history spans every fold, not just the winners.
    const foldSum = result.folds.reduce((total, fold) => total + fold.candidatesTested, 0);
    expect(result.manifest.candidatesTestedTotal).toBe(foldSum);
    expect(result.manifest.candidatesTestedTotal).toBeGreaterThanOrEqual(result.folds.length * 3);

    const audit = getDb().select().from(schema.auditEvents).all().find((event) => event.action === "statarb_walkforward");
    expect(audit).toBeDefined();
    expect(JSON.parse(audit!.detail!).runId).toBe(result.runId);
  });

  it("refuses to shorten the windows to fit a thin store", () => {
    seedCointegratedMarket();
    const result = runStatArbWalkForward({ market: "NSE", resolution: "D", formationBars: 900, tradingBars: 200 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(["WINDOW_TOO_SHORT", "TOO_FEW_INSTRUMENTS"]).toContain(result.code);
      expect(result.message).toMatch(/out of sample|needs more|pair needs two/i);
    }
  });

  it("is deterministic: the same store and windows produce the same run id and trades", () => {
    seedCointegratedMarket();
    const first = runStatArbWalkForward({ market: "NSE", resolution: "D", formationBars: 200, tradingBars: 100 });
    const second = runStatArbWalkForward({ market: "NSE", resolution: "D", formationBars: 200, tradingBars: 100 });
    if (!first.ok || !second.ok) throw new Error("walk-forward refused");
    expect(second.runId).toBe(first.runId);
    expect(JSON.stringify(second.trades)).toBe(JSON.stringify(first.trades));
  });
});
