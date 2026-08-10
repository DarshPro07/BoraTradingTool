# Gate 4 — Vertical slices

1. **Stop the bleeding (owner's live 500).** Per-trade CostModelError catch, nullable economics,
   UI abstention, regression test on the exact logged dates. Verified: inspect tests green.
2. **Schema.** Migration 0009 + registration + drizzle tables. Verified: fresh DB migrates;
   migrate guard suite green.
3. **Contract module.** `snapshotFromStore` / `recordExperiment` / `latestExperiment`.
   Verified: 8/8 unit tests including mutation-fingerprint and append-only-delete refusal.
4. **Route + UI.** Ledger-first route with provenance; TradeInspector provenance strip.
   Verified: typecheck + live probe (73 fresh = 73 ledger, identical=true).
5. **Dev build identity + clean-server e2e.** Badge in the footer (dev-only);
   playwright.config claims the DB path only when it matches the server under test;
   `e2e/dataset-ledger.spec.ts` seeds the store, authors through the real door, and proves
   fresh → ledger → reload → ledger with a browser network capture.
6. **Docs.** MASTER Part 1 mission + Part 5 item 13; this plan directory.
