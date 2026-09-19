# PRD — MarketPulse Fund OS: an autonomous, self-improving, low-cost hedge-fund system

2026-09-19. Owner, by voice. Transcription noise such as "Will you come to play… Rajjo" is
background speech and was ignored.

## What the owner asked for

1. **Intraday, "like a real trader, replacing the real trader."**
2. **Start from a fixed, well-founded strategy with proper money management and liquidity rules.**
   Strategies then *grow over time*: research papers, market analysis and deep thinking lead to new
   strategies, which are backtested and fully tested.
3. **Four layers, each with its own tasks, running at the same time. None ever stops.**
4. **A shared graph memory for the whole system and every sub-agent.** It learns from every mistake.
5. **Every AI subscription used:** Claude Max, ChatGPT Plus (Codex), Gemini Pro, plus free tools
   such as OpenCode.
   - No caps, but efficient: the same output for fewer tokens.
   - When Codex's weekly limit is reached, fall back, then resume Codex after its reset.
6. **Skills and sub-agents:** create local skills, import skill packs (ECC, Superpowers), and build
   sub-agents that use the shared memory.
7. **"No human interaction."** The system researches, evolves, learns, builds, observes, adjusts and
   calibrates by itself.

## Two lines that stay with the owner

Both are set by this repository's governance, not preference.

| Line | Why | What the system does instead |
|---|---|---|
| Real money | `CLAUDE.md`: no broker, no order placement; real-money trading is a human-only boundary | Everything runs on paper and earns the trust gates. "Go live" is one owner decision, made once, after the gates pass |
| Merging changes to its own core code | Only an owner session may approve or merge an evolution proposal (governance) | It writes, tests and *proposes* code changes on its own. Strategies, research, parameters of new mandates and calibration all run unattended |

## Honest constraints the design must respect

- **No "pre-made highly profitable" strategy exists to be handed over.** A reliably profitable
  public rule gets traded away. The start is published rules with frozen money management. The
  paper record decides which of them earn.
- **Most intraday traders lose.** SEBI's 2024 study found about 7 in 10 individual intraday traders
  in the equity cash segment made losses. The intraday layer therefore earns trust on paper
  exactly like the fund.
- **Many strategies tested on one dataset manufacture false winners.** Every backtest the lab runs
  is counted: the discovery ledger stays the source of truth. Promotion to paper requires the
  plausibility gate, and promotion to live requires the forward gates.

## The four layers (all running concurrently)

| Layer | Runs | Deterministic part (never stops) | AI part (scheduled headless runs) |
|---|---|---|---|
| **L1 Research** | every ~2 h | data ingestion, calendar, research queue | read new q-fin papers and market news; record sources, claims and hypotheses through MCP |
| **L2 Strategy Lab** | every ~4 h | plausibility gate, backtests, discovery ledger, frozen-contract registration | turn admitted hypotheses into testable specs; interpret results; propose paper mandates |
| **L3 Trading** | fund every 15 min; intraday every 1 min in session | mandates, money management, both paper books, kill rules, square-off | none. Trading decisions are deterministic, so they are reproducible and auditable |
| **L4 Oversight & Memory** | daily after close, plus a watchdog every 15 min | trust gates, decay detection, stalled-cycle watchdog, calibration reports | daily review: lessons from mistakes, anomalies, proposed fixes. Everything goes to the shared memory |

## Shared memory

One graph inside MarketPulse, built from existing tables:
- `knowledge_*` sources, claims, concepts, edges and lessons;
- `failure_memory`;
- `agent_runs`;
- the fund ledger.

**Every** model, whether Claude, Codex, Gemini or OpenCode, reads and writes it through the same
MarketPulse MCP server. It is one memory, not one per vendor.

## Model router

Each job declares its difficulty. The router:
- picks the cheapest available model that can do it (free and fast models for routine reading,
  strong models for synthesis);
- skips a model whose quota is exhausted until its reset time, then returns to it (Codex weekly);
- records every run: model, duration, outcome and tokens where the CLI reports them.

## Success evidence

- All four layers show activity in their own ledgers every day, with no human action.
- New hypotheses, backtests and paper mandates appear over weeks, each counted and gated.
- The intraday layer trades on paper every session, and square-off never misses.
- Router logs show quota fallback and resumption working.
- The shared memory grows, and runs cite prior lessons.

## Non-goals (this program)

- A real broker, until the owner decides after the gates pass.
- Auto-merging core code.
- Promises of profit.
