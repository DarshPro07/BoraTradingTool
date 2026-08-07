# MarketPulse OS — Master Plan

**Author:** Claude (Fable 5) · **Date:** 2026-08-06 · **Status:** Approved for execution

A single system built from three planes that already exist in fragments across two repositories,
joined by one versioned contract, controlled by Claude Code, and safe by construction.

---

## 0. Situation (verified by reading the code, not by reading the audit)

The audit you pasted evaluated the **public** `BoraTradingTool` repo. It was accurate about that
repo and **materially wrong about your actual position**, because it never saw `E:\Trading_BOT`.

### What actually exists

| | `E:\Trading_BOT` (Python) | `E:\BoraTradingTool` (TypeScript) |
|---|---|---|
| Size | 522 `.py` files | Next.js 16.3 / React 19 / Drizzle+SQLite |
| Market | India — NSE cash + liquid ETFs | US + NSE + BSE (canonical instruments) |
| Data | **Upstox V3 WebSocket/Protobuf**, Kite MCP read-only, yfinance fallback | Yahoo (Finnhub optional) |
| Quant | Deterministic **risk kernel** (property + mutation proofs), causal 15m scanner, regime service w/ walk-forward, no-trade comparison, RVOL correctness fixes, PEAD research, event alert engine | Trade Fence (position %, watchlist, daily cap) |
| Lifecycle | Manual ticket lifecycle, forward observation board, reconciliation | Paper engine + ledger, order state machine |
| ML | `src/ml`, `src/learning`, `src/validation`, meta-models, candlestick ViT | — |
| Governance | `PRODUCT_BOUNDARY_INDIA.md`, `tests/test_no_broker.py` repo-wide guard | Security/CSRF/loopback layer, migrations |
| UI | `apps/web` = **4 files, empty skeleton** | 10+ pages, charts, working terminal UI |
| Agent | OpenCode / GPT-5.6 Sol on branch `ml-training-root-cause` | Claude Code (me) |

**The complementarity is almost perfect.** Trading_BOT has the quant substance and no UI.
BoraTradingTool has the product surface and no quant substance. Neither has the learning plane.

### Corrections to the audit worth stating

- "No causal backtest engine, no strategy registry, no risk kernel" — **false for Trading_BOT.**
  `6ef8403 feat(risk): add deterministic risk kernel with property and mutation proof` and
  `72a0bc8 feat(scanner): add causal 15m scanner factory` are real commits.
- "No paper mode" — **already fixed** in BoraTradingTool (`lib/paper/`, 3 test suites green).
- "No authentication on local APIs" — **already fixed** (`lib/security/request.ts`: loopback +
  origin + CSRF + bearer capability token).
- Recommending you adopt LEAN / NautilusTrader / OpenAlgo is **wrong for your position**. You
  would be importing a foreign engine to replace a risk kernel you already proved correct, and
  you'd inherit AGPL (OpenAlgo) or LGPL (Nautilus) obligations for capability you already have.
  They stay as **reference reading only**. See §7.

---

## 1. The three planes

```
┌──────────────────────────────────────────────────────────────────────┐
│  CONTROL PLANE — Claude Code (your Max plan)                         │
│  CLAUDE.md · .claude/skills · .claude/agents · .claude/hooks · MCP   │
│  Research missions · audits · reviewed code changes · orchestration  │
│  NOT in the market tick loop. System runs when Claude Code is closed.│
└───────────────────────────────┬──────────────────────────────────────┘
                                │ MCP (stdio) + HTTP (loopback)
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
┌────────────────┐   ┌────────────────────┐   ┌────────────────────┐
│ LEARNING PLANE │   │  PRODUCT SURFACE   │   │   QUANT CORE       │
│ (new, TS)      │   │  (BoraTradingTool) │   │  (Trading_BOT, Py) │
│ Source→Claim→  │   │  15-screen terminal│   │  Upstox V3 feed    │
│ Concept→       │   │  Analyst & Tutor   │   │  Causal scanner    │
│ Hypothesis→    │   │  Memory Graph      │   │  Risk kernel       │
│ Strategy→Trial │   │  Paper & Shadow    │   │  Regime service    │
│ →Outcome→      │   │  Jobs · Audit      │   │  Validation · ML   │
│ Lesson         │   │  MCP server        │   │  Ticket lifecycle  │
└────────────────┘   └────────────────────┘   └────────────────────┘
         └───────────────────┴───────────────────────┘
                    Shared: SQLite memory + bridge contract
```

