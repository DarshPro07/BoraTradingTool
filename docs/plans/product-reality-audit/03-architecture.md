# Gate 2: Architecture

## Current Architecture

`lib/db/index.ts` lazily opens SQLite, migrates, and seeds local defaults. `lib/market/security-master.ts` owns parsing, atomic synchronization, search, and last-good status. A standalone script currently duplicates official-source fetching. The route reads status and refuses unavailable NSE searches.

## Proposed Fit

Add one reusable bootstrap coordinator beside the security-master repository. It owns official-source HTTP retrieval and single-flight first-use orchestration, then delegates all validation and persistence to the existing atomic sync service.

## Data Flow

Search request -> inspect persisted master -> if absent, single-flight official fetch -> existing parser/validator -> atomic SQLite sync -> repeat status/search -> JSON response -> combobox/navigation.

## Interfaces

- `syncOfficialNseSecurityMaster(options)` fetches configured official sources and returns the existing sync result.
- `ensureNseSecurityMasterReady(options)` returns READY with status or UNAVAILABLE with a bounded error.
- Dependencies such as fetch, clock, and minimum-row threshold are injectable for deterministic tests.

## State

- UNAVAILABLE + successful bootstrap -> CURRENT.
- UNAVAILABLE + failed bootstrap -> UNAVAILABLE with persisted failed attempt.
- CURRENT/STALE/FAILED_LAST_ATTEMPT -> serve the last-good master without blocking on refresh.

## Failure Paths

Timeout, non-2xx response, malformed CSV, duplicate ISIN, implausible drop, and non-monotonic observation return explicit errors. No source failure can replace a verified current master.

## Security

Only fixed HTTPS NSE archive URLs are used by default. No user-provided URL is fetched. Errors expose bounded messages and never credentials.

## Observability

Every success/failure remains in `security_master_syncs` with source manifest, actor, timestamps, counts, and error code.

## Compatibility

The manual script remains as an operational fallback but delegates to the same coordinator and database path.

## Alternatives Considered

- Migration-time fetch: rejected because schema migration must remain deterministic and offline-safe.
- Hardcoded NSE fallback: rejected because it violates canonical identity and readiness truth.
- Background-only startup task: deferred because it does not guarantee the first search can complete and complicates server lifecycle.

## Risks

- First NSE request may wait for two network downloads.
- Process-local single-flight does not coordinate multiple server processes.
- A retry policy is still needed for unattended refresh after first bootstrap; this slice only closes first-use initialization.
