import { and, desc, eq, gte, lte, ne } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { MarketSession } from "@/lib/market/calendar";
import type { Instrument, NormalizedQuote } from "@/lib/market/types";
import { PaperOrderConflict, type PaperDecision, type PaperOrderIntent } from "./types";
import { evaluatePaperOrder } from "./engine";

export function getPaperState(instrument: Instrument): { cash: number; heldQuantity: number; averageCost: number } {
  const db = getDb();
  const account = db.select().from(schema.paperAccounts).where(eq(schema.paperAccounts.currency, instrument.currency)).get();
  const position = db.select().from(schema.paperPositions).where(eq(schema.paperPositions.instrumentId, instrument.id)).get();
  return {
    cash: account?.cash ?? 0,
    heldQuantity: position?.quantity ?? 0,
    averageCost: position?.averageCost ?? 0,
  };
}

export function findPaperOrderByIdempotencyKey(idempotencyKey: string) {
  return getDb().select().from(schema.paperOrders).where(eq(schema.paperOrders.idempotencyKey, idempotencyKey)).get() ?? null;
}

export function assertPaperOrderMatchesIntent(
  existing: NonNullable<ReturnType<typeof findPaperOrderByIdempotencyKey>>,
  intent: PaperOrderIntent,
): void {
  const same = existing.instrumentId === intent.instrument.id
    && existing.side === intent.side
    && existing.quantity === intent.quantity
    && existing.orderType === intent.orderType
    && (existing.limitPrice ?? undefined) === intent.limitPrice;
  if (!same) {
    throw new PaperOrderConflict("Idempotency key was already used for a different paper-order payload.");
  }
}

