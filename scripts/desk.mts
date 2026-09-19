/**
 * The trading desk's Risk + Execution roles, for the `trading-desk` skill to call.
 *
 * Paper only. There is no broker adapter; `buy`/`sell` go through `placePaperOrder`, which applies
 * the risk kernel (watchlist, position cap, daily cap, live quote, regular session, cash) and is the
 * final authority. `size` never places anything.
 *
 * Usage:
 *   npx tsx scripts/desk.mts size IN:XNSE:ITC --entry 410 --stop 398 --target 440
 *   npx tsx scripts/desk.mts buy  IN:XNSE:ITC --entry 410 --stop 398 --target 440 --analysis 123
 *   npx tsx scripts/desk.mts sell IN:XNSE:ITC --qty 1 --analysis 123
 *
 * `--product INTRADAY` (any command) prices and places the trade as intraday: ~0.11% a round trip
 * instead of delivery's flat DP charge, no new entry after 15:10 IST, and the scheduled cycle
 * squares it off before the close. Default DELIVERY.
 */
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { parseInstrument } from "@/lib/market/instruments";
import { enginePositionCapPct, sizeDeskTrade } from "@/lib/paper/desk";
import { explainRejection } from "@/lib/paper/explain";
import { getPaperState } from "@/lib/paper/repository";
import { placePaperOrder } from "@/lib/paper/service";

const [command, rawInstrument] = process.argv.slice(2);
const flag = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const num = (name: string) => {
  const value = Number(flag(name));
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be a positive number`);
  return value;
};

if (!command || !rawInstrument || !["size", "buy", "sell"].includes(command)) {
  console.error("usage: desk.mts size|buy|sell <INSTRUMENT> ...  (see header)");
  process.exit(2);
}
const instrument = parseInstrument(rawInstrument);
const product = flag("product") === "INTRADAY" ? "INTRADAY" : "DELIVERY";
const db = getDb();

function sizing() {
  const account = db.select().from(schema.paperAccounts).where(eq(schema.paperAccounts.currency, instrument.currency)).get();
  return sizeDeskTrade({
    cash: getPaperState(instrument).cash,
    startingCash: account?.startingCash ?? 0,
    maxPositionPct: enginePositionCapPct(),
    entry: num("entry"),
    stop: num("stop"),
    target: num("target"),
    product,
  });
}

async function place(side: "BUY" | "SELL", quantity: number) {
  const analysis = flag("analysis");
  if (!analysis) throw new Error("--analysis <id> is required: every desk order traces to a recorded analysis");
  const result = await placePaperOrder({
    instrument,
    side,
    quantity,
    orderType: "MARKET",
    product,
    // One order per analysis and side: re-running the desk replays instead of doubling up.
    idempotencyKey: `desk-${side}-${instrument.symbol}-${analysis}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80),
  });
  const order = result.order;
  const why = order.status === "FILLED" ? null : explainRejection(order.reason, order.quoteQuality, instrument.market);
  console.log(JSON.stringify({ replay: result.idempotentReplay, order: { id: order.id, status: order.status, quantity: order.quantity, fillPrice: order.fillPrice, fees: order.fees, reason: order.reason }, explanation: why }, null, 2));
}

if (command === "size") {
  console.log(JSON.stringify(sizing(), null, 2));
} else if (command === "buy") {
  const sized = sizing();
  console.log(JSON.stringify(sized, null, 2));
  if (sized.verdict !== "SIZED") process.exit(1);
  await place("BUY", sized.quantity);
} else {
  await place("SELL", num("qty"));
}