**Ownership split** (this is also the anti-collision protocol — see §6):

- **I (Claude) own** `E:\BoraTradingTool` — all TypeScript: product surface, learning plane,
  memory, MCP, control-plane assets.
- **OpenCode/GPT-5.6 owns** `E:\Trading_BOT/src/**` — all Python quant internals.
- **Neither writes the other's tree.** We meet at one versioned JSON contract.

---

## 2. Decision A — How "analyze with my Claude Max plan" actually works

**This is the most important decision in the plan, and the obvious design is prohibited.**

### The constraint

On **2026-02-19** Anthropic updated its consumer terms: OAuth tokens from Free/Pro/Max plans are
for **Claude Code and Claude.ai only**. Using them in any other product, tool, or service is
unauthorised. This is what got OpenCode and OpenClaw cut off. Embedding a
`CLAUDE_CODE_OAUTH_TOKEN` in the Next.js app would put you in exactly that bucket.

### The design that gives you what you want, legitimately

**Invert it. The app does not call Claude — Claude calls the app.**

```
  You, in Claude Code (Max plan)                 MarketPulse OS
  ─────────────────────────────                  ──────────────
  "analyse RELIANCE"          ── MCP stdio ──▶   research.snapshot()
                              ◀──────────────    evidence package + provenance
  reasons over evidence
                              ── MCP stdio ──▶   analysis.record()
                                                 └▶ SQLite `ai_runs` + memory graph
                                                 └▶ rendered in Analyst & Tutor UI
```

Claude Code **is** the analyst. The app is its instrument panel and its permanent memory.
Everything Claude concludes is persisted with citations and shows up in the UI — so the analysis
lives in the product, exactly as you wanted, and the Max plan does the thinking.

This is also precisely what your own `01_CLAUDE_CODE_MASTER_REQUIREMENTS.md` specifies:
*"Claude Code coordinates work but is not the application runtime."*

### Unattended mode

When Claude Code is closed and a scheduled job needs a model, the app uses a **Console API key**
(`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`), which is the sanctioned path for programmatic use. That
layer already exists (`lib/ai/providers/`). If no key is set it returns
`AI_PROVIDER_NOT_CONFIGURED` — it never fabricates. The deterministic scanner, paper engine and
job queue keep running with no model at all.

**Net effect:** interactive analysis = your Max plan, zero marginal cost, no ToS risk.
Unattended analysis = optional, metered, explicitly opt-in.

---

## 3. Decision B — Execution stays disabled

The two repos currently contradict each other:

- `Trading_BOT/PRODUCT_BOUNDARY_INDIA.md`: manual orders only, auto-execution **prohibited**,
  enforced by `tests/test_no_broker.py`.
- `BoraTradingTool/CLAUDE.md`: real-money Robinhood Confirm/Autopilot modes.

**Resolution: the restrictive boundary wins, system-wide.** Default and only mode is
PAPER / SHADOW / manual advisory ticket. A "Confirmed Live" path exists in the UI but terminates
at `EXECUTION_ADAPTER_MISSING`. No approval-free autopilot survives this plan.

Rationale: you are about to point a self-modifying research loop at this system. An LLM-to-broker
path plus autonomous code evolution is the one combination with unbounded downside. Turning
execution on later is an explicit owner policy decision with its own compliance design (SEBI/NSE
retail-algo framework for India), not a feature toggle I should flip while building.

