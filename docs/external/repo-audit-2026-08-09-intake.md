# External repository audit — intake decisions (owner-supplied audit, 2026-08-09 23:32)

Source: owner's web-level source audit (no local execution — the sandbox could not resolve
github.com; no test results were fabricated). Executable pass possible later via uploaded ZIPs of:
openalgo, fenix, openalgo-indicator-skills, ReplayMarketData, kite-mcp-server.

| Repository | License | Intake decision | What we take |
|---|---|---|---|
| OpenAlgo | **AGPL-3.0** | **CLEAN_ROOM** (never copy modules) | Broker-contract + capability-registry architecture; sandbox decomposition (order/execution/positions/funds/square-off managers); contract-test CATEGORIES; failure-simulation list from their release history; MCP-over-typed-tools shape (NOT their LLM→place_order permission model; NOT api-key-as-argv) |
| openalgo-indicator-skills | MIT | **ADAPT** (selective, behind our own Indicator Contract) | Indicator catalog/parameter schemas/warmup+NaN patterns/scanner+chart templates. NEVER: symbol→market heuristics, timezone stripping |
| Fenix | **GPL-3.0** | **CLEAN_ROOM** | Unified broker vocabulary (Side/Product/OrderType/Validity/Status), error taxonomy, per-endpoint rate limits, broker-master-under-canonical mapping. NEVER: its web-login/2FA automation |
| zerodha/kite-mcp-server | MIT | **REFERENCE/ADAPT** | EXCLUDED_TOOLS read-only pattern (MarketPulse MCP ALREADY satisfies it — no broker tool exists at all); deterministic synthetic-time testing |
| ReplayMarketData | MIT/Apache | **REFERENCE** | DeterministicMarketClock / replay-driven Playwright ("advance to 09:35 → signal appears") — daily-data replay only, not a scalping simulator |
| AryadeepIT notebook | MIT | **REFERENCE only** | SMA/EMA/buy-hold as hypothesis fixtures. README installs a requirements.txt that does not exist; never import as library or evidence |
| IntManear pairs repo | Apache-2.0 | **REFERENCE (reimplement)** | STATISTICAL_ARBITRAGE/PAIRS research family (cointegration, hedge ratio, z-score, half-life, regime break) — rebuilt on our snapshots; source dataset is private ⇒ inadmissible as evidence |
| Algo-Trading-Map | CC0 | **ADAPT (data, not code)** | Research taxonomy → ResearchTopic/ResearchSourceCandidate seeds for the learning vault; links verified at fetch time, never assumed current |
| Indian Algo Trading Community | varies | **Case-by-case discovery feed** | Prefer official upstreams (their Kite MCP fork → zerodha/kite-mcp-server) |
| uniBroker | unverifiable | **REJECT (for now)** | Concept only; no current source/license/tests found |

## The ten do-not-copy rules (owner's, adopted verbatim into policy)
No AGPL/GPL module copying · no broker web-login automation · no heuristic market detection ·
no timezone stripping · no paper-mode-as-scalping-fidelity · no notebook P&L as evidence · no
GitHub strategy code as a "profitable library" · no LLM MCP order tools while forward evidence
is still building · no uniBroker code · secrets via env/credential store, never argv.

## Failure simulations to build when the live feed/broker plane exists (from OpenAlgo's fixes)
subscription-succeeds-but-zero-ticks · drop/reconnect · token expiry mid-session · concurrent
sessions · process restart · sequence gap after reconnect · duplicate ticks · late ticks ·
resource leak after 100 reconnects. Queued in `docs/autonomous-build/WORK_QUEUE.md`.
