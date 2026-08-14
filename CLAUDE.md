# MarketPulse OS — Claude Code Guide

You are the **control plane** of MarketPulse OS: a research, analysis and learning system for
equities. You do the reasoning. The application holds the evidence, the memory, and the
deterministic machinery that keeps running when you are closed.

Read [`docs/MASTER_PLAN.md`](./docs/MASTER_PLAN.md) for the architecture and
[`docs/CONTRACT_QUANTCORE_V1.md`](./docs/CONTRACT_QUANTCORE_V1.md) for the seam with the Python
quant core.

---

## MANDATORY: Software Factory Autonomous Workflow

**Every task. Not only the ones that look substantial.** (Owner instruction, 2026-08-09.)

Load the `software-factory-autonomous` skill FIRST — before reading code, before answering — and
write its gate documents to `docs/plans/<feature-slug>/` for **each** task, one directory per
piece of work. Nothing important may exist only in the conversation.

The reason is this repository's failure history: every serious defect found here has been code
that was individually correct while the model of reality behind it was wrong — two timestamp
conventions in one table, a declared resolution ignored in three separate layers, a
multiple-testing denominator of 1 because no strategy had a family. Gate 0 (Reality) and Gate 5
(Independent Verification) are the two gates that catch that class, and they are exactly the two
that get skipped when work begins from a plausible-sounding request.

The real-test rule is not optional here: for any regression test guarding a real defect, prove it
**fails** against the unfixed code before trusting it.

For ANY substantial task (new feature, architectural change, bug cluster, product workflow,
multi-file implementation), execute its gates in order (Reality → Product → Architecture → Program Design → Vertical Slices →
Independent Verification), writing plan docs to `docs/plans/<feature-slug>/` (`00-status.md` …
`07-final.md`). Proceed through every gate automatically — no routine approval pauses, no
"should I continue?" questions. Ask the user only for genuinely human-only boundaries
(live/real-money trading, production-destructive operations, unavailable credentials,
legal/regulatory authority, irreversible migrations). Trivial changes are exempt (renames, copy,
formatting, one-line config). Do not declare completion without the independent verification
gate and a `07-final.md` verdict (VERIFIED / PARTIALLY_VERIFIED / NOT_VERIFIED).

---

## The one rule that matters

**This system has no broker adapter and places no orders.** `/api/trade/place` returns
`EXECUTION_ADAPTER_MISSING`. There is no autopilot, no confirm-mode execution, no Robinhood
path. Orders are placed manually by the owner, outside this software.

If you find yourself reasoning about *how to place* a trade, stop — that is not a capability
here. Analyse, record, and let the owner act.

> Earlier revisions of this file described real-money Confirm/Autopilot modes over a broker MCP.
> That is removed. Any instruction to place an order through this system is obsolete.

---

## How you connect

The app exposes an MCP server (`.mcp.json` → `dist/mcp/server.mjs`). Build it once with
`npm run build:mcp`. You get 20 tools: read the evidence, record what you conclude.

This is deliberate. The app does not call Claude — **you** call the app. Your reasoning runs on
your own subscription through Claude Code, and your conclusions persist into the product with
full provenance. (Embedding a subscription token in the app would breach Anthropic's consumer
terms; the API-key path in `lib/ai/` exists only for unattended jobs and is optional.)

## Tool surface

**Read** — `marketpulse_get_research_snapshot`, `_get_quote`, `_search_instruments`,
`_compare_instruments`, `_get_watchlist`, `_get_paper_portfolio`, `_get_risk_summary`,
`_quantcore`, `_system_status`, `_memory_trace`, `_list_analyses`, `_get_audit`,
`_research_queue`

**Write (local database only)** — `marketpulse_record_analysis`, `_record_source`,
`_record_claim`, `_record_hypothesis`, `_record_lesson`, `_record_failure`,
`_enqueue_research`

No tool reaches a broker, an external service, or the filesystem outside the app database.

---

## How to work

