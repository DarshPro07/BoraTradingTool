/**
 * IN1 — the intraday trader: opening-range breakout, long only, paper only.
 *
 * Owner, 2026-09-19: "can it do intraday, like a real trader replacing the real trader". The rule is
 * published, not invented here: Zarattini, Barbon & Aziz (2023), "Can Day Trading Really Be
 * Profitable? Evidence of sustainable long-term profits from opening range breakout (ORB) day
 * trading strategy" — if the first 5-minute candle closes up, buy; stop at that candle's low; exit
 * at the close. Their evidence is US (QQQ/TQQQ, with leverage); on NSE, long-only and unleveraged,
 * the transfer is UNPROVEN. SEBI's 2024 study found ~7 in 10 individual intraday traders in the cash
 * segment lost money, so this earns trust on paper exactly like the fund.
 *
 * Frozen and hash-pinned like the fund mandates: a changed parameter is a new mandate. Money
 * management is part of the contract ("let the system decide", owner): 0.5% of the book at risk per
 * trade, inside the risk kernel's position cap; no entry after 10:30 IST; flat by 15:05 IST, before
 * the cycle's 15:10 square-off. Every decision and fill is appended to `audit_events`.
 */
import { createHash } from "node:crypto";
import { and, asc, eq, gt, inArray, like } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getLearningMode } from "@/lib/governance/runtime";

export const ORB_CONTRACT = Object.freeze({
  id: "IN1" as const,
  title: "Opening-range breakout, long only: first 5-minute candle up -> buy, stop at its low, flat by 15:05",
  universe: Object.freeze(["IN:XNSE:RELIANCE", "IN:XNSE:HDFCBANK", "IN:XNSE:ICICIBANK"]),
  riskPct: 0.005,
  firstCandleMinutes: 5,
  lastEntryMinute: 10 * 60 + 30,
  exitMinute: 15 * 60 + 5,
  /** Drawdown of the book from realized ORB P&L that stops new entries (open positions still exit). */
  killDrawdown: 0.05,
  declaredBenefit: "POSITIVE_NET_RETURN" as const,
  prior:
    "Published ORB evidence is US index ETFs with leverage (Zarattini, Barbon & Aziz 2023); on NSE, long-only " +
    "and unleveraged, expect much smaller and possibly negative returns. Most retail intraday traders lose (SEBI 2024).",
  sources: Object.freeze([
    "Zarattini, Barbon & Aziz 2023, Can Day Trading Really Be Profitable? (SSRN 4416622)",
    "SEBI study on intraday traders in the equity cash segment, 2024",
  ]),
});

export const ORB_HASH = createHash("sha256").update(JSON.stringify(ORB_CONTRACT)).digest("hex").slice(0, 16);

export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
}

/** The rule: a first candle that closed up is a long, stopped at its low. Anything else: no trade. */
export function orbDecision(first: Candle): { long: boolean; stop: number } {
  return { long: first.close > first.open, stop: first.low };
}

/** Shares for one trade: 0.5% of the book at risk, capped by the position cap and the cash. */
export function orbQuantity(input: { entry: number; stop: number; book: number; cash: number; capPct: number }): number {
  const { entry, stop, book, cash, capPct } = input;
  if (!(entry > stop) || !(stop > 0)) return 0;
  const byRisk = (ORB_CONTRACT.riskPct * book) / (entry - stop);
  const byCap = ((capPct / 100) * book) / entry;
  return Math.max(0, Math.floor(Math.min(byRisk, byCap, cash / entry)));
}

// ── Ledger ──────────────────────────────────────────────────────────────────────────────────────

export interface OrbDecisionRow {
  hash: string;
  day: string;
  instrumentId: string;
  long: boolean;
  stop: number;
  first: Candle;
}
export interface OrbExecutionRow {
  hash: string;
  day: string;
  instrumentId: string;
  side: "BUY" | "SELL";
  /**
   * CARRIED: shares left over from an earlier day whose exit never filled; sold first.
   * SQUARED: sold by the cycle's square-off, not by IN1 (EC-13); booked from the engine's fill.
   */
  reason: "ENTRY" | "STOP" | "EOD" | "CARRIED" | "SQUARED";
  status: string;
  quantity: number;
  fillPrice: number | null;
  fees: number;
  /** Signed: negative for a buy (cash out), positive for a sell. */
  cashDelta: number;
  refusal: string | null;
  at: string;
}

