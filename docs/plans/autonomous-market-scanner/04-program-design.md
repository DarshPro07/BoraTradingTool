# Gate 3: Program Design

## Expected Files

- `drizzle/0014_market_scanner.sql`: append-only scan run and entry tables.
- `lib/db/schema.ts`, `lib/db/migrate.ts`: registered schema and migration.
- `lib/scanner/pipeline.ts`: pure filters, scoring, and funnel conservation.
- `lib/scanner/manager.ts`: database and existing-domain coordination.
- `lib/scanner/ledger.ts`: idempotent persistence and latest-run reads.
- `lib/learning/cycle.ts`: one scanner leg under the existing lease.
- `app/scanner/page.tsx`: clickable funnel and candidate evidence.
- `app/brain/page.tsx`: latest ledger-derived decision brief.
- Focused unit, migration, integration, and Playwright tests.

## Score V1

Rank only observed OHLCV dimensions: trend, relative volume, momentum, liquidity, and data completeness. Report volatility but do not reward or penalize it without evidence. Keep spread, catalyst evidence, and research quality outside the numerical rank until verified sources exist.

## State

`RUNNING -> SUCCEEDED | FAILED`; candidate disposition is `EXCLUDED | EVIDENCE_WAIT | FORWARD_ONLY | PAPER_ELIGIBLE`. The first slice is expected to stop at `EXCLUDED` or `EVIDENCE_WAIT`.

## Test Design

- Funnel conservation and stable tie-breaking.
- Missing values remain null and named.
- Pure score performs no database, provider, or model calls.
- Repeat input is idempotent.
- Scanner tables reject update/delete.
- Trial, holdout, forward, execution-intent, and paper counts remain unchanged.
- Browser clicks every funnel stage and reconciles the same run on `/brain`.

## Rollback

Remove the cycle call and UI reads. Preserve append-only evidence tables; do not delete recorded scan history.
