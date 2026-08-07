# MarketPulse OS — Master Architecture, Workflow and Requirements

**Status date:** 6 August 2026
**Inspiration:** the "THREEPIO V1 / Millennium Falcon" reel (`Video-5812.mp4`), transcript and frames both analysed
**Governing principle, adopted verbatim from the reel:** *prove it works before it trades*

This document is the single reference for what the system is, how work flows through it, and
what it requires to run. It supersedes nothing in `CLAUDE.md` — the execution ban and the
protected-path list still bind everything below.

---

## 0. What the reel actually shows, and what it admits

The narration describes a loop:

> finds papers and books → downloads, reads, cites → strategy factory builds strategies from
> that knowledge → star map checks correlation between tested strategies → out-of-sample →
> screening → Monte Carlo → walk-forward → deflated Sharpe → demo account → portfolio, swapping
> out underperformers → risk gate → and it speaks

That loop is worth copying. The *results* on screen are not, and the interface is honest enough
to say so:

| On-screen claim | What it admits |
|---|---|
| 393 research items in <24h, "actually read" | credibility split is **386 practitioner / 7 peer-reviewed** — it is 98% blog posts |
| Factory Generation 8 | **survivors 0, buried 200** |
| Portfolio HQ, −$2,188 combined drawdown over 253 days | panel is labelled **SYNTHETIC** |
| Lifecycle | "promotions past paper require a human" |
| Status bar | `LIVE OFF · MODE BACKTEST` |

So: a system whose main output is killing its own ideas, which labels the parts that are not
real yet, and which has not yet promoted anything. **That is the thing to copy.** The particle
graphics are not the product; the graveyard and the SYNTHETIC label are.

Our one material improvement over it: **the reel's screen-then-gauntlet flow is a statistical
trap**, and we close it. See §3.2.

---

## 1. The three planes

```
┌──────────────────────────────────────────────────────────────────────┐
│  CONTROL PLANE — Claude Code (you), via MCP, and the voice front end  │
│  reasons · researches · proposes · records conclusions with provenance│
│  cannot: place orders · change learning mode · approve its own work   │
└───────────────────────────────┬──────────────────────────────────────┘
                                │  20 MCP tools (14 read, 7 write-to-local-db)
┌───────────────────────────────▼──────────────────────────────────────┐
│  EVIDENCE PLANE — this Next.js + SQLite app                          │
│  deterministic machinery that keeps running when Claude is closed:    │
│  data → features → backtest → screen → gauntlet → paper → risk gate   │
│  owns: the ledger, the holdout budget, the graveyard, the audit trail │
└───────────────────────────────┬──────────────────────────────────────┘
                                │  bridge files only, never direct writes
┌───────────────────────────────▼──────────────────────────────────────┐
│  QUANT PLANE — E:\Trading_BOT (Python, owned by the OpenCode agent)   │
│  heavy simulation and research the TS engine is the wrong tool for    │
└──────────────────────────────────────────────────────────────────────┘
```

**Why Claude is the control plane and not an embedded model.** The app never holds a Claude
subscription token — that would breach Anthropic's consumer terms. Reasoning runs on your own
subscription through Claude Code; conclusions persist into the product with provenance. The
API-key path in `lib/ai/` exists only for unattended jobs and is optional.

**Why the supervisor cannot be trusted with everything.** The statistical evaluators, the
holdout budget, the risk gate and the capability check are deterministic and sit *outside* the
agent's control. An agent that can move its own goalposts has no goalposts. This is not a
comment on model reliability; it is the same reason a trader does not also run the risk desk.

---

## 2. Component inventory — what is real today

Honest status. `built` means it exists, typechecks, and has tests that would fail if it broke.