const ACTION = { decision: "intraday_decision", execution: "intraday_execution" } as const;

function append(kind: keyof typeof ACTION, row: OrbDecisionRow | OrbExecutionRow, key: string): void {
  getDb()
    .insert(schema.auditEvents)
    .values({
      actor: "intraday",
      action: ACTION[kind],
      decision: kind === "execution" && (row as OrbExecutionRow).status !== "FILLED" ? "limited" : "allowed",
      subject: `IN1:${key}`,
      detail: JSON.stringify(row),
      createdAt: new Date(),
    })
    .run();
}

export function orbRowsQuery(kind: keyof typeof ACTION) {
  // ponytail: `decision` is filtered only to reach idx_audit_decision (decision, action); append()
  // writes no other value. Without it every pass scanned all of audit_events (916k rows): after the
  // 2026-10-23 reboot that read a cold disk at ~0.7 MB/s and the pass outlived its 3-minute limit.
  return getDb()
    .select()
    .from(schema.auditEvents)
    .where(and(inArray(schema.auditEvents.decision, ["allowed", "limited"]), eq(schema.auditEvents.action, ACTION[kind])))
    .orderBy(asc(schema.auditEvents.id));
}

export function readOrb<K extends keyof typeof ACTION>(kind: K): K extends "decision" ? OrbDecisionRow[] : OrbExecutionRow[] {
  return orbRowsQuery(kind)
    .all()
    .flatMap((row) => {
      try {
        return [JSON.parse(row.detail ?? "{}")];
      } catch {
        return [];
      }
    }) as never;
}

/**
 * EC-13: book the cycle's square-off fills to IN1. When the minute task misses its 15:05 exit, the
 * 15:10+ square-off sells the engine position, but IN1's ledger still showed the shares: the next
 * day it tried to sell them every minute (refused, INSUFFICIENT_HOLDINGS) and never traded that
 * name again. Idempotent: once the shares are booked, IN1 holds nothing and this is a no-op.
 * Call it only under the intraday lease (it runs at the top of every IN1 pass): two unleased
 * callers could both read the shares as held and book one square-off twice.
 */
export function reconcileOrbSquareOffs(): string[] {
  const booked: string[] = [];
  const executions = readOrb("execution");
  for (const instrumentId of ORB_CONTRACT.universe) {
    const mine = executions.filter((e) => e.instrumentId === instrumentId && e.status === "FILLED");
    let held = mine.reduce((q, e) => q + (e.side === "BUY" ? e.quantity : -e.quantity), 0);
    if (held <= 1e-9) continue;
    const squareOffs = getDb()
      .select()
      .from(schema.paperOrders)
      .where(and(
        eq(schema.paperOrders.instrumentId, instrumentId), eq(schema.paperOrders.side, "SELL"), eq(schema.paperOrders.status, "FILLED"),
        eq(schema.paperOrders.product, "INTRADAY"), like(schema.paperOrders.idempotencyKey, "squareoff-%"),
        gt(schema.paperOrders.createdAt, new Date(mine.at(-1)!.at)),
      ))
      .orderBy(asc(schema.paperOrders.createdAt))
      .all();
    for (const order of squareOffs) {
      if (held <= 1e-9 || order.fillPrice === null) break;
      // The square-off sells the whole engine position, which may include shares that are not IN1's.
      const quantity = Math.min(held, order.quantity);
      const fees = (order.fees * quantity) / order.quantity;
      const day = new Date(order.createdAt.getTime() + 330 * 60_000).toISOString().slice(0, 10);
      const row: OrbExecutionRow = {
        hash: ORB_HASH, day, instrumentId, side: "SELL", reason: "SQUARED", status: "FILLED", quantity,
        fillPrice: order.fillPrice, fees, cashDelta: order.fillPrice * quantity - fees, refusal: null, at: order.createdAt.toISOString(),
      };
      append("execution", row, `${day}:${instrumentId}:SELL:squared:${order.id}`);
      held -= quantity;
      booked.push(`${instrumentId}: ${quantity} squared off @ ${order.fillPrice} booked to IN1`);
    }
  }
  return booked;
}

// ── The pass ────────────────────────────────────────────────────────────────────────────────────