---

## 4. Decision C — What "learning mode" actually does

Learning mode is a **governed evolution loop**, not free self-modification.

### Permitted autonomously
Discover papers/videos/repos · extract claims · propose Strategy-DSL files · generate features ·
write tests · run historical replay · run Monte Carlo · diagnose failed strategies · breed safer
child strategies · open a git worktree + branch · submit a reviewed change · improve dashboard
pages · update verified memory · retire degraded strategies.

### Prohibited autonomously — enforced in code, not by prompt
Modify the risk kernel · change loss/position ceilings · delete losing trials · re-query the
locked holdout · deploy unreviewed code · change MCP permissions · add a broker mutation tool ·
place an order · rewrite its own verification rules · mark a failed strategy profitable.

Enforcement: `lib/governance/policy.ts` + a guardrail test suite that **fails the build** if any
forbidden path becomes reachable, plus a Claude Code `PreToolUse` hook that blocks the edit
before it happens. The prohibition list is a data structure with tests, not a paragraph.

### The loop
```
idea/incident → research mission → source+claim verification → bounded DSL/code proposal
  → isolated worktree → unit + causality tests → historical replay → costs + walk-forward
  + Monte Carlo → cold independent reviewer → trial ledger + failure memory
  → paper-forward challenger → human-reviewed merge
```
Every arrow is a persisted row. Nothing advances a stage without evidence attached.

---

## 5. Honest expectations

No repository, model, or plan makes profit likely. What this system credibly does:
**reject weak ideas faster, make losses bounded and visible, keep every result attributable to a
source, and stop you re-testing something that already failed.** Forward evidence accumulates at
roughly one observation per instrument per session — statistical confidence takes months, not
weekends. The plan is built so that truth arrives slowly but is never lost.

---

## 6. Anti-collision protocol with OpenCode / GPT-5.6

Two agents, one system, zero merge conflicts:

1. **Tree ownership** (§1). I never write `Trading_BOT/src/**`; OpenCode never writes
   `BoraTradingTool/**`. Enforced by a pre-edit hook that checks path ownership.
2. **The seam is a contract, not an import.** `docs/CONTRACT_QUANTCORE_V1.md` defines a frozen
   JSON schema. Either side may change internals freely as long as the contract holds.
