/**
 * The Solana paper book — crypto paper trading against REAL Jupiter quotes, no wallet, no signing.
 *
 * A fill is the swap quote Jupiter returns for this exact size: its out amount already carries the
 * AMM fees and the price impact of the order, so paper pays what a real swap of that size would
 * have paid at that moment — not a mid price with a guessed spread. On top of it sits a stated
 * network-fee assumption.
 *
 * Kept apart from the NSE paper engine on purpose: different asset, currency, costs, hours (none)
 * and risks. Nothing here can reach `lib/paper`'s accounts.
 *
 * NOT modelled: Indian tax on crypto (flat 30% on gains, 1% TDS on transfers), which any real edge
 * must also clear; and MEV/sandwich loss beyond the quoted slippage.
 */
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getSwapQuote, USDC_DECIMALS, USDC_MINT, type JupiterQuote, type JupiterToken } from "./jupiter";

/** Solana base + priority fee per swap, stated not measured: ~0.0001 SOL at ~$150. */
export const ASSUMED_NETWORK_FEE_USDC = 0.02;
/** Refuse a fill that moves the market more than this: the quote is then the cost, not the price. */
export const MAX_PRICE_IMPACT = 0.01;
/** Largest position as a share of starting capital. Same spirit as the NSE engine's cap. */
export const MAX_POSITION_PCT = 25;
export const DAILY_ORDER_CAP = 10;

export type CryptoDecision =
  | { status: "FILLED"; quantity: number; usdc: number; fillPrice: number; fees: number; cashDelta: number }
  | { status: "REJECTED"; reason: string };

/** Pure: whether and how this order fills. Every rule that can refuse lives here. */
export function decideCryptoOrder(input: {
  side: "BUY" | "SELL";
  token: Pick<JupiterToken, "verified" | "decimals">;
  quote: Pick<JupiterQuote, "inAmount" | "outAmount" | "priceImpact">;
  /** BUY: USDC spent. SELL: tokens sold. */
  amount: number;
  cash: number;
  startingCash: number;
  heldQuantity: number;
  heldCostBasis: number;
  ordersToday: number;
}): CryptoDecision {
  const reject = (reason: string): CryptoDecision => ({ status: "REJECTED", reason });
  if (!input.token.verified) return reject("UNVERIFIED_TOKEN");
  if (!(input.amount > 0)) return reject("INVALID_AMOUNT");
  if (input.ordersToday >= DAILY_ORDER_CAP) return reject("CRYPTO_DAILY_ORDER_CAP");
  if (input.quote.priceImpact > MAX_PRICE_IMPACT) return reject("PRICE_IMPACT_TOO_HIGH");

  if (input.side === "BUY") {
    const required = input.amount + ASSUMED_NETWORK_FEE_USDC;
    if (required > input.cash + 1e-9) return reject("INSUFFICIENT_CASH");
    if (((input.heldCostBasis + input.amount) / input.startingCash) * 100 > MAX_POSITION_PCT + 1e-9) {
      return reject("CRYPTO_POSITION_CAP");
    }
    const quantity = input.quote.outAmount / 10 ** input.token.decimals;
    return {
      status: "FILLED",
      quantity,
      usdc: input.amount,
      fillPrice: input.amount / quantity,
      fees: ASSUMED_NETWORK_FEE_USDC,
      cashDelta: -required,
    };
  }

  if (input.amount > input.heldQuantity + 1e-12) return reject("INSUFFICIENT_HOLDINGS");
  const proceeds = input.quote.outAmount / 10 ** USDC_DECIMALS;
  return {
    status: "FILLED",
    quantity: input.amount,
    usdc: proceeds,
    fillPrice: proceeds / input.amount,
    fees: ASSUMED_NETWORK_FEE_USDC,
    cashDelta: proceeds - ASSUMED_NETWORK_FEE_USDC,
  };
}

