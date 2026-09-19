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
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

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
  reason: "ENTRY" | "STOP" | "EOD";
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

export function readOrb<K extends keyof typeof ACTION>(kind: K): K extends "decision" ? OrbDecisionRow[] : OrbExecutionRow[] {
  return getDb()
    .select()
    .from(schema.auditEvents)
    .where(eq(schema.auditEvents.action, ACTION[kind]))
    .orderBy(asc(schema.auditEvents.id))
    .all()
    .flatMap((row) => {
      try {
        return [JSON.parse(row.detail ?? "{}")];
      } catch {
        return [];
      }
    }) as never;
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
 */
export async function runIntradayPass(deps: IntradayDeps, now = new Date()): Promise<IntradayPass[]> {
  if (!deps.sessionOpen(now)) return [];
  const { day, minute } = istParts(now);
  const out: IntradayPass[] = [];
  const suspended = orbDrawdown(deps.book().startingCash) > ORB_CONTRACT.killDrawdown;
  const decisions = readOrb("decision").filter((d) => d.day === day);
  const executions = readOrb("execution").filter((e) => e.day === day);

  for (const instrumentId of ORB_CONTRACT.universe) {
    const log = (action: string) => out.push({ instrumentId, action });
    let decision = decisions.find((d) => d.instrumentId === instrumentId);

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
    if (!decision?.long) continue;

    const mine = executions.filter((e) => e.instrumentId === instrumentId && e.status === "FILLED");
    const held = mine.reduce((q, e) => q + (e.side === "BUY" ? e.quantity : -e.quantity), 0);
    const entered = mine.some((e) => e.side === "BUY");
    const key = (side: string) => `orb-IN1-${day}-${instrumentId.split(":").pop()}-${side}-${minute}`.replace(/[^A-Za-z0-9_-]/g, "_");

    const record = async (side: "BUY" | "SELL", quantity: number, reason: OrbExecutionRow["reason"]) => {
      const r = await deps.place(instrumentId, side, quantity, key(side));
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
  }
  return out;
}

/** Realized P&L per session from the ledger alone (a session counts once flat). */
export function orbDailyPnl(): { day: string; pnl: number; trades: number }[] {
  const byDay = new Map<string, { pnl: number; trades: number; open: number }>();
  for (const e of readOrb("execution")) {
    if (e.status !== "FILLED") continue;
    const d = byDay.get(e.day) ?? { pnl: 0, trades: 0, open: 0 };
    d.pnl += e.cashDelta;
    d.open += e.side === "BUY" ? e.quantity : -e.quantity;
    if (e.side === "SELL") d.trades += 1;
    byDay.set(e.day, d);
  }
  // A day still holding a position has an unrealized leg; counting its buy alone would book a loss.
  return [...byDay]
    .filter(([, d]) => Math.abs(d.open) < 1e-9)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, d]) => ({ day, pnl: d.pnl, trades: d.trades }));
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

