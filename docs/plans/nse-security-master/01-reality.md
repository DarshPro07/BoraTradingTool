# Gate 0 - Reality

## Defect

- **STATICALLY_CONFIRMED:** `lib/market/catalog.ts` contains only 20 hardcoded XNSE rows and is
  treated as the current NSE universe.
- **STATICALLY_CONFIRMED:** 11 production modules import `INSTRUMENT_CATALOG` or
  `searchInstruments`; consumers include research snapshots, learning, pre-market, quant-core,
  execution, dashboard, watchlist, AI, paper, MCP, and scripts.
- **STATICALLY_CONFIRMED:** `lib/research-data/snapshot.ts` enumerates today's static catalog when
  building historical datasets. A delisted security cannot enter an older experiment, making
  survivor bias structural.
- **STATICALLY_CONFIRMED:** `lib/market/contract-master.ts` has correct point-in-time rules, but it
  is in-memory, imports the static catalog for current data, and is not the source used by the
  production enumerators above.
- **STATICALLY_CONFIRMED:** `components/ai/AiResearchDesk.tsx` and
  `components/paper/PaperOrderTicket.tsx` render the full static catalog in HTML datalists. That
  approach will not remain usable with roughly 3,000 NSE listings.
- **REPRODUCED:** the official NSE main-board CSV returned 2,397 rows (EQ 2,075, BE 294, BZ 28) and
  the SME CSV returned 560 rows (SM 412, ST 147, SZ 1) on 2026-08-09.

## Existing useful seams

- **STATICALLY_CONFIRMED:** SQLite + Drizzle already provide additive migrations and isolated test
  databases.
- **STATICALLY_CONFIRMED:** `Instrument` already separates application id, symbol, provider symbol,
  exchange, currency, timezone, and asset type.
- **STATICALLY_CONFIRMED:** the candle store and persisted paper data use symbol-based ids such as
  `IN:XNSE:RELIANCE`.
- **STATICALLY_CONFIRMED:** `/api/market/instruments` is an existing bounded search boundary.
- **STATICALLY_CONFIRMED:** `DataQuality` already includes `UNAVAILABLE` and `STALE`, but listing
  availability is not represented.

## Missing

- Durable ISIN security records and effective-dated listing observations.
- Official-source sync runs with content hashes, row counts, success/failure state, and last-good
  retention.
- Symbol/name aliases and broker/data-provider mappings subordinate to the NSE identity.
- Current and point-in-time repository queries used by production consumers.
- A scalable selector and explicit `LISTED - DATA NOT AVAILABLE` state.
- An authoritative historical archive for dates before the first locally observed official file.

## Safety boundaries

- No broker or real-money action is involved.
- Migration 0011 is additive. Existing symbol ids and stored candle/order rows are not rewritten.
- A failed or malformed sync must not retire the last verified universe.
- A query earlier than archive coverage must refuse; an empty array would make a false claim.
- Test fixtures are labelled fixtures and are never a production fallback.

## Repository state

The worktree was already heavily dirty before this feature. Relevant files including
`lib/db/schema.ts`, `lib/db/migrate.ts`, `components/layout/TopNav.tsx`, `e2e/app.spec.ts`, and
`docs/MASTER_SOURCE_OF_TRUTH.md` contain existing owner/agent work. Changes must be additive and
must not revert unrelated edits.

## Unknowns

- **UNKNOWN:** a complete official historical archive for delisted/suspended NSE cash securities.
- **UNKNOWN:** an official machine-readable REIT/InvIT classification file suitable for sync.
- **UNKNOWN:** broker coverage for every currently listed NSE security.
