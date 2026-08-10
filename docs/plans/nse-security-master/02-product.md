# Gate 1 - Product

## User problem

The operator can select only a small hand-maintained subset of NSE securities, while research
quietly treats that subset as the whole market. Current selection is incomplete and historical
results exclude securities that did not survive to today's list.

## User

The MarketPulse operator selecting securities for analysis, paper workflows, scanners, strategy
research, learning, and historical experiments.

## Current behavior

- Search and selectors expose 20 hardcoded XNSE rows.
- Multiple backend workflows enumerate that same list independently.
- Historical research can answer from today's survivors without an error.
- Listing existence and price-data support are conflated.

## Desired outcome

- The selectable NSE universe comes from the latest verified official NSE master.
- Every security has durable ISIN identity while current symbols remain usable in existing routes
  and stored records.
- Historical research asks for a dated universe and refuses dates the archive cannot support.
- Search remains fast and usable with thousands of listings on desktop and mobile.
- A listed security without supported prices remains visible as `LISTED - DATA NOT AVAILABLE` and
  cannot be mistaken for a delisted security.
- Sync failures are visible and preserve the last verified universe.

## Success evidence

- Official main-board and SME rows ingest without duplicate ISIN/listing identities.
- Symbol/name/ISIN/series search is bounded, paginated, and deterministic.
- A symbol change leaves the same ISIN security identity and preserves the old symbol as an alias.
- A security later marked inactive is present in an earlier as-of query and absent from the later
  tradable universe.
- Corrupt/empty/failed sync input leaves current selection unchanged and records the failure.
- Static XNSE entries can be removed from `catalog.ts` without breaking NSE selection.
- Browser workflows verify selection, refresh persistence, no-data labels, stale status, keyboard
  use, and mobile layout with no console/network errors.

## Failure conditions

- Any production path silently falls back to the hardcoded NSE array.
- A failed sync partially replaces or empties the current universe.
- ISIN changes when a symbol changes.
- An as-of query uses a row observed after the requested date.
- Missing history is represented as an empty market.
- A listed but unsupported security disappears from search.
- The UI renders thousands of `<option>` elements at once.

## Critical journeys

1. Search a current NSE security by symbol, name, or ISIN and open its existing analysis route.
2. Select an NSE security in AI and paper workflows; refresh and retain the canonical choice.
3. Filter current listings by series/classification and paginate results.
4. Inspect master freshness and distinguish current, stale, unavailable, and failed-sync states.
5. Build research data from an explicit as-of universe rather than today's list.
6. Encounter a listed security without market data and receive an honest non-actionable state.

## Non-goals

- Real broker execution, credential setup, or order routing.
- Rewriting existing candle and paper history to ISIN ids in this change.
- Claiming historical coverage before an authoritative archive is ingested.
- Inferring REIT/InvIT or suspension status from names when the official source does not state it.
- Replacing the US/BSE catalog in this feature.
