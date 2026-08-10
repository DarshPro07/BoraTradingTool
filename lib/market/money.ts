import type { Currency } from "./types";

export function formatMoney(value: number, currency: Currency): string {
  return new Intl.NumberFormat(currency === "USD" ? "en-US" : "en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatCompactMoney(value: number, currency: Currency): string {
  const absolute = Math.abs(value);
  if (absolute >= 1e12) return `${formatMoney(value / 1e12, currency)}T`;
  if (absolute >= 1e9) return `${formatMoney(value / 1e9, currency)}B`;
  if (absolute >= 1e6) return `${formatMoney(value / 1e6, currency)}M`;
  return formatMoney(value, currency);
}
