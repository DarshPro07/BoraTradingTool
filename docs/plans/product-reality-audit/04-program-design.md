# Gate 3: Program Design

## Files

- `lib/market/security-master-bootstrap.ts`: fixed-source fetch and single-flight ensure service.
- `lib/market/security-master-bootstrap.test.ts`: success, concurrency, and failure behavior.
- `app/api/market/instruments/route.ts`: await ensure before an unavailable NSE-dependent search.
- `app/api/market/instruments/route.test.ts`: route-level clean-database red/green regression.
- `lib/product/readiness.ts`: derive NSE readiness from verified master state only.
- `lib/product/readiness.test.ts`: empty/current/stale/failed-state semantics.
- `scripts/sync-nse-security-master.mts`: delegate to reusable sync service.
- `package.json`: expose the operational sync command.

## Types And Contracts

- Bootstrap result is a discriminated union: `{ ok: true, bootstrapped, securityMaster }` or `{ ok: false, errorCode, message, securityMaster }`.
- Source fetcher accepts only the fixed source descriptors by default.
- Route response retains existing `instruments`, `pagination`, and `securityMaster` fields.

## Call Flow

Route parses query -> reads static matches/status -> when request needs NSE and state is unavailable, await ensure -> on success search canonical master -> on failure return 503 -> otherwise preserve existing route behavior.

## Error Model

- Fetch/network/non-2xx -> SOURCE_FETCH_FAILED.
- Existing parser/validation errors retain their current error codes.
- Last-good master is never converted to unavailable by a failed refresh.

## Test Design

- The first route regression starts with an empty temporary DB and mocked official main/SME documents. It must fail on pre-fix HTTP 503 and pass with canonical SBIN output after the fix.
- Concurrency proves two ensure calls invoke each source once.
- Failure proves a persisted failed attempt and explicit 503.
- Readiness proves BSE aliases do not count toward NSE state.

## Playwright Journey

Fresh non-test server/database -> desktop Chromium -> search SBIN -> wait through initialization -> open -> verify canonical route, HTTP 200 search/analysis/quote, no console errors, and persisted sync/listing rows.

## Least-Confident Decisions

- Whether unscoped searches should always initialize NSE or only when static results do not resolve the query.
- Whether first-use bootstrap needs UI-specific progress beyond the existing loading state.

## Rollback

Remove the coordinator and restore the route's explicit unavailable response. Database schema and historical sync evidence require no rollback.
