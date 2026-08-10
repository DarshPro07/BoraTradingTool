# Gate 2 - Architecture

## Current architecture

`catalog.ts` is both a UI convenience list and a production universe. `contract-master.ts` models
dated observations but has no persistence or ingestion. SQLite already stores operational
instruments and candle/paper references by symbol-based id.

## Proposed fit

Add one canonical NSE security-master module and repository. `catalog.ts` remains the static source
for US/BSE only. All current NSE enumeration and search goes through the repository. Historical
research asks the repository for an explicit as-of universe.

## Identity decision

ISIN is the durable `security_id`. A current XNSE listing is an effective-dated observation of that
security. Existing application ids such as `IN:XNSE:RELIANCE` remain operational listing aliases
for compatibility with stored candles, paper rows, URLs, and provider adapters. API records expose
both `securityId`/`isin` and `id`/`symbol`; new code must not treat the latter as durable identity.

See ADR 0007.

## Data flow

```text
official NSE CSV bytes
  -> hash + strict parse + validation
  -> one atomic sync transaction
  -> security_master_syncs (attempt/provenance)
  -> nse_securities (ISIN identity)
  -> nse_listing_versions (effective-dated symbol/name/series/status)
  -> nse_security_aliases / nse_provider_mappings
  -> repository current/as-of query
  -> /api/market/instruments
  -> shared async selector / backend research consumers
```

## Interfaces

- `parseNseSecurityCsv(text, source)` returns validated source rows or a structured refusal.
- `applyNseSecurityMasterSync(input)` applies a complete observation atomically and returns a sync
  result. It never mutates current rows before all sources pass validation.
- `searchCurrentInstruments(query)` returns current app-facing `Instrument` records with ISIN,
  listing series/status, and data availability.
- `listCurrentInstruments(filters)` returns the current verified universe.
- `listInstrumentsAsOf(date, filters)` returns only rows effective at that date and refuses dates
  before local coverage.
- `findInstrumentById(id)` resolves ISIN, current symbol id, provider symbol, and recorded alias.
- `securityMasterStatus()` returns latest success, latest attempt, age, row counts, and state.

## Data

- `security_master_syncs`: every attempt, source URLs, hashes, observed time, counts, status/error.
- `nse_securities`: one durable row per ISIN.
- `nse_listing_versions`: effective-dated symbol/name/series/listing status; no destructive history.
- `nse_security_aliases`: historical symbols/names and provider-style aliases.
- `nse_provider_mappings`: optional Upstox/Kite/data-provider identities with verification dates.

## State

Sync transitions: `STARTED -> SUCCEEDED | FAILED`. Current universe changes only in the transaction
that records `SUCCEEDED`. Listing versions transition by closing `effective_to` and inserting a new
version when observed attributes change. Missing from a complete successful source closes the
current listing with status `INACTIVE`; failed/incomplete sources close nothing.

Master state: `UNAVAILABLE` before first success, `CURRENT` inside freshness threshold, `STALE` after
threshold, `FAILED_LAST_ATTEMPT` when a later attempt failed but last-good data remains.

## Failure paths

- Network failure: record failed attempt where possible; retain last-good rows.
- Empty/malformed source or implausible row-count drop: fail before transaction mutation.
- Duplicate ISIN+series or conflicting symbols: reject the sync with diagnostics.
- Unknown historical date: throw `NOT_YET_OBSERVED`, never return `[]`.
- Missing provider mapping/data: return the listing with `UNAVAILABLE`; execution/data requests
  refuse separately.

## Security

Only fixed HTTPS NSE archive URLs are fetched. CSV content is data, never executable. Query input is
bounded and all SQL values are parameterized through Drizzle/better-sqlite3. The sync endpoint, if
exposed, uses the existing mutation/CSRF boundary; no secrets are stored.

## Observability

Persist source URL, SHA-256, row count, timestamps, status, and error code/message. Expose freshness
through a read-only API and data-quality UI. Log sync summary without dumping source rows.

## Compatibility

The migration is additive. Existing operational ids continue to resolve. There is no automatic
rewrite of `price_candles`, paper tables, manifests, or URLs. Static US/BSE records remain available.

## Alternatives considered

- Make ISIN the existing `Instrument.id`: rejected for this slice because it would orphan stored
  candles and paper foreign keys or require an irreversible bulk migration.
- Keep daily full snapshots only: simpler ingestion, but symbol history and point-in-time changes
  become expensive and ambiguous. Effective-dated versions retain the same evidence more directly.
- Fetch NSE on every search: rejected because selection would depend on network availability and
  provide no reproducible as-of history.
- Fall back to the old 20 XNSE rows: rejected because it restores the exact silent-incompleteness
  defect.

## Risks

- ISIN can identify a security across symbol changes, but exchange series may create multiple
  simultaneously listed records; the listing key therefore includes exchange and series.
- Official current files do not establish complete historical suspension/delisting history. The
  repository can be correct from first observation while earlier dates must refuse.
- Removing all static consumers is cross-cutting; migration proceeds as verified vertical slices.
