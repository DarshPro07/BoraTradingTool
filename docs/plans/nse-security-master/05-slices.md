# Gate 4 - Vertical slices

1. **Persisted identity and history.** Migration, strict parser, atomic sync, current/as-of query,
   and unit tests. Verify first sync, symbol change, inactivity, failure retention, and refusal.
2. **Current search API.** Repository-backed bounded search with fixture-only E2E seeding and master
   freshness. Verify route behavior and no static NSE fallback.
3. **Shared selector.** Async accessible combobox on global search, AI, and paper. Verify desktop,
   keyboard, refresh, no-data, stale, and mobile journeys.
4. **Backend universe migration.** Replace NSE enumeration in research snapshots, learning,
   pre-market, quant-core, dashboard, execution, watchlist, MCP, and scripts. Verify each focused
   suite after its consumer changes.
5. **Historical firewall.** Bind research-universe enumeration to an explicit as-of repository
   query; prove a later inactive security remains in an earlier universe and missing coverage
   refuses.
6. **Mutation and full verification.** Remove/alter repository calls and attempt static XNSE
   reintroduction to prove guards fail; run typecheck, unit, build, Playwright, browser error checks,
   and update final evidence.

No slice is complete until focused tests and its real application path pass.

## Result

All six slices are complete. Research snapshots now enumerate stored evidence, not current
survivors. Every remaining production use of the static catalog is confined to the non-NSE
compatibility boundary, enforced by an architecture test whose static-XNSE mutation was observed
failing before the mutation was removed.
