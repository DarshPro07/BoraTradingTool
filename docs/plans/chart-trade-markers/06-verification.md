# Gate 5 — Verification (executed 2026-08-09 evening)

- Typecheck clean; production build compiled (8.9s).
- Full Playwright on a fresh `next start` :3100 with a brand-new database:
  **79 passed, 0 failed, 5 skipped (all deliberate), 3.6m**.
- The chart assertions run inside `e2e/dataset-ledger.spec.ts` (desktop ledger UI test, passed):
  trade row 0 clicked → `trade-detail` visible → `trade-chart` visible with a rendered canvas →
  caption says "canonical candle store" → the running browser-network capture recorded zero
  candle/quote/history/provider requests other than `/api/research-data/bars` itself.
- Unit suite after all changes: **1309 passed, 0 failed**.

Independent challenge: the same network capture that guards the ledger also guards the chart —
a provider-fetching chart would have failed the `chartish` assertion, not just looked wrong.

Limitation: marker rendering is asserted as canvas presence + caption + network behavior; pixel
positions of arrows are lightweight-charts' contract, not ours.
