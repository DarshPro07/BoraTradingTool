# Gate 0: Reality

## Current Product

MarketPulse has durable SQLite ledgers, canonical NSE identity, official-file parsing, deterministic strategy/backtest machinery, replay/forward ledgers, paper ledgers, and a Brain cockpit. The individual subsystems are not yet connected as one release-grade meeting journey.

## Evidence Map

### REPRODUCED

- Owner-data browser path: query `SBIN` -> `/api/market/instruments?q=SBIN` HTTP 200 -> `/analyze/IN%3AXNSE%3ASBIN` HTTP 200 -> quote HTTP 200.
- Current low-level verification: TypeScript passes; Vitest reports 1,429 passed and 2 skipped.
- A repository verification artifact records clean-database NSE search failures because no security master existed.

### STATICALLY_CONFIRMED

- `lib/db/index.ts` initializes schema and defaults, but `seedTestSecurityMaster` runs only under `MARKETPULSE_TEST_MODE=1`.
- `scripts/sync-nse-security-master.mts` fetches and validates official main/SME files, but no production path calls it.
- `app/api/market/instruments/route.ts` returns 503 when no verified master exists.
- `lib/product/readiness.ts` labels an empty NSE master PARTIAL and mixes BSE catalog rows into the NSE count.
- `e2e/meeting-journey.spec.ts` has a placeholder for India/search/research and no paper action.
- `lib/research/proposal-contract.ts` is marked not integration verified; no Scout process or adapter exists.

### OBSERVED

- The owner database contains 2,972 current NSE listings and masks first-run behavior.
- India sector indices, India VIX/pre-market context, corporate events, and a streaming live feed are unavailable in readiness.

### INFERRED

- The highest-value fix is to connect the existing official importer to first-use search through a single-flight service, not to add fallback symbols or perform network I/O inside migrations.

### UNKNOWN

- Upstream Scout package identity, current license text, serving API, dependency/security posture, and India behavior have not been externally verified.

## Safety Boundaries

- Paper-only execution remains mandatory.
- No broker orders or real-money actions.
- No fabricated NSE fallback universe.
- Failed refresh retains last-good verified data.
- Test and clean-install databases must never touch the owner database.

## Gate Challenge

Reality is sufficient for Slice 1. Later slices remain open and may not be represented as complete.
