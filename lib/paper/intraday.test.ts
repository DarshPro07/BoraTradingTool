import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDbForTests, getDb, schema } from "@/lib/db";
import { parseInstrument } from "@/lib/market/instruments";
import { updateAgentConfig } from "@/lib/trading/config";
import { roundTripCost } from "./cost-model";
import { placePaperOrder, squareOffIntradayPaper } from "./service";

/**
 * Intraday paper (owner instruction 2026-09-19). A ₹1,000 delivery round trip costs ~1.8%; the same
 * trade squared off intraday ~0.11%. Before this the engine priced everything as delivery, so an
 * intraday strategy could not be measured — and nothing closed an "intraday" position at all.
 */

let directory: string;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "marketpulse-intraday-"));
  vi.stubEnv("MARKETPULSE_DB_PATH", path.join(directory, "paper.db"));
  vi.stubEnv("MARKETPULSE_TEST_MODE", "1");
  closeDbForTests();
  updateAgentConfig({ watchlistOnly: false, maxPositionPct: 15, dailyTradeCap: 20 });
});
afterEach(() => {
  closeDbForTests();
  vi.unstubAllEnvs();
  fs.rmSync(directory, { recursive: true, force: true });
});

const RELIANCE = parseInstrument("IN:XNSE:RELIANCE");
/** IST wall-clock on Friday 2026-09-18. */
const ist = (hhmm: string, date = "2026-09-18") => new Date(`${date}T${hhmm}:00+05:30`);
let key = 0;
const order = (side: "BUY" | "SELL", product: "DELIVERY" | "INTRADAY", at: Date, quantity = 1) =>
  placePaperOrder(
    { instrument: RELIANCE, side, quantity, orderType: "MARKET", product, idempotencyKey: `intraday-test-${++key}` },
    { now: at },
  );

describe("intraday paper", () => {
  it("prices an intraday round trip at intraday rates — no DP charge", async () => {
    const buy = await order("BUY", "INTRADAY", ist("10:00"));
    const sell = await order("SELL", "INTRADAY", ist("11:00"));
    expect(buy.order.status).toBe("FILLED");
    expect(sell.order.status).toBe("FILLED");
    expect(sell.order.product).toBe("INTRADAY");

    const expected = roundTripCost({ market: "IN", notional: sell.order.fillPrice!, product: "INTRADAY", broker: "ZERODHA" });
    expect(sell.order.fees).toBeCloseTo(expected.legs.sell.total, 2);
    expect(sell.order.fees, "an intraday sell pays no ₹15.93 DP charge").toBeLessThan(5);
  });

  it("refuses to mix products on one position", async () => {
    expect((await order("BUY", "DELIVERY", ist("10:00"))).order.status).toBe("FILLED");
    const mixed = await order("BUY", "INTRADAY", ist("10:05"));
    expect(mixed.order.status).toBe("REJECTED");
    expect(mixed.order.reason).toBe("PAPER_PRODUCT_MISMATCH");
  });

  it("refuses a new intraday entry after the 15:10 IST cut-off, but not a delivery one", async () => {
    const late = await order("BUY", "INTRADAY", ist("15:12"));
    expect(late.order.reason).toBe("INTRADAY_ENTRY_CLOSED");
    expect((await order("BUY", "DELIVERY", ist("15:12"))).order.status).toBe("FILLED");
  });

  it("squares off intraday positions from the cut-off and leaves delivery alone", async () => {
    await order("BUY", "INTRADAY", ist("10:00"));
    expect((await squareOffIntradayPaper(ist("11:00"))).attempted, "nothing is due mid-session").toBe(0);

    const report = await squareOffIntradayPaper(ist("15:12"));
    expect(report).toMatchObject({ attempted: 1, closed: 1 });
    const position = getDb().select().from(schema.paperPositions).all().find((p) => p.instrumentId === RELIANCE.id);
    expect(position?.quantity).toBe(0);
  });

  it("closes a position carried overnight at the next session's first pass", async () => {
    await order("BUY", "INTRADAY", ist("10:00"));
    // Nothing closed it on the 18th. On Monday morning, well before the cut-off, it is due at once.
    const report = await squareOffIntradayPaper(ist("09:30", "2026-09-21"));
    expect(report.closed).toBe(1);
  });
});
