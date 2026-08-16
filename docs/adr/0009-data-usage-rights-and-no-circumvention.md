# ADR 0009 — Data usage rights are a first-class refusal, and blocks are not routed around

**Status**: Accepted, 2026-08-16 (owner directive)
**Supersedes**: nothing. **Applies to**: every present and future data source.

## Context

MarketPulse probed NSE's equity-quote surface for company classification and received HTTP 403 on
sixty consecutive server-side requests. The classification is genuinely published and visible in a
browser, and the technical means to obtain it anyway are readily available: a headless browser
(Crawl4AI, Playwright) can run persistent Chromium, execute JavaScript, reuse sessions and extract
dynamic content; cookie replay and proxy rotation would extend that further.

None of that makes the collection permitted. NSE's Terms of Use prohibit systematic or automated
collection — scraping, data mining, extraction, harvesting — and govern commercial market-data use
through separate NSE Data agreements. Yahoo's terms likewise prohibit automated collection without
prior permission, and `yfinance` states it is intended for research and education with Yahoo
Finance data intended for personal use.

The failure mode this ADR prevents is not a legal one in the abstract. It is that a research
prototype quietly becomes a product standing on data it has no right to use, discovered only when
the product matters.

## Decision

**1. A block is an answer, not an obstacle.** Where a source's terms prohibit automated
collection, MarketPulse does not circumvent its technical enforcement. Headless browsers, session
replay, cookie harvesting, proxy or user-agent rotation, and CAPTCHA solving are out of bounds for
such sources regardless of how well they would work. The 403 is recorded as the finding and the
data is treated as unavailable to this system.

**2. Usage rights are checked BEFORE technical capability.** `lib/market/source-usage-policy.ts`
declares, per source: `automationStatus`, `commercialUse`, `redistribution`, `sourceTermsUrl`,
`termsVerifiedAt`, and an explicit `allowedPurposes` whitelist over
IDENTITY / DISPLAY / RESEARCH / BACKTEST / VALIDATION / LIVE_TRADING. `canSatisfy()` consults it
first and returns the usage refusal ahead of any capability answer.

**3. Unknown and stale are not permissions.** A source with no declared policy returns
`SOURCE_TERMS_UNKNOWN`; a policy whose terms were last read beyond `TERMS_FRESHNESS_DAYS`
returns `SOURCE_TERMS_STALE`. Neither is treated as allowed. This mirrors the capability-claim
rule adopted the same day.

**4. Commercial use is a switch that REVOKES.** `MARKETPULSE_COMMERCIAL_USE=1` withdraws every
source whose terms permit personal research only — Yahoo among them — rather than granting
anything. Turning MarketPulse into a product therefore fails closed on data rights by
construction.

**5. Research crawling is a different lane with a hard output boundary.** See ADR 0010.

## Consequences

- The sector-classification gap for the ~1,377 non-index main-board names stays open. It is
  closed by NSE Indices' licensed product or by a permitted source — not by scraping.
- Yahoo remains excellent for this research build and is refused for VALIDATION and LIVE_TRADING
  on rights, independently of the data-quality refusal the ingest path already records
  (`unfitForValidation`: unadjusted prices, no delisted names). Two axes, two reasons, both true.
- `jugaad-data`, `openchart` and `nsepython` are classified RESEARCH-only until usage rights are
  confirmed, because their mechanism reaches NSE's site. None can become an invisible production
  fallback.
- Only the authenticated broker API (Upstox V3) is permitted for LIVE_TRADING — asserted by test.
