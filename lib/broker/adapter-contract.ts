import type { StrategyDsl } from "@/lib/strategy/dsl";

/**
 * The broker adapter CONTRACT (clean-room; concepts audited from Fenix/OpenAlgo, code from
 * neither — both carry copyleft licenses, and this repository copies nothing from them).
 *
 * Types only, deliberately: this is the seam future adapters (paper first, Kite later) implement.
 * No implementation lives here, no credential is referenced here, and nothing here can place an
 * order — `lib/trading/capabilities.ts` and the governance kernel still hold that door shut.
 *
 * ## The one rule the audit burned in
 *
 * **No adapter is assumed to support the full interface.** Every adapter DECLARES its
 * capabilities; callers check the declaration before calling, and an undeclared call is a
 * `PERMISSION_DENIED`-class error, never a silent no-op. OpenAlgo ships 35 brokers behind one
 * API precisely because strategy code never learns broker quirks — the declaration is how that
 * stays true.
 */

/** Canonical vocabulary at the boundary. Broker-specific strings are translated in adapters. */
export type OrderSide = "BUY" | "SELL";
export type OrderType = "MARKET" | "LIMIT" | "SL" | "SL_M";
export type ProductType = "INTRADAY" | "DELIVERY";
export type OrderValidity = "DAY" | "IOC";
export type OrderStatus =
  | "PENDING"
  | "OPEN"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELLED"
  | "REJECTED"
  | "EXPIRED";

export type BrokerCapability =
  | "realtime_quotes"
  | "historical_bars"
  | "depth_l5"
  | "market_orders"
  | "limit_orders"
  | "sl_orders"
  | "slm_orders"
  | "gtt"
  | "margin_api"
  | "fee_api"
  | "websocket_orders"
  | "paper_fills";

/** The unified error taxonomy (concept per Fenix; names ours). Adapters map into these, always. */
export type BrokerErrorCode =
  | "AUTHENTICATION"
  | "PERMISSION_DENIED"
  | "CAPABILITY_UNDECLARED"
  | "INSUFFICIENT_FUNDS"
  | "INSUFFICIENT_HOLDINGS"
  | "INVALID_ORDER"
  | "ORDER_NOT_FOUND"
  | "RATE_LIMITED"
  | "SESSION_EXPIRED"
  | "BROKER_UNAVAILABLE"
  | "RESPONSE_MALFORMED";

export class BrokerAdapterError extends Error {
  constructor(
    readonly code: BrokerErrorCode,
    message: string,
    /** The broker's raw code/message, preserved for the audit trail — never shown as ours. */
    readonly brokerDetail?: string,
  ) {
    super(message);
    this.name = "BrokerAdapterError";
  }
}

export interface AdapterDeclaration {
  brokerId: string;
  displayName: string;
  capabilities: readonly BrokerCapability[];
  /** Where credentials come from. NEVER command-line arguments (observable via process listing). */
  credentialSource: "env" | "os_credential_store" | "none";
}

export interface BrokerOrderIntent {
  instrumentId: string;
  side: OrderSide;
  quantity: number;
  orderType: OrderType;
  product: ProductType;
  validity: OrderValidity;
  limitPrice?: number;
  triggerPrice?: number;
}

export interface BrokerOrderRecord {
  brokerOrderId: string;
  intent: BrokerOrderIntent;
  status: OrderStatus;
  filledQuantity: number;
  averageFillPrice: number | null;
  placedAt: number;
  updatedAt: number;
  /** Raw broker status string, preserved beside the normalized one. */
  brokerStatus: string;
}

/**
 * The adapter interface. Read surface and trade surface are separate on purpose — MarketPulse's
 * MCP and research planes may see the read half; the trade half stays behind governance and, for
 * a real broker, behind credentials that only local secure configuration provides.
 */
export interface BrokerReadAdapter {
  declaration(): AdapterDeclaration;
  searchInstrument(query: string): Promise<{ instrumentId: string; symbol: string; name: string }[]>;
  quote(instrumentId: string): Promise<{ price: number; time: number }>;
  historicalBars(
    instrumentId: string,
    resolution: StrategyDsl["universe"]["resolution"],
    from: number,
    to: number,
  ): Promise<{ time: number; open: number; high: number; low: number; close: number; volume: number }[]>;
  funds(): Promise<{ available: number; used: number }>;
  positions(): Promise<{ instrumentId: string; quantity: number; averagePrice: number }[]>;
  orders(): Promise<BrokerOrderRecord[]>;
}

export interface BrokerTradeAdapter extends BrokerReadAdapter {
  placeOrder(intent: BrokerOrderIntent): Promise<BrokerOrderRecord>;
  modifyOrder(brokerOrderId: string, changes: Partial<BrokerOrderIntent>): Promise<BrokerOrderRecord>;
  cancelOrder(brokerOrderId: string): Promise<BrokerOrderRecord>;
}

/**
 * Guard: refuse a call the adapter never declared. Callers use this instead of hoping.
 */
export function requireCapability(declaration: AdapterDeclaration, capability: BrokerCapability): void {
  if (!declaration.capabilities.includes(capability)) {
    throw new BrokerAdapterError(
      "CAPABILITY_UNDECLARED",
      `${declaration.displayName} does not declare "${capability}". Calling anyway would fail somewhere ` +
        "less honest than here.",
    );
  }
}

/**
 * The paper adapter's declaration — the first concrete implementation target (WS1b). It exists
 * now so contract tests have something real to hold against before any broker code is written.
 */
export const PAPER_ADAPTER_DECLARATION: AdapterDeclaration = Object.freeze({
  brokerId: "PAPER",
  displayName: "MarketPulse paper broker",
  // Truth in declarations: the WS1b engine fills MARKET entries at next-bar-open and manages
  // protective stops as position state — it holds no resting LIMIT/SL order book yet, so it
  // does not claim one. Add the capability WITH the book, never before it.
  capabilities: Object.freeze([
    "historical_bars",
    "market_orders",
    "fee_api",
    "paper_fills",
  ]) as readonly BrokerCapability[],
  credentialSource: "none",
});

/**
 * Contract-test categories every future adapter suite must cover (from the OpenAlgo audit —
 * the CATEGORIES, not their code). Exported so the test suite enumerates them and fails when a
 * category is missing rather than quietly shrinking.
 */
export const BROKER_CONTRACT_TEST_CATEGORIES = Object.freeze([
  "common order schema",
  "common rejection schema",
  "status normalization",
  "timeout behavior",
  "rate limit (429) behavior",
  "auth expiry",
  "session rollover",
  "instrument mapping",
  "quote normalization",
  "order reconciliation",
] as const);
