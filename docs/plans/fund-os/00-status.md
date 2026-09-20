# Fund OS — status (read this first after any restart)

> **The system-wide picture is now `docs/plans/jarvis-master/MASTER_PRD.md`** (2026-09-20 audit:
> every capability with its evidence, every gap with its acceptance condition, the build order).
> This file remains the detail for the Fund OS slices.

PRD: `02-product.md`. It builds on `docs/plans/autonomous-fund/`, where the paper fund is live.

## Slices, in order

| # | Layer | Slice | Status |
|---|---|---|---|
| S0 | infra | Gemini CLI 0.60.0 and OpenCode 1.18.31 installed in `D:\npm-global`. Gemini needs the owner's one-time login (`! gemini`) | done |
| S1 | L4 | Shared memory for every model. (a) `scripts/mcp-launch.mjs` starts the MarketPulse MCP server from any directory and is registered in Codex, Gemini and OpenCode. (b) Mem0, local and free (FastEmbed + FAISS, `infer=False`, no LLM): `tools/mem0/server.py` exposes `memory_remember` / `memory_recall`, registered in `.mcp.json`, Codex, Gemini and OpenCode. OpenCode connects to both; Codex lists both; Gemini shows Disabled until the owner logs in (`! gemini`) | done, except Gemini login |
| S2 | L1/L2/L4 | Agent runner and model router. `lib/agents/router.ts`: tiered models (free OpenCode, then Gemini, Codex and Claude), started headless via real entry points with `shell:false`; a quota error rests the model until its stated reset (Codex default 6h re-probe); a failure or timeout rests it 1h; every attempt goes to `agent_runs`, every rest to `audit_events`. `lib/agents/jobs.ts`: `agents/jobs/*.md` frontmatter jobs, due by cadence. Conductor `scripts/agents.mjs` runs in its own lease lane. Jobs: research-papers (L1), strategy-lab (L2), daily-review (L4). New MCP tool `marketpulse_fund_report` (READ, registered in the governance manifest) | done (`b94abf4`); Windows task **MarketPulse Agents** every 30 min, first run 2026-09-19 20:26 IST; defers below 1.5 GB free RAM |
| S3 | L3 | Intraday IN1: opening-range breakout, long only (Zarattini, Barbon & Aziz 2023) on RELIANCE, HDFCBANK and ICICIBANK. First 5-min candle up means buy; stop at its low; no entry after 10:30; flat by 15:05. 0.5% of book at risk per trade, inside the engine cap. Kill: 5% drawdown stops new entries. Append-only `intraday_*` ledger; on `/fund` and the MCP fund report with gates (benefit: positive net return, benchmark cash). Windows task **MarketPulse Intraday** runs every minute, weekdays 09:14-15:39. Setup, audited: watchlist +3 names; daily paper order cap 5 to 12 | done; first live minute Mon 2026-09-21 09:14 |
| S4 | L1 | Research job: new q-fin papers (arXiv API) and news, recorded through MCP; dedupe against `knowledge_sources` | todo |
| S5 | L2 | **Mostly pre-existing.** `authorFromHypotheses` (cycle) already runs papers -> sources -> claims -> hypotheses -> draft strategies (research families) -> rehearsal verdicts every cycle. The L1 and L2 agent jobs now feed its top automatically through MCP. Remaining is promotion of rehearsal winners to forward paper. Today that goes through the gauntlet, which spends permanent statistical trials behind the OWNER switch `MARKETPULSE_AUTONOMOUS_TRIALS` (off by design; CLAUDE.md: never run the gauntlet speculatively). **Owner decision needed:** turn autonomous trials on (the Trial Budget Governor rations them), or keep strategy growth at rehearsal only | **unblocked 2026-09-20: the owner turned autonomous trials ON** (governor-rationed). `MARKETPULSE_AUTONOMOUS_TRIALS=1` set as a user variable and inside the `MarketPulse Cycle` task action; authorization recorded in `audit_events` (`autonomous_trials_enabled`). Budget: **1 trial/day**, Trial Budget Governor. Verified the governor reads the switch |
| S6 | L4 | Watchdog `lib/fund/health.ts`, read-only, run every cycle, on `/fund` and in the MCP fund report. It checks, from each layer's own ledger: the cycle completed within 45 min; an agent success within 6h (with memory deferrals counted); on session days, today's intraday decisions; calendar lag; share of instruments current. The daily-review agent job is the AI half. First live run: all OK, with strategy-lab succeeding on Codex while Antigravity rested | done |
| S7 | skills | Audit, then import, external skill packs (ECC) through `repo-auditor`; local skills for each layer | todo |

## Hardening, 2026-09-19 night

- **No non-Claude CLI can touch the repo.** OpenCode runs the read-only `plan` agent, Antigravity runs with `--sandbox`, and Codex is read-only; all three run in `D:/marketpulse-agents/work`. Claude is confined to MCP and web tools. Verified: OpenCode's plan agent, running outside the repo, still recalls from Mem0.
- **Each model is told its identity**, after a free model filed its memories as "claude".
- **Skipped passes are recorded** (`agent_pass_deferred`, with free GB).
- **Mem0 builds its store on first use**, so the MCP handshake answers in under 3 s; the model load had been timing clients out.
- **First unattended run:** research-papers on free OpenCode, 21:56, SUCCEEDED; 3 new arXiv papers are in `knowledge_sources`.

## Audit, 2026-09-19 23:xx (owner-requested, low-token)

- **Code and security review** (one Sonnet verifier; 8 tool calls) of the agents, intraday, crypto
  and mem0 code, plus the automated security hook. All fixed in `5cd7007` and `fb75bb5`:
  - Antigravity no longer auto-approves;
  - Claude tools are scoped per job (`tools:` frontmatter), with no marketpulse wildcard;
  - intraday carries are sold first and P&L is booked per round trip;
  - quota detection needs specific phrases.
- **Residual:** memory poisoning through the tools a job legitimately holds.
- **Also fixed tonight:** `yahoo.ts` now throws on an unknown resolution (`ed604c7`). "5m" had
  silently returned daily bars.
- **Browser sweep** (one Playwright script over 19 screens):
  - 12 load cleanly, with no crashes or console errors: fund, paper, command, strategies, learning,
    research, portfolio, trades, edge-factory, experiments, library, scanner.
  - 7 timed out on first load (brain, jobs, data-quality, memory, audit, dashboard, analyst).
    Re-timed once compiled: /audit 4.2 s, /jobs 0.5 s. That is first-compile slowness under
    memory pressure (0.8-1.6 GB free).
  - **Known gap:** /data-quality takes 74 s. It is not `universeCoverage` (timed at 8.3 s); the
    cause is elsewhere on that page and predates tonight.

## Next action

S5: lab pipeline (hypothesis spec to counted backtest to DB-registered paper mandate). S7: skill imports. Profile /data-quality. Owner: log in to `agy` once.

## Known gaps

- L2 only *specifies* strategies today. The deterministic path from spec to counted backtest to auto-registered paper mandate is S5.
- `lib/agents/runtime.ts` (the API-key job runtime) and `lib/agents/router.ts` (the subscription CLIs) both record to `agent_runs`; unifying them is future work.
