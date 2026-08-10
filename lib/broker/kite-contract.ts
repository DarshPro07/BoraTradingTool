/**
 * The contract a future Kite (Zerodha) adapter must satisfy. **Types and configuration boundary
 * only — there is no implementation behind this file, and nothing here can reach a broker.**
 *
 * ## Why this exists now, unimplemented
 *
 * ADR 0006 decision 1: execution becomes automatic once a strategy clears forward evidence
 * (>= 20 resolved observations, mean positive beyond its own error). Building toward that needs a
 * seam to build against; this file is that seam, and only that.
 *
 * ## The boundaries that keep it honest
 *
 * - `place_order` is in `AUTONOMOUS_PROHIBITED` and `/api/trade/place` returns
 *   `EXECUTION_ADAPTER_MISSING`. Neither changes here. Lifting them is an owner-only edit to a
 *   protected file, made after — not before — an implementation of this contract has been built
 *   and verified.
 * - Credentials come from local environment configuration (`KITE_API_KEY`, `KITE_API_SECRET`),
 *   never from chat, never from the database, never read by this module beyond presence checks.
 * - Nothing importing this file may claim integration has been tested. It has not: no credentials
 *   exist in this environment, and pretending otherwise is exactly the fabrication this
 *   repository refuses elsewhere.
 */

export interface KiteCredentialStatus {
  configured: boolean;
  /** Which variables are missing, by name — never their values. */
  missing: string[];
  note: string;
}

/**
 * Presence check only. Values are never read into memory beyond `!== undefined`, never logged,
 * never returned.
 */
export function kiteCredentialsConfigured(
  env: Readonly<Record<string, string | undefined>> = process.env,
): KiteCredentialStatus {
  const required = ["KITE_API_KEY", "KITE_API_SECRET"] as const;
  const missing = required.filter((name) => !env[name]?.trim());
  return {
    configured: missing.length === 0,
    missing: [...missing],
    note:
      missing.length === 0
        ? "Kite credentials are present in the local environment. No adapter exists yet to use them."
        : `Set ${missing.join(" and ")} in the local environment when integration begins. They are ` +
          "never supplied through chat or stored in the database.",
  };
}

/** An order this system would submit — fully specified, nothing inferred at the boundary. */
export interface KiteOrderRequest {
  readonly instrumentId: string;
  readonly exchange: "NSE";
  readonly side: "BUY" | "SELL";
  readonly quantity: number;
  readonly product: "MIS" | "CNC";
  readonly orderType: "MARKET" | "LIMIT";
  readonly limitPrice?: number;
  /** The strategy whose forward evidence authorised this order. Required, never optional. */
  readonly strategySpecId: string;
  /** The forward-evidence snapshot hash the authorisation was computed from. */
  readonly evidenceHash: string;
}

export interface KiteOrderAck {
  readonly brokerOrderId: string;
  readonly placedAt: string;
  readonly status: "OPEN" | "COMPLETE" | "REJECTED" | "CANCELLED";
  readonly statusMessage: string | null;
}

export interface KitePosition {
  readonly instrumentId: string;
  readonly product: "MIS" | "CNC";
  readonly quantity: number;
  readonly averagePrice: number;
}

/**
 * What an adapter implementation must provide. Unimplemented by design — see the module header.
 * The read side and the mutate side are separated so a read-only implementation can exist first
 * and be verified without any order-placement capability ever being constructed.
 */
export interface KiteReadAdapter {
  positions(): Promise<readonly KitePosition[]>;
  orderStatus(brokerOrderId: string): Promise<KiteOrderAck>;
}

export interface KiteTradeAdapter extends KiteReadAdapter {
  /**
   * Gated, in order, by: the governance policy (currently prohibits it), the risk gate, and the
   * forward-evidence promotion. An implementation that skips any of the three does not satisfy
   * this contract, whatever its type signature says.
   */
  placeOrder(request: KiteOrderRequest): Promise<KiteOrderAck>;
}