| Layer | Module | Status | Note |
|---|---|---|---|
| Data | `lib/data/technicals.ts` | built | RSI/MACD/Bollinger, confirmed-bar contract, warm-up states |
| Data | `lib/data/research.ts`, `context-writer.ts` | built | partial-failure aware; reports `degradedSources` |
| Data | `lib/data/cache.ts` | built | LRU + deadline + staleness |
| Features | `lib/backtest/features.ts` | built | 19 derivable from OHLCV; 4 named as **unavailable**, never defaulted |
| Backtest | `lib/backtest/engine.ts` | built | decide-on-close, fill-on-next-open, refuses rather than guesses |
| Backtest | `lib/backtest/parity.test.ts` | built | independent reference impl + golden fixture + 60 seeded paths |
| Backtest | `lib/backtest/portfolio.ts` | built | multi-instrument, position cap, mismatched calendars |
| Execution | `lib/execution/orders.ts` | built | resting orders, partial fills by participation, OCO, TIF, stop-or-worse |
| Factory | `lib/factory/screen.ts` | built | cheap pre-filter that **reports its own selection cost** |
| Validation | `lib/strategy/statistics.ts` | built | deflated Sharpe, Monte Carlo bootstrap, PBO/CSCV |
| Validation | `lib/strategy/gauntlet.ts` | built | 7 stages, one transaction, holdout budget consumed before any statistic |
| Risk | `lib/risk/gate.ts` | built | 9 rules, fails closed, evaluates all rules for the audit trail |
| Paper | `lib/paper/*` | partial | single-shot evaluator; does not yet use the order book or mark-to-market NAV |
| Governance | `lib/governance/*` | built | protected paths, learning modes, eleven always-prohibited actions |
| Knowledge | `lib/knowledge/*`, research queue | partial | storage and queue exist; the autonomous acquisition loop does not |
| Star Map | — | **not built** | correlation/linkage between tested strategies |
| Factory generations | — | **not built** | breed → screen → gauntlet → bury, graveyard, kill ledger |
| Portfolio HQ | — | **not built** | combined drawdown vs ruin line, underperformer rotation |
| Voice | — | **not built** | §5 |
| Pre-market IN/US | — | **not built** | sessions, auctions, bands, bans |
| Pine Script v6 | — | **not built** | |
| Microstructure | — | **not built** | no bid/ask/depth anywhere in the schema |
| Broker execution | — | **structurally absent, permanently** | `/api/trade/place` → `EXECUTION_ADAPTER_MISSING` |

---

## 3. The workflow

### 3.1 The loop, end to end

```
  ┌─ RESEARCH ─────────────────────────────────────────────────────┐
  │ source → credibility tier → claim → epistemic status           │
  │ known · historically_observed · inferred · not_forward_validated│
  │ · conflicting · unknown                                        │
  └────────────────────────┬───────────────────────────────────────┘
                           │ a claim becomes a HYPOTHESIS
  ┌────────────────────────▼───────────────────────────────────────┐
  │ FACTORY   breed N candidates sharing one hypothesisId          │
  │           screenPopulation() → survivors + selectionCost       │
  │           the other N−k are buried, with the reason recorded   │
  └────────────────────────┬───────────────────────────────────────┘
                           │ survivors only, carrying selectionCost
  ┌────────────────────────▼───────────────────────────────────────┐
  │ GAUNTLET  7 stages, in order, all recorded:                    │
  │   1 replay          ≥30 out-of-sample trades                   │
  │   2 walk_forward    OOS profit factor ≥ 1.1                    │
  │   3 deflated Sharpe ≥ 0.95 vs best-of-N null  ← selectionCost  │
  │   4 causality       PBO ≤ 50%                                  │
  │   5 cost_stress     profit factor ≥ 1.0 at 2× costs            │
  │   6 monte_carlo     P(losing run) ≤ 35%                        │
  │   7 no_trade        must beat doing nothing                    │
  │ any fail or inconclusive ⇒ not promoted. Holdout budget spent  │
  │ BEFORE any statistic is computed, so a refusal cannot be retried│
  └────────────────────────┬───────────────────────────────────────┘
                           │ passed
  ┌────────────────────────▼───────────────────────────────────────┐
  │ PAPER     forward-resolved observations only. Historical win    │
  │           counts are not evidence of edge.                     │
  └────────────────────────┬───────────────────────────────────────┘
                           │ human, owner-authenticated
  ┌────────────────────────▼───────────────────────────────────────┐
  │ PORTFOLIO risk gate on every path · correlation ceiling ·       │
  │           combined drawdown ceiling                            │
  └────────────────────────┬───────────────────────────────────────┘
                           │
                    ✋ ORDERS ARE PLACED BY THE OWNER, OUTSIDE THIS SOFTWARE
```

