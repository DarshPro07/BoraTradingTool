/**
 * Market Rule Versioning — NSE market rules change over time.
 *
 * Critical: NSE introduced a new Closing Auction Session in August 2026 for eligible securities,
 * changing closing-price formation versus the previous 30-minute-average method.
 *
 * So: close semantics 2015 != close semantics 2026.
 *
 * The data model must carry:
 *   marketRuleVersion
 *   sessionType
 *   closingMechanism
 *   effectiveFrom
 *   effectiveTo
 */

export type ClosingMechanism = "VWAP_30MIN" | "CLOSING_AUCTION" | "LAST_TRADE" | "UNKNOWN";
export type SessionType = "REGULAR" | "PRE_OPEN" | "CLOSING_AUCTION" | "POST_CLOSE";

export interface MarketRuleVersion {
  ruleId: string;
  exchange: "XNSE" | "XBOM";
  market: "IN";
  effectiveFrom: Date;
  effectiveTo: Date | null;
  sessionType: SessionType;
  closingMechanism: ClosingMechanism;
  description: string;
  source: string;
}

/**
 * Known NSE market rule versions.
 */
export const MARKET_RULES: ReadonlyArray<MarketRuleVersion> = [
  {
    ruleId: "NSE-2015-VWAP",
    exchange: "XNSE",
    market: "IN",
    effectiveFrom: new Date("2015-01-01"),
    effectiveTo: new Date("2026-08-02"),
    sessionType: "REGULAR",
    closingMechanism: "VWAP_30MIN",
    description: "Closing price = VWAP of last 30 minutes of regular session",
    source: "NSE historical rules",
  },
  {
    ruleId: "NSE-2026-AUCTION",
    exchange: "XNSE",
    market: "IN",
    effectiveFrom: new Date("2026-08-03"),
    effectiveTo: null,
    sessionType: "CLOSING_AUCTION",
    closingMechanism: "CLOSING_AUCTION",
    description: "New Closing Auction Session for eligible securities — closing price formed by auction",
    source: "NSE circular, August 2026",
  },
];

/**
 * Get the applicable market rule for a given date and exchange.
 */
export function getMarketRuleForDate(exchange: "XNSE" | "XBOM", date: Date): MarketRuleVersion {
  for (const rule of MARKET_RULES) {
    if (rule.exchange === exchange && date >= rule.effectiveFrom && (rule.effectiveTo === null || date <= rule.effectiveTo)) {
      return rule;
    }
  }
  // Default to the most recent rule.
  return MARKET_RULES[MARKET_RULES.length - 1];
}

/**
 * Check if a date falls under the new closing auction rules.
 */
export function isClosingAuctionPeriod(date: Date, exchange: "XNSE" | "XBOM"): boolean {
  const rule = getMarketRuleForDate(exchange, date);
  return rule.closingMechanism === "CLOSING_AUCTION";
}

/**
 * Get the closing mechanism for a given date range.
 * Returns the dominant mechanism (the one covering most of the range).
 */
export function getClosingMechanismForRange(
  exchange: "XNSE" | "XBOM",
  from: Date,
  to: Date,
): ClosingMechanism {
  const midDate = new Date((from.getTime() + to.getTime()) / 2);
  return getMarketRuleForDate(exchange, midDate).closingMechanism;
}
