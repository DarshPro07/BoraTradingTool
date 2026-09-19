# Fund OS — status (read this first after any restart)

PRD: `02-product.md`. It builds on `docs/plans/autonomous-fund/`, where the paper fund is live.

## Slices, in order

| # | Layer | Slice | Status |
|---|---|---|---|
| S0 | infra | Gemini CLI 0.60.0 and OpenCode 1.18.31 installed in `D:\npm-global`. Gemini needs the owner's one-time login (`! gemini`) | done |
| S1 | L4 | Shared memory for every model. (a) `scripts/mcp-launch.mjs` starts the MarketPulse MCP server from any directory and is registered in Codex, Gemini and OpenCode. (b) Mem0, local and free (FastEmbed + FAISS, `infer=False`, no LLM): `tools/mem0/server.py` exposes `memory_remember` / `memory_recall`, registered in `.mcp.json`, Codex, Gemini and OpenCode. OpenCode connects to both; Codex lists both; Gemini shows Disabled until the owner logs in (`! gemini`) | done, except Gemini login |
| S2 | L1/L2/L4 | Agent runner and model router: job files, headless CLI execution, quota fallback and resume, run ledger in `agent_runs`, a Windows task | todo |
| S3 | L3 | Intraday: ORB mandate on liquid NSE names, frozen money management, a 1-minute session loop, paper only | todo |
| S4 | L1 | Research job: new q-fin papers (arXiv API) and news, recorded through MCP; dedupe against `knowledge_sources` | todo |
| S5 | L2 | Strategy lab job: hypotheses to specs to counted backtests to proposed mandates; a DB-backed mandate registry, still frozen and hashed | todo |
| S6 | L4 | Daily review job and watchdog: lessons, anomalies, decay; code changes only as proposals | todo |
| S7 | skills | Audit, then import, external skill packs (ECC) through `repo-auditor`; local skills for each layer | todo |

## Next action

S2: agent runner and model router.
