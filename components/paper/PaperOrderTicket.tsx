"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FlaskConical, RefreshCw, ShieldCheck } from "lucide-react";
import { mutationFetch } from "@/lib/client/mutation-fetch";
import { InstrumentCombobox } from "@/components/market/InstrumentCombobox";
import { BLAME_LABEL, explainRejection, type Explanation } from "@/lib/paper/explain";
import type { Market } from "@/lib/market/types";

interface Account {
  currency: "USD" | "INR";
  startingCash: number;
  cash: number;
}

interface Position {
  instrumentId: string;
  quantity: number;
  averageCost: number;
  realizedPnl: number;
}

interface Order {
  id: number;
  instrumentId: string;
  side: "BUY" | "SELL";
  quantity: number;
  orderType: "MARKET" | "LIMIT";
  status: string;
  fillPrice: number | null;
  fees: number;
  currency: "USD" | "INR";
  reason: string | null;
  createdAt: string;
  quoteProvider: string | null;
  quoteSourceId: string | null;
  quoteQuality: string | null;
  simulatedFixture: boolean;
}

interface Portfolio {
  accounts: Account[];
  positions: Position[];
  orders: Order[];
}

export function PaperOrderTicket({ defaultInstrumentId = "US:XNAS:AAPL" }: { defaultInstrumentId?: string }) {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [instrumentId, setInstrumentId] = useState(defaultInstrumentId);
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [quantity, setQuantity] = useState("1");
  const [orderType, setOrderType] = useState<"MARKET" | "LIMIT">("MARKET");
  const [limitPrice, setLimitPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>("");
  const [error, setError] = useState<string | null>("");
  /** A refusal the engine explained, kept separate from a transport failure. */
  const [rejection, setRejection] = useState<Explanation | null>(null);

  async function load() {
    const response = await fetch("/api/paper/portfolio", { cache: "no-store" });
    if (response.ok) setPortfolio(await response.json());
  }

  useEffect(() => {
    void load();
  }, []);

  // Instrument ids are `MARKET:EXCHANGE:SYMBOL`, so the market is already in hand — which is what
  // lets a stale-quote refusal say "the exchange is shut until Monday 09:15" instead of sending
  // the operator to debug a price feed that is working perfectly.
  const market: Market | undefined = instrumentId.startsWith("IN:")
    ? "IN"
    : instrumentId.startsWith("US:")
      ? "US"
      : undefined;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await mutationFetch("/api/paper/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instrumentId,
          side,
          quantity: Number(quantity),
          orderType,
          limitPrice: orderType === "LIMIT" ? Number(limitPrice) : undefined,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setRejection(explainRejection(data.order?.reason ?? data.error ?? null, data.order?.quoteQuality, market));
        setError(null);
        await load();
        return;
      }

      // A 200 does not mean a fill. The engine records a rejection as a completed request with
      // a REJECTED status, and reporting that as success is how the button came to look dead:
      // it said "REJECTED" in the same tone it says "FILLED" and explained neither.
      if (data.order?.status === "REJECTED") {
        setRejection(explainRejection(data.order.reason ?? null, data.order.quoteQuality, market));
        setMessage(null);
      } else {
        setRejection(null);
        setMessage(`${data.order.status}: ${side} ${quantity} ${instrumentId}`);
      }
      await load();
    } catch {
      setError("The paper-order service is unavailable.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="paper-grid">
      <section className="terminal-panel p-5 paper-ticket">
        <div className="flex items-center gap-2 mb-1">
          <FlaskConical className="w-4 h-4 text-terminal" />
          <h2 className="text-sm font-bold">Paper order ticket</h2>
        </div>
        <p className="text-[11px] text-muted-foreground mb-5">
          Simulation only. This form cannot reach a broker.
        </p>

        <form onSubmit={submit} className="space-y-4">
          <InstrumentCombobox
            id="paper-instrument"
            label="Instrument"
            value={instrumentId}
            onValueChange={setInstrumentId}
            required
            labelClassName="field-label"
            storageKey="marketpulse.paper.instrument.v1"
          />

          <div className="grid grid-cols-2 gap-3">
            <label className="field-label">
              Side
              <select value={side} onChange={(event) => setSide(event.target.value as "BUY" | "SELL")} className="terminal-input mt-1">
                <option value="BUY">BUY PAPER</option>
                <option value="SELL">SELL PAPER</option>
              </select>
            </label>
            <label className="field-label">
              Quantity
              <input type="number" min="0.000001" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="terminal-input mt-1" required />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="field-label">
              Order type
              <select value={orderType} onChange={(event) => setOrderType(event.target.value as "MARKET" | "LIMIT")} className="terminal-input mt-1">
                <option value="MARKET">MARKET</option>
                <option value="LIMIT">LIMIT</option>
              </select>
            </label>
            <label className="field-label">
              Limit price
              <input
                type="number"
                min="0.0001"
                step="any"
                value={limitPrice}
                onChange={(event) => setLimitPrice(event.target.value)}
                className="terminal-input mt-1"
                disabled={orderType !== "LIMIT"}
                required={orderType === "LIMIT"}
              />
            </label>
          </div>

          <button type="submit" disabled={busy} className="terminal-action w-full">
            {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            {busy ? "SIMULATING..." : `PLACE ${side} PAPER ORDER`}
          </button>
        </form>
        <div aria-live="polite" className="mt-3 min-h-5 text-xs">
          {message && <p className="text-gain">{message}</p>}
          {error && <p role="alert" className="text-loss">{error}</p>}

          {/* A refusal, explained. `REJECTED · STALE` on its own left the operator unable to
              tell whether their order was wrong or the price feed was down — and those call for
              opposite responses. */}
          {rejection && (
            <div
              role="alert"
              className="border border-amber/40 bg-amber/5 px-3 py-2 space-y-1"
              data-testid="rejection-explanation"
            >
              <p className="text-amber font-semibold">{rejection.headline}</p>
              <p className="text-muted-foreground leading-relaxed">{rejection.detail}</p>
              <p className="text-[11px]">
                <span className="text-muted-foreground">Cause: </span>
                <span className={rejection.blame === "your_order" ? "text-foreground" : "text-amber"}>
                  {BLAME_LABEL[rejection.blame]}
                </span>
              </p>
              {rejection.remedy && (
                <p className="text-[11px] leading-relaxed" data-testid="rejection-remedy">
                  → {rejection.remedy}
                </p>
              )}
              {rejection.href && (
                <Link href={rejection.href} className="text-[11px] text-terminal hover:underline inline-block">
                  Look there →
                </Link>
              )}
            </div>
          )}
        </div>
      </section>

      <div className="space-y-4 min-w-0">
        <section className="grid sm:grid-cols-2 gap-3">
          {(portfolio?.accounts ?? []).map((account) => (
            <div key={account.currency} className="terminal-panel p-4">
              <p className="terminal-kicker">{account.currency} PAPER LEDGER</p>
              <p className="text-2xl font-bold mt-2">{money(account.cash, account.currency)}</p>
              <p className="text-[11px] text-muted-foreground mt-1">
                Start {money(account.startingCash, account.currency)} · {((account.cash / account.startingCash) * 100).toFixed(1)}% cash
              </p>
            </div>
          ))}
        </section>

        <section className="terminal-panel overflow-hidden">
          <div className="panel-heading">
            <span>Paper positions</span>
            <span>{portfolio?.positions.filter((position) => position.quantity > 0).length ?? 0} OPEN</span>
          </div>
          <div className="overflow-x-auto">
            <table className="terminal-table">
              <thead><tr><th>Instrument</th><th>Qty</th><th>Avg cost</th><th>Realized P/L</th></tr></thead>
              <tbody>
                {(portfolio?.positions ?? []).filter((position) => position.quantity > 0).map((position) => {
                  const currency = position.instrumentId.startsWith("IN:") ? "INR" : "USD";
                  return (
                    <tr key={position.instrumentId}>
                      <td><Link className="text-terminal" href={`/analyze/${encodeURIComponent(position.instrumentId)}`}>{position.instrumentId}</Link></td>
                      <td>{position.quantity}</td>
                      <td>{money(position.averageCost, currency)}</td>
                      <td className={position.realizedPnl >= 0 ? "text-gain" : "text-loss"}>{money(position.realizedPnl, currency)}</td>
                    </tr>
                  );
                })}
                {!portfolio?.positions.some((position) => position.quantity > 0) && (
                  <tr><td colSpan={4} className="text-muted-foreground text-center py-8">No paper positions yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="terminal-panel overflow-hidden">
          <div className="panel-heading"><span>Paper order tape</span><span>ESTIMATED FEES</span></div>
          <div className="overflow-x-auto">
            <table className="terminal-table">
              <thead><tr><th>Status</th><th>Order</th><th>Evidence</th><th>Fill</th><th>Fees</th></tr></thead>
              <tbody>
                {(portfolio?.orders ?? []).map((order) => (
                  <tr key={order.id}>
                    <td className={order.status === "FILLED" ? "text-gain" : order.status === "REJECTED" ? "text-loss" : "text-amber"}>{order.status}</td>
                    <td>{order.side} {order.quantity} {order.instrumentId}</td>
                    <td title={order.quoteSourceId ?? undefined}>{order.simulatedFixture ? "FIXTURE" : order.quoteQuality ?? order.quoteProvider ?? "UNKNOWN"}</td>
                    <td>{order.fillPrice == null ? "-" : money(order.fillPrice, order.currency)}</td>
                    <td>{money(order.fees, order.currency)}</td>
                  </tr>
                ))}
                {!portfolio?.orders.length && (
                  <tr><td colSpan={5} className="text-muted-foreground text-center py-8">No paper orders yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function money(value: number, currency: "USD" | "INR") {
  return new Intl.NumberFormat(currency === "USD" ? "en-US" : "en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}
