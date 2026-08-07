import { getMarketPhase } from "@/lib/market/phases";
import type { Market } from "@/lib/market/types";

/**
 * Plain-language explanations for paper-order outcomes.
 *
 * The finding this exists to fix: pressing "place order" produced `REJECTED · STALE`, and
 * nothing else. The refusal was correct — filling against a price that may be minutes old
 * manufactures a profit that never happened, and every forward observation built on it would be
 * worthless. But a one-word reason is not an explanation, and the person pressing the button has
 * no way to learn what to do about it.
 *
 * Three things each explanation must carry, because the absence of any one of them is what made
 * the original unusable:
 *
 *   what happened · why the system refused · whether it is your order or the data at fault
 *
 * That last one matters most. A user who thinks their order was wrong will keep editing it; a
 * user who knows the price feed is unreachable will go and fix the feed.
 */

export type Blame = "your_order" | "market_data" | "risk_policy" | "unknown";

export interface Explanation {
  headline: string;
  detail: string;
  blame: Blame;
  /** What the operator can actually do. Null when nothing they control will change it. */
  remedy: string | null;
  /** Where to look. Null when the answer is not on another screen. */
  href: string | null;
}

const EXPLANATIONS: Readonly<Record<string, Explanation>> = Object.freeze({
  INELIGIBLE_QUOTE: {
    headline: "Not filled — the price was too old to trade against.",
    detail:
      "A paper fill has to use a price that was actually available at the moment of the order. Filling at a stale one would invent a profit or loss that never happened, and every result built on it afterwards would be meaningless.",
    blame: "market_data",
    remedy: "Check whether the price provider is reachable. Nothing about the order itself is wrong — the same order will fill once a live quote arrives.",
    href: "/data-quality",
  },
  NO_QUOTE: {
    headline: "Not filled — no price was available at all.",
    detail: "The provider returned nothing for this instrument, so there was no price to fill against. This is an absence of data, not a price of zero.",
    blame: "market_data",
    remedy: "Confirm the instrument is one the provider covers, and that the provider is reachable.",
    href: "/data-quality",
  },
  INSUFFICIENT_CASH: {
    headline: "Not filled — the account does not hold enough cash.",
    detail: "The paper account is funded separately per currency, and this order costs more than the balance in that currency.",
    blame: "your_order",
    remedy: "Reduce the quantity, or sell an existing position first.",
    href: null,
  },
  INSUFFICIENT_POSITION: {
    headline: "Not filled — you do not hold enough to sell.",
    detail: "The paper engine does not open short positions, so a sell is limited to what is already held.",
    blame: "your_order",
    remedy: "Reduce the quantity to what the position actually holds.",
    href: null,
  },
  POSITION_CAP: {
    headline: "Blocked by the position ceiling.",
    detail: "The risk kernel caps how large a single position may become. That ceiling is owner-set and cannot be raised by the system itself.",
    blame: "risk_policy",
    remedy: "Reduce the quantity, or review the ceilings.",
    href: "/trades",
  },
  DAILY_ORDER_CAP: {
    headline: "Blocked — the daily order limit is reached.",
    detail: "A cap on orders per day exists so a malfunction cannot turn into a hundred trades. It resets tomorrow.",
    blame: "risk_policy",
    remedy: "Wait for the next session, or review the ceilings.",
    href: "/trades",
  },
  EXPIRED: {
    headline: "Expired before it could fill.",
    detail: "A limit order that never crossed is expired rather than left resting, so the ledger shows what actually happened rather than an order that quietly lingers.",
    blame: "your_order",
    remedy: "Move the limit price closer to the market, or use a market order.",
    href: null,
  },
});

/**
 * @param reason The order's stored reason code. A fill carries a fee-schedule id here rather
 *   than a refusal, which is why the status is checked first by the caller.
 */
export function explainRejection(
  reason: string | null,
  quality?: string | null,
  // Optional so every existing caller keeps working. Supplied, it turns the commonest rejection
  // from a provider bug report into a clock reading.
  market?: Market,
  at: Date = new Date(),
): Explanation {
  const known = reason ? EXPLANATIONS[reason] : undefined;

  // The rejection that made the trading surface look broken for nineteen hours a day.
  //
  // `INELIGIBLE_QUOTE · STALE` is correct — filling against a price that is hours old invents a
  // profit that never happened, and the paper ledger feeds loss memory, which feeds risk posture,
  // so one invented fill contaminates every ceiling derived from it afterwards. The rule stays.
  //
  // What was wrong is the *remedy*. It sent the operator to /data-quality to debug a provider
  // that was working perfectly, when the real answer was that the exchange was shut. A refusal
  // that misnames its own cause is worse than a terse one: it spends the reader's time.
  if (market && (known?.blame === "market_data" || quality === "STALE" || quality === "DELAYED")) {
    const phase = getMarketPhase(market, at);
    if (phase.sessionState === "CLOSED") {
      const open = phase.nextSessionOpen;
      return {
        headline: "Not filled — the market is closed, so the price is hours old.",
        detail:
          `${market === "IN" ? "NSE" : "US"} equities are shut (${phase.localTime} ${phase.timezone}). ` +
          "A paper fill has to use a price that was actually available at the moment of the order, and " +
          "the last one is stale by definition outside the session. The order is fine; the clock is not.",
        blame: "market_data",
        remedy: open
          ? `Place it after the market reopens — ${open.weekday} ${open.date} at ${open.localTime} ${phase.timezone}.`
          : "Place it once the market reopens.",
        // Deliberately not /data-quality. Nothing there is broken, and sending someone to a
        // healthy diagnostics page teaches them the page is useless.
        href: "/premarket",
      };
    }
  }

  if (known) return known;

  // A stale quote can arrive with a reason this table does not know. The quality field still
  // tells the operator the useful half — that the data, not the order, is the problem.
  if (quality === "STALE" || quality === "DELAYED") {
    return {
      ...EXPLANATIONS.INELIGIBLE_QUOTE,
      headline: `Not filled — the price was ${quality.toLowerCase()}.`,
    };
  }

  return {
    headline: "Not filled.",
    // Never invent a cause. An unrecognised code means the ledger knows something this screen
    // does not, and saying so is more use than a confident guess.
    detail: reason
      ? `The engine refused it with the code ${reason}, which this screen does not have an explanation for. The order ledger below records exactly what happened.`
      : "The engine refused it and recorded no reason, which is itself worth investigating.",
    blame: "unknown",
    remedy: null,
    href: "/audit",
  };
}

export const BLAME_LABEL: Readonly<Record<Blame, string>> = Object.freeze({
  your_order: "your order",
  market_data: "the price feed",
  risk_policy: "a risk ceiling",
  unknown: "unknown",
});
