# Gate 5 - Verification

## Verdict

VERIFIED for the current official NSE master and for point-in-time queries inside locally observed
coverage. Dates before first verified observation refuse as designed; no complete historical NSE
delisting archive was claimed or fabricated.

## TDD evidence

- Initial security-master suite failed because `./security-master` did not exist, then passed after
  the minimum parser/persistence implementation.
- Catalog/API tests failed against the 20 static XNSE rows and 200 fallback response, then passed
  after repository migration and explicit 503 behavior.
- SME source-variant test failed on `NAME_OF_COMPANY`, then on the official two-digit date; both
  strict documented variants now pass.
- Historical-symbol-reuse test failed by resolving the older ISIN; it now resolves the latest
  verified security without erasing the older alias.
- Fetch-failure and non-monotonic-observation tests failed before their controls existed and pass
  after implementation.

## Official-source probe

Executed twice against
`C:\Users\marke\AppData\Local\Temp\opencode\nse-security-master-verification.db`, never the owner
database:

```text
2957 verified listings (2397 main, 560 SME)
2957 verified listings (2397 main, 560 SME)
```

The first probe initially rejected the real SME header instead of partially applying main-board
data. That is the expected atomic failure behavior and led to the source-specific parser test.

## Automated results

- `npx tsc --noEmit --pretty false`: pass, no output.
- `npx vitest run --exclude mcp/**/*.test.ts --maxWorkers=4`: 108 files passed; 1,356 tests
  passed; 2 skipped; 0 failed.
- `node esbuild.mcp.mjs && npx vitest run mcp/server.integration.test.ts`: 4 passed, 0 failed.
- `npx next build`: compiled, TypeScript, page-data collection, and all static generation passed.
- `npx playwright test e2e/nse-security-master.spec.ts e2e/app.spec.ts` on an isolated production
  server/database: 36 passed, 0 failed in desktop Chromium and Pixel 7 projects.

## Browser journeys

All twelve security-master journeys passed in both projects: symbol, company, and ISIN search;
series filter; keyboard selection/Escape; ISIN-backed refresh persistence; deterministic API
pagination; AI and paper selection without datalists; listed/no-data visibility; failed-last-sync
retention; and narrow-viewport overflow. The existing app suite additionally verified every primary
screen without runtime console errors, canonical navigation, AI fixture analysis, paper ledger,
fail-closed live execution, and screenshots.

## Mutation proof

A deliberate static row
`instrument({ market: "IN", exchange: "XNSE", symbol: "MUTATION", ... })` was inserted into
`catalog.ts`. `security-master-architecture.test.ts` failed on the exact row. Only that deliberate
mutation was then removed, and the guard passed 3/3.

## Independent challenge

Executable acceptance and mutation tests challenged the five critical claims:

- ISIN remained stable through symbol/name changes.
- Later observations were hidden from earlier as-of queries; older syncs were rejected.
- Malformed, implausibly small, and fetch-failed attempts retained the last verified universe.
- `LISTED` and data availability remained separate in API/UI output.
- No production consumer outside the catalog compatibility boundary imports the static array.

Subagents were not used, per the owner's constraint. Browser acceptance, source probes, mutation,
and the separate architecture suite provide the independent executable evidence.
