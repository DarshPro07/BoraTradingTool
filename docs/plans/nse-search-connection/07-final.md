# Final - NSE search connection

## Verdict: VERIFIED

## Result

The owner database is connected to the official NSE main-board and SME sources with 2,972 current
listings. `bector food` resolves to `IN:XNSE:BECTORFOOD`, ISIN `INE495P01020`, and opens the real
analysis page without the reported `InstrumentError` console output.

## Implementation

- Search handles compact symbols, punctuation, spaces, and company-name token prefixes.
- Unique exact identities or single results become canonical URLs; ambiguous queries require an
  explicit result selection.
- Missing NSE data is reported as unavailable instead of a false no-match response.
- Duplicate legal company names remain searchable but cannot masquerade as unique identity aliases.
- Expected invalid instrument URLs render the existing not-found state without unexpected-error
  logging.
- The analysis route exposes loading feedback while its server component resolves market data.

## Evidence

Focused Vitest passed 18/18. Full Vitest passed 1,373 tests with 2 skipped. TypeScript passed. Four
targeted Playwright tests passed across desktop and Pixel 7 with zero runtime console errors. The
live API and rendered analysis page were inspected directly. Full detail is in `06-verification.md`.

## Limitations

Provider availability for this listing is still `UNKNOWN`; the analysis currently succeeds through
the existing provider fallback and displayed ₹226.00 during verification. This fix connects official
identity/search data and does not claim a separately verified broker instrument mapping.

## Rollback

Revert the listed search, route, and UI changes. Do not delete the successful or failed sync audit
records; they are append-only operational evidence.
