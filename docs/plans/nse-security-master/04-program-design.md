# Gate 3 - Program design

## Files

- `drizzle/0011_nse_security_master.sql`: additive sync, security, listing-version, alias, and
  provider-mapping tables plus indexes.
- `lib/db/migrate.ts`: register migration 0011.
- `lib/db/schema.ts`: Drizzle declarations.
- `lib/market/security-master.ts`: parse, validate, sync, status, current/as-of/search repository.
- `lib/market/security-master.test.ts`: source parsing, identity, history, failure, and query tests.
- `lib/market/catalog.ts`: remove static XNSE rows; combine static non-NSE data with repository
  current data through compatibility functions.
- `lib/market/types.ts`: optional security-master metadata on `Instrument`.
- `lib/market/instruments.ts`: resolve current NSE identities and aliases through the repository.
- `app/api/market/instruments/route.ts`: bounded paginated search and status metadata.
- `components/market/InstrumentCombobox.tsx`: async, keyboard-accessible, bounded selector.
- `components/ai/AiResearchDesk.tsx`, `components/paper/PaperOrderTicket.tsx`,
  `components/layout/TopNav.tsx`: replace static datalists/raw navigation.
- Backend static-catalog consumers: migrate current NSE enumeration to the repository without
  changing US behavior.
- `scripts/sync-nse-security-master.mts`: explicit official-source sync command.
- `docs/external/nse-security-master-sources.md`: source/provenance record.
- `e2e/nse-security-master.spec.ts`: acceptance workflows.

## Types and contracts

- `SecurityMasterInstrument extends Instrument`: `securityId`, `isin`, `series`, `listingStatus`,
  `dataAvailability`, `effectiveFrom`, `effectiveTo`, `sourceSyncId`.
- `NseSourceRow`: strict normalized `symbol`, `name`, `series`, `dateOfListing`, `paidUpValue`,
  `marketLot`, `isin`, `faceValue`, `source`.
- `SecurityMasterSyncInput`: `observedAt`, complete source documents with URL and bytes, actor.
- `SecurityMasterSyncResult`: success/failure, sync id, hashes, counts, changes, preserved sync id.
- `InstrumentSearchResult`: records, total, limit, offset, master status.
- `SecurityMasterErrorCode`: malformed, duplicate, implausible drop, unavailable, not-yet-observed.

## Call flows

### Sync

Script fetches fixed official URLs -> parser validates all documents -> service starts transaction ->
records sync -> upserts ISIN securities -> closes changed/missing listing versions -> inserts new
versions/aliases -> marks success -> commits. Any exception rolls back listing changes and records a
failed attempt separately.

### Current search

UI types query -> debounced GET with bounded query/filter/offset -> repository searches current
effective rows -> API returns records plus freshness -> UI renders at most one page -> selection
passes the operational id and retains ISIN metadata.

### Historical universe

Research supplies `asOf` -> repository checks archive coverage -> latest effective listing per
security/series at date -> listed rows only -> caller loads stored candles by operational aliases.

## Error model

Expected source/sync failures are structured results and persisted attempt diagnostics. Invalid API
query parameters return 400. Unavailable master returns 503 with no static fallback. Historical
coverage failure is `NOT_YET_OBSERVED`. Missing market data is an instrument property and does not
remove the listing.

## Test design

- Parser accepts official headers/BOM/quoted names and rejects missing ISIN/series/symbol.
- First sync creates durable securities and listing versions.
- Symbol change preserves ISIN, closes old version, records old symbol alias, and resolves both.
- Missing row on a complete later sync becomes inactive only at the later observation.
- As-of query cannot see later rows and refuses before coverage.
- Empty/malformed/large-drop sync fails and preserves last-good current rows.
- Search matches symbol/name/ISIN, filters series, paginates deterministically, and exposes no-data.
- Migration applies twice and append-only history cannot be deleted.
- Mutation guard proves adding static XNSE entries or fallback selection fails tests.

Each regression test is run before implementation and must fail for the missing behavior rather
than for a test/setup error.

## Playwright journeys

1. Search RELIANCE by symbol and select it from bounded results.
2. Search by company name.
3. Search by ISIN.
4. Filter main-board versus SME series.
5. Use keyboard arrows/Enter/Escape in the selector.
6. Preserve selected canonical identity after refresh.
7. Open analysis through global search.
8. Select through AI controls without a giant datalist.
9. Select through paper controls without placing a real order.
10. Show `LISTED - DATA NOT AVAILABLE` for an unsupported fixture security.
11. Show stale/failed-last-sync status while retaining results.
12. Complete the selector journey at Pixel 7 viewport with no horizontal overflow.

Every browser journey inspects console exceptions and failed requests.

## Least-confident decisions

- A missing row in a complete source is treated as inactive at observation time. This requires a
  row-count/drop guard so a truncated source cannot delist most of the market.
- Provider data availability is initially mapping-based; broad provider probing is out of scope.
- Historical official archives remain unknown, so point-in-time correctness begins at the first
  successful observation/import.

## Rollback

Revert consumers to the previous catalog API while leaving additive tables unused. Do not delete
history or rewrite migration 0011 after application. Existing persisted ids remain valid throughout.