### 3.2 The correction we make to the reel's design

The reel breeds a large population, buries most of it, and promotes the best. Frame evidence:
Generation 8, **200 buried**, ranked by "top screen P&L".

Selecting the best of 200 and then grading it against a null of *one* attempt is not multiple-
testing control — it relocates the search to somewhere the accounting cannot see. The screen is
where the selection happened.

`screenPopulation()` therefore returns `selectionCost`, and `runGauntlet` takes it as
`evidence.screenedCandidates` and folds it into the deflation denominator. Concretely: the
Sharpe a winner must clear rises from `expectedMaxSharpe(5)` to `expectedMaxSharpe(200)`.
Refusals are excluded — a candidate that produced no statistic could not have been chosen on
the strength of one, so counting it would raise the bar without cause.

`lib/factory/screen.test.ts` asserts exactly this property.

### 3.3 Rules that hold in every mode

Learning mode (`off → observing → learning → evolving`) widens autonomy. It never touches these:

- no order placement, in any mode, by any actor, ever
- no modification of the risk kernel
- no deletion of a trial
- no re-query of a locked holdout beyond its budget of one
- no self-approval: only an owner-authenticated session changes learning mode or merges an
  evolution proposal. `MARKETPULSE_AGENT_TOKEN` identifies a worker and confers no authority.

Enforced three ways: `lib/governance/policy.ts`, database triggers, and tests that fail the build.

---

## 4. Claude Code as supervisor

The supervisory role is real but bounded. What it does each cycle:

1. **Read the evidence** — `_get_research_snapshot`, `_quantcore`, `_system_status`,
   `_memory_trace`, `_get_audit`, `_research_queue`.
2. **Decide what is worth testing** and why, in writing.
3. **Record conclusions with provenance** — `_record_analysis`, `_record_claim`,
   `_record_hypothesis`, `_record_lesson`, `_record_failure`.
4. **Instruct the deterministic machinery** rather than performing its job: enqueue research,
   define the population, request the screen, request the gauntlet — once.
5. **Abstain.** `_record_analysis` rejects a directional stance supported only by inference,
   and rejects any analysis without an invalidation condition. That is the guardrail working.

What it never does: run the gauntlet speculatively (every trial permanently raises the bar for
that family), fill a `RESOURCE_NOT_PROVIDED` gap with a plausible number, or raise conviction
to compensate for thin evidence.

**Self-development** is a proposal pipeline, not a write. The agent authors a change; an
isolated evaluation runs; an owner merges. Protected paths are unreachable by hook and by test —
including from a shell, which is why Bash is disabled for the autonomous profile.

---

## 5. Voice control

Target: talk to it normally, and it has full control over everything it is *allowed* to control.
That last clause is the whole design.

```
  microphone
      │  browser MediaRecorder, push-to-talk or wake word
      ▼
  ASR   Groq whisper-large-v3   (already proven on this machine — the reel
      │                          transcript above came through it)
      ▼
  INTENT  small closed vocabulary, not free-form:
      │   "what's my risk right now"      → read
      │   "analyse RELIANCE"              → read + record
      │   "screen 200 candidates for H7"  → compute
      │   "run the gauntlet on spec X"    → compute, ONE trial, confirms first
      │   "what did you bury this week"   → read
      ▼
  CAPABILITY CHECK  lib/trading/capabilities.ts + lib/risk/gate.ts
      │   every stateful intent passes here. Unknown intent ⇒ refuse and say so.
      ▼
  EXECUTE  the same MCP/HTTP surface the UI uses. No private back door.
      ▼
  SPEAK BACK  status-first, like the reel: "the Falcon's running clean"
              → "gate armed, nine rules green, nothing promoted today,
                 two candidates buried"
```

Hard boundaries, non-negotiable:

- **Voice cannot arm live trading.** Not because it is filtered out — because there is no
  execution adapter to arm. The refusal is structural.
- **Voice cannot change learning mode or approve a proposal.** Those need an owner-authenticated
  session; a spoken utterance is not one.
- **Voice cannot spend the holdout budget without an explicit confirmation turn.** Running the
  gauntlet is irreversible: it permanently raises that family's bar.