export function persistPaperOrder(
  intent: PaperOrderIntent,
  quote: NormalizedQuote,
  session: MarketSession,
  now = new Date(),
) {
  const db = getDb();
  return db.transaction((tx) => {
    const existing = tx.select().from(schema.paperOrders).where(eq(schema.paperOrders.idempotencyKey, intent.idempotencyKey)).get();
    if (existing) {
      assertPaperOrderMatchesIntent(existing, intent);
      return { order: existing, idempotentReplay: true };
    }

    tx.insert(schema.instruments)
      .values({
        id: intent.instrument.id,
        market: intent.instrument.market,
        exchange: intent.instrument.exchange,
        symbol: intent.instrument.symbol,
        providerSymbol: intent.instrument.providerSymbol,
        name: intent.instrument.name,
        currency: intent.instrument.currency,
        timezone: intent.instrument.timezone,
        assetType: intent.instrument.assetType,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.instruments.id,
        set: { name: intent.instrument.name, updatedAt: new Date() },
      })
      .run();

    const account = tx.select().from(schema.paperAccounts).where(eq(schema.paperAccounts.currency, intent.instrument.currency)).get();
    const position = tx.select().from(schema.paperPositions).where(eq(schema.paperPositions.instrumentId, intent.instrument.id)).get();
    const config = tx.select().from(schema.agentConfig).where(eq(schema.agentConfig.id, 1)).get();
    const strategies = tx.select().from(schema.strategies).all();
    const activeStrategy = strategies.find((strategy) => strategy.id === config?.activeStrategyId)
      ?? strategies.find((strategy) => strategy.isDefault)
      ?? strategies[0];
    const configuredCap = config?.maxPositionPct ?? 15;
    const maxPositionPct = Math.min(configuredCap, activeStrategy?.maxPositionPct ?? configuredCap);
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const acceptedToday = tx
      .select({ id: schema.paperOrders.id })
      .from(schema.paperOrders)
      .where(and(gte(schema.paperOrders.createdAt, dayStart), ne(schema.paperOrders.status, "REJECTED")))
      .all().length;
    const isWatchlisted = tx.select().from(schema.userWatchlist).all().some((entry) => {
      const ticker = entry.ticker.toUpperCase();
      return ticker === intent.instrument.id.toUpperCase()
        || ticker === intent.instrument.symbol.toUpperCase()
        || ticker === intent.instrument.providerSymbol.toUpperCase();
    });

    let decision: PaperDecision;
    if ((config?.dailyTradeCap ?? 5) <= acceptedToday) {
      decision = { status: "REJECTED", reason: "PAPER_DAILY_ORDER_CAP", feePolicy: "PAPER_POLICY_V1" };
    } else if (intent.side === "BUY" && (config?.watchlistOnly ?? true) && !isWatchlisted) {
      decision = { status: "REJECTED", reason: "PAPER_WATCHLIST_REQUIRED", feePolicy: "PAPER_POLICY_V1" };
    } else if (
      intent.side === "BUY"
      && (!account || account.startingCash <= 0
        || (((position?.quantity ?? 0) + intent.quantity) * quote.price / account.startingCash) * 100 > maxPositionPct + 1e-9)
    ) {
      decision = { status: "REJECTED", reason: "PAPER_POSITION_CAP", feePolicy: "PAPER_POLICY_V1" };
    } else {
      decision = evaluatePaperOrder(intent, {
        quote,
        session,
        cash: account?.cash ?? 0,
        heldQuantity: position?.quantity ?? 0,
      });
    }

    const expiresAt = null;
    const resolvedAt = now;
    const inserted = tx.insert(schema.paperOrders).values({
      instrumentId: intent.instrument.id,
      side: intent.side,
      quantity: intent.quantity,
      orderType: intent.orderType,
      limitPrice: intent.limitPrice ?? null,
      status: decision.status,
      quotePrice: quote.price,
      fillPrice: decision.status === "FILLED" ? decision.fillPrice : null,
      fees: decision.status === "FILLED" ? decision.fees : 0,
      currency: intent.instrument.currency,
      reason: decision.status === "FILLED" ? decision.feePolicy : decision.reason,
      idempotencyKey: intent.idempotencyKey,
      createdAt: now,
      filledAt: decision.status === "FILLED" ? now : null,
      expiresAt,
      resolvedAt,
      quoteProvider: quote.provenance.provider,
      quoteSourceId: quote.provenance.sourceId,
      quoteQuality: quote.provenance.quality,
      simulatedFixture: quote.provenance.provider === "TEST_FIXTURE",
    }).run();
    const orderId = Number(inserted.lastInsertRowid);

    if (decision.status === "FILLED") {
      if (!account) throw new Error(`Missing ${intent.instrument.currency} paper account.`);
      const oldQuantity = position?.quantity ?? 0;
      const oldAverageCost = position?.averageCost ?? 0;
      const newQuantity = intent.side === "BUY" ? oldQuantity + intent.quantity : oldQuantity - intent.quantity;
      const totalBuyCost = decision.fillPrice * intent.quantity + decision.fees;
      const newAverageCost = intent.side === "BUY"
        ? (oldQuantity * oldAverageCost + totalBuyCost) / newQuantity
        : newQuantity <= 1e-9 ? 0 : oldAverageCost;
      const realizedPnl = intent.side === "SELL"
        ? (position?.realizedPnl ?? 0) + (decision.fillPrice - oldAverageCost) * intent.quantity - decision.fees
        : position?.realizedPnl ?? 0;

      tx.update(schema.paperAccounts)
        .set({ cash: account.cash + decision.cashDelta, updatedAt: now })
        .where(eq(schema.paperAccounts.currency, intent.instrument.currency))
        .run();
      tx.insert(schema.paperPositions)
        .values({
          instrumentId: intent.instrument.id,
          quantity: newQuantity,
          averageCost: newAverageCost,
          realizedPnl,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: schema.paperPositions.instrumentId,
          set: { quantity: newQuantity, averageCost: newAverageCost, realizedPnl, updatedAt: now },
        })
        .run();
      tx.insert(schema.paperLedger).values([
        {
          currency: intent.instrument.currency,
          instrumentId: intent.instrument.id,
          orderId,
          entryType: "CASH",
          cashDelta: decision.cashDelta,
          quantityDelta: 0,
          createdAt: now,
        },
        {
          currency: intent.instrument.currency,
          instrumentId: intent.instrument.id,
          orderId,
          entryType: "POSITION",
          cashDelta: 0,
          quantityDelta: intent.side === "BUY" ? intent.quantity : -intent.quantity,
          createdAt: now,
        },
      ]).run();
    }

    return {
      order: tx.select().from(schema.paperOrders).where(eq(schema.paperOrders.id, orderId)).get()!,
      idempotentReplay: false,
    };
  });
}

export function expireOpenPaperOrders(asOf = new Date()): void {
  getDb()
    .update(schema.paperOrders)
    .set({ status: "EXPIRED", reason: "DAY_ORDER_EXPIRED", resolvedAt: asOf })
    .where(and(eq(schema.paperOrders.status, "OPEN"), lte(schema.paperOrders.expiresAt, asOf)))
    .run();
}

export function listPaperOrders(limit = 100, asOf = new Date()) {
  expireOpenPaperOrders(asOf);
  return getDb().select().from(schema.paperOrders).orderBy(desc(schema.paperOrders.createdAt)).limit(Math.min(limit, 500)).all();
}

export function readPaperPortfolio() {
  const db = getDb();
  return {
    accounts: db.select().from(schema.paperAccounts).all(),
    positions: db.select().from(schema.paperPositions).all(),
    orders: listPaperOrders(50),
  };
}