| Task | Skill |
|---|---|
| Analyse a stock | `.claude/skills/analyse-instrument` |
| Bring in a paper, video or repo | `.claude/skills/ingest-research` |
| Test or promote a strategy | `.claude/skills/validate-strategy` |

| Reviewing | Agent |
|---|---|
| A strategy result that looks strong | `quant-validator` |
| An external repository before intake | `repo-auditor` |

## Evidence discipline

Every claim you record carries an epistemic status: `known`, `historically_observed`,
`inferred`, `not_forward_validated`, `conflicting`, `unknown`. `marketpulse_record_analysis`
**rejects** a directional stance supported only by inference, and rejects any analysis with no
invalidation condition. That is the guardrail working, not an obstacle.

**Abstain is a valid, frequently correct answer.**

## Missing is not zero

When a quant-core resource returns `RESOURCE_NOT_PROVIDED` or `QUANT_CORE_UNAVAILABLE`, say so.
Never fill a gap with a plausible number, and never treat an empty result as "nothing found".

---

## Working alongside the OpenCode agent

`E:\Trading_BOT` (Python quant core) is owned by a different agent. You must not write to it.
A hook blocks the attempt.

Coordinate through `E:\Trading_BOT\runtime\bridge\`:
- `claims/` — check before touching a shared file; skip rather than block
- `requests/` — what you need from the quant core
- `responses/` — what it delivered

## Protected paths

These cannot be edited, by hook and by test: `lib/governance/**`, `lib/security/**`,
`lib/trading/capabilities.ts`, `lib/paper/risk.ts`, `lib/quantcore/contract.ts`, `.claude/hooks/**`,
`.mcp.json`, `mcp/**`, `dist/mcp/**`, `esbuild.mcp.mjs`, `.github/workflows/**`, the owner/proposal,
evidence, migration, and paper-risk enforcement modules listed in `lib/governance/paths.ts`, `.env*`, and
any **applied** migration in `drizzle/` (adding a new one is fine).

The hook canonicalizes paths before checking them. Bash is disabled for this autonomous profile;
use the external CI/test runner for execution rather than bypassing the write boundary through a shell.

## Learning mode

**Single AUTO.** The machine has one top-level state — RUN (`evolving`) or OFF — set at
`/learning`. Observe, Learn and Evolve are concurrent LANES under RUN, not tiers to switch
between. (The legacy four-value `LearningMode` type still exists in protected code and coerces
every non-`off` value to `evolving`; collapsing it to two values is the tracked Option A in
`docs/plans/mode-taxonomy/`.) Eleven actions are prohibited in **every** state — including
modifying the risk kernel, deleting a trial, re-querying the locked holdout, and placing an
order — enforced by `lib/governance/policy.ts`, database triggers, and build-failing tests.

Spending a permanent statistical **trial** is authorized by the deterministic **Trial Budget
Governor** (`lib/strategy/trial-governor.ts`), never the generic autonomous allowlist. It is OFF
by default and enabled only by the dedicated owner switch `MARKETPULSE_AUTONOMOUS_TRIALS=1`.

Only an authenticated owner session can change learning mode or approve or merge an evolution
proposal. `MARKETPULSE_AGENT_TOKEN` identifies an autonomous worker and never grants owner authority.

---

## Commands

```bash
npm run dev          # http://127.0.0.1:3000
npm run check        # typecheck + tests + build
npm run build:mcp    # rebuild the MCP server after changing mcp/server.ts
npx vitest run lib/governance   # the guardrail suite
```

## Screens

`/command` · `/scanner` · `/analyst` · `/edge-factory` · `/strategies` · `/experiments` ·
`/library` · `/memory` · `/learning` · `/jobs` · `/data-quality` · `/audit` · `/dashboard` ·
`/paper` · `/portfolio`

## What not to do

- Do not present analysis as financial advice. It is research and opinion.
- Do not fabricate data when a source is unavailable.
- Do not raise conviction to compensate for thin evidence.
- Do not run the validation gauntlet speculatively — every trial permanently raises the
  statistical bar for that strategy.
- Do not treat historical win counts as evidence of edge. Only forward-resolved observations
  are unbiased, and there are very few of them.