- **Every voice action lands in the audit trail** with the transcript that caused it. If it
  cannot be reviewed, it should not have happened.

Cost note: audio leaves the machine for Groq. That is a deliberate trade for accuracy. A local
`whisper.cpp` swap is a drop-in for the ASR box if you would rather it did not.

---

## 6. System requirements

### Runtime
- Node 20+, Next.js 16.3, React 19, TypeScript 5
- SQLite via better-sqlite3 + Drizzle; WAL mode; the DB is the system of record
- Vitest 4 (unit/property), Playwright (E2E)
- MCP SDK v2 — `npm run build:mcp` after any change to `mcp/server.ts`
- Voice, when built: a modern browser for capture; Groq or a local Whisper for ASR

### Data
- **Free and sample tiers only.** No fabricated tick data, ever. Schema stays ready for a
  licensed feed; absence is reported as absence.
- Point-in-time discipline: a feature is available only if it was knowable at decision time.
  Lookahead is a refusal (`FEATURE_NOT_AVAILABLE`), not a default.
- No bid/ask/depth exists in the schema today. Any claim about spread capture is unbacked
  until a microstructure plane lands, and scalping in particular lives on exactly that spread.

### Operational
```bash
npm run dev                    # http://127.0.0.1:3000
npm run check                  # typecheck + tests + build
npm run build:mcp              # after changing mcp/server.ts
npx vitest run lib/governance  # the guardrail suite
```
Green bar as of this document: **typecheck clean · 434 tests / 36 files · build clean · E2E 12/12.**

### Known operational debt
- `lib/governance/hooks.test.ts` spawns the guard hook as subprocesses and has flaked twice in
  full runs; it passes in isolation and on re-run. It is CI fragility, not a regression, and the
  file is hook-protected so it cannot be fixed from here.
- `app/api/proposals/route.ts` does `String(body.actionId)` on an object → `"[object Object]"`.
- The Finnhub key in `.env.local` is in git history and must be rotated. Owner action.

---

## 7. Build order from here

Correctness before capability, which is what has been followed so far.

1. **Persist the order state machine** — new migration for `stopPrice`, `timeInForce`,
   `parentOrderId`, `ocoGroupId`, `filledQuantity`, plus `paper_fills`; mark-to-market NAV.
   Until this lands, the paper engine and the order book are two different sets of rules.
   **Owner action required:** `lib/paper/engine.ts` and `lib/paper/repository.ts` are
   hook-protected as part of the risk kernel (`lib/governance/paths.ts:37-38`), so the rewiring
   cannot be done autonomously. `lib/execution/orders.ts` holds the correct semantics and is
   fully tested; adopting them is an owner-reviewed change.
2. **Star Map** — pairwise correlation between tested strategies. This is what feeds the risk
   gate's `maxPairwiseCorrelation`, which today has a rule and no data behind it.
3. **Factory generations** — breed, screen, bury, with the graveyard and kill ledger persisted.
   Generation N+1 must be reproducible from generation N.
4. ~~**India truth** — intraday STT~~ **done.** `lib/paper/fees.ts` now models both regimes.
   Correction to an earlier statement in this document: charging the delivery regime to an
   intraday trade *overcharged* it, which **understated** results rather than overstating them —
   a conservative error. The non-conservative error in the same file was intraday brokerage of
   zero, now modelled at the lower of ₹20 and 0.03% per order plus GST. `DELIVERY` remains the
   default so recorded fills keep the policy they were priced under.
5. **USA truth** — sessions, halts, conditions.
6. **Microstructure plane** — `market_quotes` with bid/ask and an availability flag, so
   "unknown spread" is representable.
7. **Pre-market pipelines**, then **Pine v6**, then **the autonomous loop**, then **voice**.

Voice is last on purpose. A voice interface to a system that cannot yet prove its own results
is a better demo and a worse instrument.

---

## 8. The standard this system is held to

- Analysis is research and opinion. It is not financial advice.
- Missing is not zero. `RESOURCE_NOT_PROVIDED` is reported, never filled in.
- Abstain is a valid and frequently correct answer.
- Only forward-resolved observations are unbiased evidence, and there are very few of them.
- Every promotion past paper requires a human.
- Orders are placed by the owner, outside this software.
