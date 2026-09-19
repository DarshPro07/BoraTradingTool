# Fund OS — status (read this first after any restart)

PRD: `02-product.md`. It builds on `docs/plans/autonomous-fund/`, where the paper fund is live.

## Slices, in order

| # | Layer | Slice | Status |
|---|---|---|---|
| S0 | infra | Gemini CLI 0.60.0 and OpenCode 1.18.31 installed in `D:\npm-global`. Gemini needs the owner's one-time login (`! gemini`) | done |
| S1 | L4 | Shared memory for every model. (a) `scripts/mcp-launch.mjs` starts the MarketPulse MCP server from any directory and is registered in Codex, Gemini and OpenCode. (b) Mem0, local and free (FastEmbed + FAISS, `infer=False`, no LLM): `tools/mem0/server.py` exposes `memory_remember` / `memory_recall`, registered in `.mcp.json`, Codex, Gemini and OpenCode. OpenCode connects to both; Codex lists both; Gemini shows Disabled until the owner logs in (`! gemini`) | done, except Gemini login |
| S2 | L1/L2/L4 | Agent runner and model router. `lib/agents/router.ts`: tiered models (free OpenCode, then Gemini, Codex and Claude), started headless via real entry points with `shell:false`; a quota error rests the model until its stated reset (Codex default 6h re-probe); a failure or timeout rests it 1h; every attempt goes to `agent_runs`, every rest to `audit_events`. `lib/agents/jobs.ts`: `agents/jobs/*.md` frontmatter jobs, due by cadence. Conductor `scripts/agents.mjs` runs in its own lease lane. Jobs: research-papers (L1), strategy-lab (L2), daily-review (L4). New MCP tool `marketpulse_fund_report` (READ, registered in the governance manifest) | built; smoke test running; Windows task not yet registered |
| S3 | L3 | Intraday: ORB mandate on liquid NSE names, frozen money management, a 1-minute session loop, paper only | todo |
| S4 | L1 | Research job: new q-fin papers (arXiv API) and news, recorded through MCP; dedupe against `knowledge_sources` | todo |
| S5 | L2 | Strategy lab job: hypotheses to specs to counted backtests to proposed mandates; a DB-backed mandate registry, still frozen and hashed | todo |
| S6 | L4 | Daily review job and watchdog: lessons, anomalies, decay; code changes only as proposals | todo |
| S7 | skills | Audit, then import, external skill packs (ECC) through `repo-auditor`; local skills for each layer | todo |

## Next action

Finish S2: read the smoke-test result, register the Windows task `MarketPulse Agents` (every 30 min), commit. Then S3 intraday ORB.

## Known gaps

- L2 only *specifies* strategies today. The deterministic path from spec to counted backtest to auto-registered paper mandate is S5.
- `lib/agents/runtime.ts` (the API-key job runtime) and `lib/agents/router.ts` (the subscription CLIs) both record to `agent_runs`; unifying them is future work.
