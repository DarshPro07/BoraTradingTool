# Research ledger (external truth consulted; §54 — reverify at implementation time)

> **Naming policy.** This is the ONE file that records real upstream identities, because §52
> intake and licence planning cannot be done against a codename. Everywhere else — product, UI,
> code, mission, queue, state — the research brain is the **external research provider
> (codename Scout)**. Two consequences worth stating plainly: (a) the small-first M5 plan runs
> the provider as a SEPARATE service consumed over HTTP/MCP, so no upstream source enters this
> repository and no third-party notice appears in our code; (b) if that ever changes and code is
> vendored, its LICENSE/copyright notice travels with it — MIT requires it, and an intake ledger
> that hid the origin would defeat its own purpose.

- NSE official securities/master files (Equity, SME, ETF/REIT/InvIT, symbol/name changes, MII
  active list) — basis of M1 taxonomy; engine lane owns retrieval; classification requirement
  recorded in WORK_QUEUE (equity segment ≠ all ordinary shares).
- Nifty sectoral indices (official list incl. Commercial & Transport Services, Capital Goods,
  Consumer Durables/Services, Oil & Gas, Private/PSU Bank, Retail, Cement…) — M3/India parity.
- HKUDS/Vibe-Trading (MIT): README/CHANGELOG/SECURITY/LICENSE audited via owner's review —
  IndiaEquityEngine, Research Autopilot, scheduled research, 64 MCP tools, FastAPI sessions;
  security policy warns generated code executes with network — our runner requires AST +
  isolation + no secrets. Classification: strong integration candidate; audit transitive
  material at intake.
  **CONFLICTED (§55, retrieved 2026-08-10)**: the July 11 CHANGELOG states Research Autopilot
  Phase 3 is implemented end-to-end (hypothesis → generated signal engine → backtest) with
  scheduled research shipped, while the README/roadmap still describes Autopilot as
  "Next"/manual-first in parts. Conservative assumption in force: NEITHER surface is runtime
  truth — M4's standalone proof is MANDATORY before any bridge work assumes a capability.
- Anthropic multi-agent research system essay + OpenAI agents guide — basis for the
  ChiefOfStaff manager pattern and AgentBudgetPolicy (effort scales with complexity; token cost
  is real; no 133 permanent agents).
- Playwright best practices (user-facing locators, web-first assertions, tracing) — encoded in
  §47 and the journey specs.
- Andrew Lo, Statistics of Sharpe Ratios — lib/quant/analytics.ts Lo-adjusted Sharpe beside
  naive (implemented).
- Bailey/López de Prado (DSR, PBO, multiple testing) — gauntlet gates + expectedMaxSharpe on
  selectionCost (implemented).
- statsmodels cointegration — Engle-Granger parity corpus (108 cases, 99.1% agreement,
  APPROXIMATE_PARITY_MEASURED; the critical-value defect it caught is the canonical example of
  verify-before-accept).
- Cont/Kukanov/Stoikov OFI; Almgren-Chriss — recorded as data-gated microstructure/execution
  bases (§34); not implemented, correctly.
- StochVolModels / QuantLib / PyPortfolioOpt — parity/reference libraries for Q7/P3 phases.
- Scanner concept doc (Google) + Structure Webworks orchestrator article — judged 2026-08-10:
  pipelines/patterns adopted with deterministic-score and manager-pattern corrections; neither
  copied literally.
- Book curriculum (§36) — mapping into executable tasks happens at P2 Knowledge Vault; the
  Carver (not Chan) attribution for Systematic Trading is the canonical §Q8 test case.