/** Quote, decide and record one paper swap. The quote is fetched here so the fill is this moment's. */
export async function placeCryptoPaperOrder(input: {
  token: JupiterToken;
  side: "BUY" | "SELL";
  amount: number;
  thesis: string;
  idempotencyKey: string;
  now?: Date;
}) {
  const db = getDb();
  const now = input.now ?? new Date();
  const existing = db
    .select()
    .from(schema.cryptoPaperOrders)
    .where(eq(schema.cryptoPaperOrders.idempotencyKey, input.idempotencyKey))
    .get();
  if (existing) return { order: existing, replay: true };

  const atomic = BigInt(Math.floor(input.amount * 10 ** (input.side === "BUY" ? USDC_DECIMALS : input.token.decimals)));
  const quote = await getSwapQuote(
    input.side === "BUY"
      ? { inputMint: USDC_MINT, outputMint: input.token.mint, amount: atomic }
      : { inputMint: input.token.mint, outputMint: USDC_MINT, amount: atomic },
  );

  return db.transaction((tx) => {
    const account = tx.select().from(schema.cryptoPaperAccounts).where(eq(schema.cryptoPaperAccounts.asset, "USDC")).get();
    if (!account) throw new Error("No USDC crypto paper account.");
    const position = tx.select().from(schema.cryptoPaperPositions).where(eq(schema.cryptoPaperPositions.mint, input.token.mint)).get();
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const ordersToday = tx
      .select()
      .from(schema.cryptoPaperOrders)
      .all()
      .filter((o) => o.status === "FILLED" && o.createdAt >= dayStart).length;

    const held = position?.quantity ?? 0;
    const decision = decideCryptoOrder({
      side: input.side,
      token: input.token,
      quote,
      amount: input.amount,
      cash: account.cash,
      startingCash: account.startingCash,
      heldQuantity: held,
      heldCostBasis: held * (position?.averageCost ?? 0),
      ordersToday,
    });

    const inserted = tx
      .insert(schema.cryptoPaperOrders)
      .values({
        mint: input.token.mint,
        symbol: input.token.symbol,
        side: input.side,
        quantity: decision.status === "FILLED" ? decision.quantity : 0,
        usdcAmount: decision.status === "FILLED" ? decision.usdc : 0,
        fillPrice: decision.status === "FILLED" ? decision.fillPrice : null,
        feesUsdc: decision.status === "FILLED" ? decision.fees : 0,
        priceImpact: quote.priceImpact,
        route: quote.route,
        status: decision.status,
        reason: decision.status === "REJECTED" ? decision.reason : null,
        thesis: input.thesis,
        idempotencyKey: input.idempotencyKey,
        createdAt: now,
      })
      .run();

    if (decision.status === "FILLED") {
      const quantity = input.side === "BUY" ? held + decision.quantity : held - decision.quantity;
      const averageCost =
        input.side === "BUY"
          ? (held * (position?.averageCost ?? 0) + decision.usdc + decision.fees) / quantity
          : quantity <= 1e-12 ? 0 : position!.averageCost;
      const realizedPnl =
        (position?.realizedPnl ?? 0) +
        (input.side === "SELL" ? decision.cashDelta - decision.quantity * (position?.averageCost ?? 0) : 0);
      tx.update(schema.cryptoPaperAccounts)
        .set({ cash: account.cash + decision.cashDelta, updatedAt: now })
        .where(eq(schema.cryptoPaperAccounts.asset, "USDC"))
        .run();
      tx.insert(schema.cryptoPaperPositions)
        .values({ mint: input.token.mint, symbol: input.token.symbol, quantity, averageCost, realizedPnl, updatedAt: now })
        .onConflictDoUpdate({
          target: schema.cryptoPaperPositions.mint,
          set: { quantity, averageCost, realizedPnl, updatedAt: now },
        })
        .run();
    }
    const order = tx
      .select()
      .from(schema.cryptoPaperOrders)
      .where(eq(schema.cryptoPaperOrders.id, Number(inserted.lastInsertRowid)))
      .get()!;
    return { order, replay: false };
  });
}

export function cryptoPaperState() {
  const db = getDb();
  return {
    account: db.select().from(schema.cryptoPaperAccounts).all(),
    positions: db.select().from(schema.cryptoPaperPositions).all().filter((p) => p.quantity > 1e-12),
    recentOrders: db.select().from(schema.cryptoPaperOrders).all().slice(-10),
  };
}