3. **Handoff directory** `E:\Trading_BOT\runtime\bridge\` — append-only, timestamped:
   - `claims/<agent>.json` — advisory lock: which files an agent is touching, with a TTL.
   - `requests/` — what I need from the quant core (e.g. "expose regime state as JSON").
   - `responses/` — what OpenCode delivered.
   I check `claims/` before touching any shared file and skip rather than block.
4. **Read-only degradation.** My bridge reads Trading_BOT's existing artifacts
   (`runs/`, `reports/`, `outputs/`, `data/`) directly. If the Python service is mid-refactor or
   down, the UI shows `QUANT_CORE_UNAVAILABLE` — it never blocks and never fabricates.
5. **Different git branches.** OpenCode is on `ml-training-root-cause`. I work only in the
   BoraTradingTool repo on its own branch.

"Do better than it" is not a race — it's division of labour. OpenCode is deep in ML root-cause
work in Python. I build the plane it does not have: memory, teaching, governance, and the surface.

---

## 7. External repositories — decision: reference only

Verified licences: OpenAlgo **AGPL-3.0**, LEAN **Apache-2.0**, NautilusTrader **LGPL-3.0**,
vn.py **MIT**, Freqtrade **GPL-3.0**, Hummingbot **Apache-2.0**, LumiBot, Jesse, OctoBot,
Superalgos, TradingAgents, FinRobot, FinMem, AI-Hedge-Fund.

**None are imported.** Reasons: (a) you already have a proven risk kernel and causal scanner —
importing an engine to replace them is a downgrade with migration cost; (b) AGPL/LGPL/GPL create
obligations for a private product; (c) every one of them is crypto-first or US-first except
OpenAlgo, and OpenAlgo is an execution platform, which is the one thing we are deliberately not
building.

What we **do** take — as ideas, reimplemented cleanly:

| Source | Idea extracted | Lands in |
|---|---|---|
| Freqtrade | lookahead + recursive analysis; protections | Phase 5 causality tests |
| FinMem | layered memory with importance decay | Phase 1 memory graph |
| TradingAgents | bull/bear/neutral debate before a call | Phase 3 Analyst |
| FinRobot | analyst cockpit / teaching UX | Phase 7 Analyst & Tutor |
| Superalgos | node-based strategy + memory graph visuals | Phase 7 React Flow |
| Nautilus | research↔live semantic parity; risk-before-execute | Phase 2 contract |
| LEAN | fill/fee/slippage reality models | Phase 5 cost stress |
| Hummingbot | controller/executor split | Phase 2 boundary |

Any future intake follows: pin commit → licence check → isolated build → run their tests →
dependency + secret scan → assumption audit → clean-room plan → integrate behind our contract.

---

## 8. Phases

Each phase ends with a verifiable artifact. I execute them in order without stopping.

### Phase 0 — Foundation, contract, guardrails
`lib/governance/policy.ts` (permitted/prohibited as data) · guardrail test suite ·
`docs/CONTRACT_QUANTCORE_V1.md` · bridge handoff dirs + claim protocol · ownership hook.
**Done when:** guardrail tests fail on a deliberately introduced violation, then pass when reverted.

### Phase 1 — Knowledge & memory core
Schema + migration for: `sources`, `claims`, `concepts`, `equations`, `reproductions`, `lessons`,
`quizzes`, `mastery`, `contradictions`, `hypotheses`, `strategy_specs`, `trials`,
`validation_results`, `forward_outcomes`, `failure_memory`, `evolution_proposals`, `audit_events`.
Append-only provenance, source hashes, versioning. Repository + service + tests.
**Done when:** a source can be ingested, produce a claim, a hypothesis, a trial and a lesson, and
the full chain is queryable both directions.

### Phase 2 — Quant Core bridge
`lib/quantcore/`: typed client, HTTP-first with filesystem-artifact fallback, health probe,
`UNAVAILABLE` semantics, zero fabrication. Endpoints: health, universe, scanner candidates,
regime, risk-kernel echo, paper board, trial ledger.
**Done when:** UI renders live quant-core data when up, and a clean unavailable state when down.

### Phase 3 — Analyst & Tutor engine + MCP expansion
MCP tool surface for Claude Code: read evidence, record analyses, log claims/lessons/hypotheses,
query memory, run tutor flows. Epistemic tagging (Known / Inferred / Unknown / Conflicting /
Historically-observed / Not-forward-validated). Bull/bear/neutral debate record. Citations enforced.
**Done when:** from Claude Code I can analyse an instrument end-to-end and it appears in the UI
with every claim traceable to a source.

### Phase 4 — Research factory
Durable SQLite job queue + worker (runs without Claude). Ingestion pipelines for paper, video
(transcript + timestamped evidence), and repository sources. Dedup, contradiction detection.
**Done when:** a queued source is processed to hypotheses by the worker with Claude Code closed.

### Phase 5 — Strategy Lab & validation
Bounded Strategy DSL + compiler · trial ledger with **complete** attempt accounting · locked
holdout guard (query budget enforced in code) · walk-forward · Monte Carlo · cost stress ·
no-trade comparison · lookahead/recursive causality tests. Heavy compute delegated to Trading_BOT
where it already exists; ledger and governance live here.
**Done when:** a candidate runs the full gauntlet and is promoted or rejected with stored evidence,
and a second query of the locked holdout is refused.

### Phase 6 — Learning mode
State machine (off / observing / learning / evolving) · curriculum + mastery scoring ·
evolution proposals with review gates · scheduled wake loop · failure memory feedback.
**Done when:** learning mode runs a full cycle producing a reviewed, unmerged proposal — and
provably cannot touch anything on the prohibited list.

### Phase 7 — The terminal (15 screens)
Command Center · Live Market · Scanner · **Analyst & Tutor** · Instrument Research · Edge Factory ·
Strategy Lab · Experiment Lab · Research Library · **Memory Graph** · Paper & Shadow ·
Portfolio & Risk · Agents & Jobs · Data Quality · Audit & Settings.
**Done when:** every screen renders with real or explicitly-unavailable data. No placeholder pages.

### Phase 8 — Claude Code control plane
`.claude/skills/` (codebase audit, repo intake, source ingestion, finance tutor, numerical
reproduction, strategy DSL, validation, Monte Carlo, MCP security, evidence report) ·
`.claude/agents/` (architect, auditor, researcher, validator, security reviewer, frontend
reviewer) · `.claude/hooks/` (block forbidden mutations, block secrets, run tests after edit,
require evidence before completion, path-ownership guard) · `.mcp.json` · CLAUDE.md rewrite.
**Done when:** hooks demonstrably block a forbidden edit and a secret in a staged diff.

### Phase 9 — Hardening & verification
E2E suites · CI gates · MCP policy audit (READ / WRITE_LOCAL / EXTERNAL_WRITE /
FINANCIAL_MUTATION / UNKNOWN classification, research agents denied the last two) ·
`npm audit` · runbook · recovery docs.
**Done when:** `npm run check` passes clean and the definition-of-working checklist in
`01_CLAUDE_CODE_MASTER_REQUIREMENTS.md` §14 is satisfied line by line.

---

## 9. Definition of working (from your own spec, §14) — VERIFIED 2026-08-06

- [x] clean install succeeds — `npm ci` → `npm run check`
- [x] backend and frontend launch — production server serves all screens
- [x] fixture/demo mode runs with no credentials — `MARKETPULSE_TEST_MODE=1`
- [x] real providers report `AUTH_REQUIRED`, never fake data — `AI_PROVIDER_NOT_CONFIGURED`, `RESOURCE_NOT_PROVIDED`
- [x] scanner produces candidates from live fixtures — renders the real board packet
- [x] strategy experiments persisted — trial ledger, append-only
- [x] validation and Monte Carlo run — 7-stage gauntlet, seeded bootstrap
- [x] learning sources searchable — `/library`, `/memory`, `marketpulse_memory_trace`
- [x] learning plane ingests a source → cited lessons — citations enforced, uncited lessons rejected
- [x] all pages render — 15/15 return 200, zero failures
- [x] skills and agents load — 3 skills, 2 agents, 2 hooks in `.claude/`
- [x] MCP policy audit passes — every tool classified; no `FINANCIAL_MUTATION`, no `UNKNOWN`
- [x] tests pass — **258 tests, 21 files**
- [x] startup and recovery documented — `docs/RUNBOOK.md`
- [x] execution remains disabled by default — `EXECUTION_ADAPTER_MISSING`

Partial: ≥1 numerical-method reproduction per new source — the `knowledge_reproductions` table,
schema and MCP path exist, but no external repository has been taken through intake yet. That is
the first task for the running system, not a build gap.

---

## 10. Verification record

| | At plan time | At completion |
|---|---|---|
| Tests | 84 (12 files) | **258 (21 files)** |
| Typecheck | clean | clean |
| Build | clean | clean |
| Prod vulnerabilities | — | **0** |
| Screens rendering | 4 | **15/15** |
| MCP tools | 7 read-only | **20** (13 read, 7 local-write, 0 mutation) |
| Migrations | 2 | 4 |

Guardrails proven by deliberate violation: a broker-mutation call introduced into `lib/` fails
the suite with the exact file and identifier named, and passes again on revert. Both hooks were
tested as live subprocesses.
