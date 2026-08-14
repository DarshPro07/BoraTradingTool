import { FlaskConical, TriangleAlert } from "lucide-react";

/**
 * What this server is, stated in the chrome of every page.
 *
 * ## Why the data mode belongs here
 *
 * The owner opened `http://127.0.0.1:3100/dashboard?market=NSE` and saw a wall of ₹1,000 prices
 * with identical changes. Port 3100 is the Playwright e2e port, and `playwright.config.ts` starts
 * that server with `MARKETPULSE_TEST_MODE=1`, under which `fixtureQuote` serves every NSE security
 * outside a three-entry price table at ₹1,000 with `changePct: 0.5`. `npm run dev` runs on :3000
 * and serves real Yahoo data — the product's default was never fake.
 *
 * So the failure was not the data. It was that nothing on screen distinguished one server from the
 * other. A dashboard-only warning is not enough either: /analyze, /scanner and every other market
 * surface read the same fixtures, and a warning that appears on one page teaches nobody anything
 * about the next one.
 *
 * This badge is rendered by the root layout, so it is on every page, and it answers the one
 * question that matters before any number is read: are these real prices?
 */
/**
 * `fixtureData` is a PROP, not a direct env read.
 *
 * `TopNav` is a client component, so anything rendered inside it is client code, where a
 * non-`NEXT_PUBLIC_` variable is simply `undefined` — the badge would have silently reported REAL
 * on a fixture server, which is the exact failure it exists to prevent. The root layout is a
 * server component and reads the flag there.
 */
export function ModeBadge({ fixtureData }: { fixtureData: boolean }) {
  if (fixtureData) {
    return (
      <span
        className="mode-badge mode-badge-warning"
        title={
          "MARKETPULSE_TEST_MODE=1. Quotes, candles and everything derived from them are " +
          "deterministic test fixtures, not market data. Start the server without this flag " +
          "(npm run dev) for real prices."
        }
        data-testid="mode-badge"
        data-data-mode="FIXTURE"
      >
        <TriangleAlert className="w-3 h-3" /> DEMO DATA
      </span>
    );
  }

  return (
    <span
      className="mode-badge"
      title="Paper Research Mode. Broker execution is disabled. Market data is live from the configured provider."
      data-testid="mode-badge"
      data-data-mode="REAL"
    >
      <FlaskConical className="w-3 h-3" /> PAPER
    </span>
  );
}