export interface IntradayDeps {
  /** The day's first 5-minute candle, once it has closed; null before then or when unavailable. */
  firstCandle(instrumentId: string, day: string): Promise<Candle | null>;
  lastPrice(instrumentId: string): Promise<number | null>;
  sessionOpen(now: Date): boolean;
  book(): { startingCash: number; cash: number; capPct: number };
  place(instrumentId: string, side: "BUY" | "SELL", quantity: number, key: string): Promise<{
    status: string; fillPrice: number | null; fees: number; reason: string | null;
  }>;
}

export interface IntradayPass {
  instrumentId: string;
  action: string;
}

const istParts = (now: Date) => {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return { day: ist.toISOString().slice(0, 10), minute: ist.getUTCHours() * 60 + ist.getUTCMinutes() };
};

/**
 * One minute's work. Called every minute in session by the "MarketPulse Intraday" task, under its
 * own lease. Idempotent per day: one decision per instrument, one entry, one exit.
 *
 * `decideOnly` is the cycle's backstop (EC-4): it records a missing decision and places nothing.
 * Learning mode OFF (GV-8) stops new entries; exits still run, because the cycle's square-off
 * does not run while OFF and a held intraday position must not go overnight.
 */
export async function runIntradayPass(deps: IntradayDeps, now = new Date(), { decideOnly = false } = {}): Promise<IntradayPass[]> {
  const out: IntradayPass[] = reconcileOrbSquareOffs().map((action) => ({ instrumentId: "IN1", action }));
  if (!deps.sessionOpen(now)) return out;
  const { day, minute } = istParts(now);
  const paused = getLearningMode() === "off";
  const suspended = orbDrawdown(deps.book().startingCash) > ORB_CONTRACT.killDrawdown;
  const decisions = readOrb("decision").filter((d) => d.day === day);
  const allExecutions = readOrb("execution");
  const executions = allExecutions.filter((e) => e.day === day);

  for (const instrumentId of ORB_CONTRACT.universe) {
    const log = (action: string) => out.push({ instrumentId, action });
    // EC-9: one instrument's provider error must not cost the others their decision.
    try {
      let decision = decisions.find((d) => d.instrumentId === instrumentId);
      const keyFor = (side: string) => `orb-IN1-${day}-${instrumentId.split(":").pop()}-${side}-${minute}`.replace(/[^A-Za-z0-9_-]/g, "_");

      // 0. Shares carried from an earlier day (an exit that never filled) are invisible to a
      //    today-only view: they would be left unmanaged and a second position opened beside them.
      //    Count across all days, sell the carry first, and take no new position in that name today.
      const carried = allExecutions
        .filter((e) => e.instrumentId === instrumentId && e.status === "FILLED" && e.day < day)
        .reduce((q, e) => q + (e.side === "BUY" ? e.quantity : -e.quantity), 0);
      const soldCarryToday = executions.some((e) => e.instrumentId === instrumentId && e.reason === "CARRIED");
      if (carried > 1e-9 || soldCarryToday) {
        if (carried > 1e-9 && !decideOnly) {
          const r = await deps.place(instrumentId, "SELL", carried, keyFor("SELL"));
          const filled = r.status === "FILLED";
          const row: OrbExecutionRow = {
            hash: ORB_HASH, day, instrumentId, side: "SELL", reason: "CARRIED", status: r.status, quantity: carried,
            fillPrice: r.fillPrice, fees: filled ? r.fees : 0, cashDelta: filled ? r.fillPrice! * carried - r.fees : 0,
            refusal: filled ? null : r.reason, at: now.toISOString(),
          };
          append("execution", row, `${day}:${instrumentId}:SELL:carried:${minute}`);
          executions.push(row);
          log(`SELL CARRIED ${r.status}${filled ? ` @ ${r.fillPrice}` : ` (${r.reason})`}`);
        }
        continue;
      }

      // 1. Decide once the first candle has closed.
      if (!decision && minute >= 9 * 60 + 15 + ORB_CONTRACT.firstCandleMinutes) {
        const first = await deps.firstCandle(instrumentId, day);
        if (!first) {
          log("first candle unavailable");
          continue;
        }
        const d = orbDecision(first);
        decision = { hash: ORB_HASH, day, instrumentId, long: d.long, stop: d.stop, first };
        append("decision", decision, `${day}:${instrumentId}:decision`);
        log(d.long ? `decided LONG, stop ${d.stop}` : "decided NO TRADE (first candle not up)");
      }
      if (!decision?.long || decideOnly) continue;

      const mine = executions.filter((e) => e.instrumentId === instrumentId && e.status === "FILLED");
      const held = mine.reduce((q, e) => q + (e.side === "BUY" ? e.quantity : -e.quantity), 0);
      const entered = mine.some((e) => e.side === "BUY");

      const record = async (side: "BUY" | "SELL", quantity: number, reason: OrbExecutionRow["reason"]) => {
        const r = await deps.place(instrumentId, side, quantity, keyFor(side));
        const filled = r.status === "FILLED";
        const gross = filled ? r.fillPrice! * quantity : 0;
        const row: OrbExecutionRow = {
          hash: ORB_HASH, day, instrumentId, side, reason, status: r.status, quantity,
          fillPrice: r.fillPrice, fees: filled ? r.fees : 0,
          cashDelta: filled ? (side === "BUY" ? -(gross + r.fees) : gross - r.fees) : 0,
          refusal: filled ? null : r.reason, at: now.toISOString(),
        };
        append("execution", row, `${day}:${instrumentId}:${side}:${minute}`);
        executions.push(row);
        log(`${side} ${reason} ${r.status}${filled ? ` @ ${r.fillPrice}` : ` (${r.reason})`}`);
      };

      // 2. Enter once, inside the entry window.
      if (!entered && held === 0) {
        if (minute > ORB_CONTRACT.lastEntryMinute) continue;
        if (paused) {
          log("learning mode OFF: no new entries");
          continue;
        }
        if (suspended) {
          log("suspended: kill drawdown breached, no new entries");
          continue;
        }
        const price = await deps.lastPrice(instrumentId);
        if (price === null) {
          log("no live price");
          continue;
        }
        const book = deps.book();
        const quantity = orbQuantity({ entry: price, stop: decision.stop, book: book.startingCash, cash: book.cash, capPct: book.capPct });
        if (quantity < 1) {
          log(price <= decision.stop ? "price already at/below stop: no entry" : "size rounds to 0");
          continue;
        }
        await record("BUY", quantity, "ENTRY");
        continue;
      }

      // 3. Exit: stop, or end of day.
      if (held > 0) {
        if (minute >= ORB_CONTRACT.exitMinute) {
          await record("SELL", held, "EOD");
          continue;
        }
        const price = await deps.lastPrice(instrumentId);
        if (price !== null && price <= decision.stop) await record("SELL", held, "STOP");
      }
    } catch (caught) {
      // Reported in this minute's lines, beside the others' work; the entry exits 1 on it.
      log(`failed: ${caught instanceof Error ? caught.message : String(caught)}`);
    }
  }
  return out;
}

