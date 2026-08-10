# Final - NSE security master

## Verdict: VERIFIED

## Objective

Replace the hardcoded NSE subset with an official-source, ISIN-backed current and effective-dated
security master without breaking existing symbol-based candles, paper rows, URLs, or evidence.

## Architecture

ISIN is the durable security identity. Effective-dated listing versions hold symbol, name, series,
status, listing facts, and source sync. Existing `IN:XNSE:SYMBOL` ids remain operational aliases.
Atomic sync attempts carry source URLs, hashes, byte/row counts, timestamps, actor, and failure
diagnostics. Current and as-of repository queries are separate, and unsupported earlier dates
refuse.

## Implementation

- Migration 0011 adds sync, security, listing-history, alias, and provider-mapping tables with
  history/audit delete guards.
- The parser handles the verified main-board and SME schemas strictly.
- Official sync validates complete sources, protects against row drops/out-of-order observations,
  and retains last-good data on parse/fetch failure.
- Static XNSE declarations were removed. Current backend consumers use repository enumeration and
  lookup; research snapshots enumerate stored historical evidence rather than today's survivors.
- The market search API provides bounded/paginated results, series filters, ISIN metadata, data
  availability, and master freshness/failure state.
- One accessible async combobox replaces global, AI, and paper static/raw selectors with keyboard,
  persistence, no-data, stale/failure, and mobile behavior.
- `scripts/sync-nse-security-master.mts` is the explicit production sync entry point.

## Verification

Exact evidence is in `06-verification.md`: official sync 2,957/2,957 twice on an isolated DB; 1,356
unit tests; 4 MCP tests; clean typecheck/build; 36 desktop/mobile browser tests; and a proven static
XNSE mutation kill.

## Files changed

Primary additions are `drizzle/0011_nse_security_master.sql`,
`lib/market/security-master.ts`, `components/market/InstrumentCombobox.tsx`,
`scripts/sync-nse-security-master.mts`, `e2e/nse-security-master.spec.ts`, ADR 0007, this plan, and
the official-source record. Catalog consumers, API, schema/migration registry, and three selector
surfaces were updated minimally around those boundaries.

## Limitations

- Complete official suspension/delisting history before the first imported observation remains
  unavailable. Earlier as-of queries refuse rather than extrapolate today's list backward.
- Official REIT/InvIT classification sources were not identified, so they are not guessed from
  names.
- Broker/provider coverage must be loaded into `nse_provider_mappings`; absence remains `UNKNOWN`,
  and explicit failed probes are `UNAVAILABLE`.
- The owner database was not synchronized during verification. Run the explicit sync command when
  production data ingestion is desired.

## Rollback

Consumers can be returned to the previous catalog API while leaving additive migration 0011
unused. Do not delete effective-dated history or rewrite an applied migration. Existing operational
ids require no rollback.