/**
 * Realized P&L per session, by ROUND TRIP: a position's cash flows are realized on the day its
 * quantity returns to zero, whichever day it opened. (Grouping by day alone made a carried
 * position's buy and sell land on different days, and neither day ever counted as flat.)
 */
export function orbDailyPnl(): { day: string; pnl: number; trades: number }[] {
  const open = new Map<string, { quantity: number; cash: number }>();
  const byDay = new Map<string, { pnl: number; trades: number }>();
  for (const e of readOrb("execution")) {
    if (e.status !== "FILLED") continue;
    const position = open.get(e.instrumentId) ?? { quantity: 0, cash: 0 };
    position.quantity += e.side === "BUY" ? e.quantity : -e.quantity;
    position.cash += e.cashDelta;
    if (Math.abs(position.quantity) < 1e-9) {
      const d = byDay.get(e.day) ?? { pnl: 0, trades: 0 };
      d.pnl += position.cash;
      d.trades += 1;
      byDay.set(e.day, d);
      open.delete(e.instrumentId);
    } else {
      open.set(e.instrumentId, position);
    }
  }
  return [...byDay].sort(([x], [y]) => x.localeCompare(y)).map(([day, d]) => ({ day, ...d }));
}

/** Drawdown of `book` + cumulative realized ORB P&L from its peak (0 with no history). */
export function orbDrawdown(book: number): number {
  let nav = book;
  let peak = book;
  let worst = 0;
  for (const d of orbDailyPnl()) {
    nav += d.pnl;
    peak = Math.max(peak, nav);
    if (peak > 0) worst = Math.max(worst, 1 - nav / peak);
  }
  return worst;
}

