# MarketPulse OS — Master PRD

**The whole system, A to Z: what works, what half-works, what does not exist.**

Written 2026-09-20 from a live audit of the running system, not from the code's intentions.
Every "VERIFIED" line below names the evidence that produced it. Every "PARTIAL" line names what
is missing. Nothing here is marked done because a file exists.

Owner: Devendra. Agent of record: Claude Code (Opus 5).
This sits above `docs/plans/fund-os/`, `docs/plans/autonomous-fund/` and `docs/MASTER_PLAN.md`,
which remain the detail for their slices.

---

## 0. What this system is meant to be

The owner's words, across this build: *"a master automated hedge fund company style less cost
system … automated research self evolving learning build observing adjusting calibrating
automated everything no human interaction"*, trading **NSE equities and crypto**, eventually
**intraday like a real trader replacing the real trader**, with **four layers running
simultaneously, none stopping**, a **shared memory every sub-agent learns from**, and **its own
earned trust before real money**: *"first it gets my trust that yeah it can earn me"*.

Capital, as the owner set it on 2026-09-20:

| | amount | product | status |
|---|---|---|---|
| **Training** | ₹25,000 | DELIVERY | paper only; the book strategies breed against |
| **Real** | ₹5,000 | INTRADAY only | not connected to anything; no broker exists |
| Crypto sleeves | $75 + $75 | spot | paper, at real Jupiter quotes |

> *"Let it first train on 25 or 50 k and later once trained then we would give it the actual 5k."*

### The one rule

**This system has no broker adapter and places no orders.** Verified live today: a POST to
`/api/trade/place` on the running app is refused before it reaches any execution path
(`401 LOCAL_SESSION_REQUIRED` unauthenticated; `EXECUTION_ADAPTER_MISSING` is the capability
fence behind it, pinned by `lib/trading/capabilities.test.ts` and `lib/trading/fence.test.ts`).
Orders are placed by the owner, by hand, outside this software. Everything below is research,
paper trading, and evidence.

---

## 1. How this PRD was produced

| method | what it showed |
|---|---|
| Playwright over the running app (`scripts/audit-live.mjs`, 21 screens) | the watchdog's own FAIL lines, mandate NAVs and gates, the paper book's self-contradiction, real page latencies |
| Direct queries against the 855 MB live database | 3 fund decisions, 2 executions, 6 NAV marks, 186 knowledge sources, 62 strategy specs, 38 paper orders, 28 dead research jobs, **10 unreadable intraday specs** |
| Windows Task Scheduler state | a **5h12m cycle outage** with no record, `ExecutionTimeLimit` of 72h, `MultipleInstances=IgnoreNew` |
| Full test suite | 210 files, 2,282 passing — including two that had been failing at HEAD and were hiding a dead lane |

The finding that matters most: **every serious defect found today was invisible from inside the
code.** Each module was correct; the system was not. That is the same failure class `CLAUDE.md`
was written for, and it is why Gate 0 (Reality) and Gate 5 (Independent Verification) exist.

---

## 2. Capability ledger

### L0 — Data

| capability | state | evidence |
|---|---|---|
| NSE daily history, 2,123 instruments | **VERIFIED** | watchdog: `2123/2123 NSE instruments hold the 2026-09-18 session` |
| Self-extending NSE calendar | **VERIFIED** | watchdog: `derived through 2026-09-18; 0 day(s) behind` |
| Upstox daily backfill (to 2000, unauthenticated) | **VERIFIED, PAUSED** | owner instruction: stop further unauthenticated backfill; 420 instruments kept |
| Intraday 5m bars accumulated past the provider window | **PARTIAL** | `intraday_accumulation` recorded 35×; depth is thin and most of the universe has no 5m bar at all |
| Crypto prices (Jupiter, real quotes) | **VERIFIED** | FC1/FC2 sleeves marked daily; NAV $74.52 / $75.04 |
| Missing ≠ zero discipline | **VERIFIED** | `RESOURCE_NOT_PROVIDED` / `QUANT_CORE_UNAVAILABLE` surfaced, never filled |

### L1 — Research intake

| capability | state | evidence |
|---|---|---|
| arXiv q-fin ingestion by a free model | **VERIFIED** | 186 `knowledge_sources`; research-papers job succeeded 6× on `opencode-free` |
| Claims, hypotheses, epistemic status, invalidation conditions | **VERIFIED** | enforced by `marketpulse_record_analysis`; it rejects a stance held on inference alone |
| Repo intake with licence analysis (`repo-auditor`) | **VERIFIED** | AutoHedge intake, `docs/plans/autohedge-intake/` |
| News / filings / earnings intake | **MISSING** | nothing reads company events; Fund OS S4 is still `todo` |

### L2 — Strategy generation and validation

| capability | state | evidence |
|---|---|---|
| Factory breeds candidates every cycle | **VERIFIED** | 62 specs on record, up ~25 during this audit alone |
| Rehearsal (zero-trial dry run) each cycle | **VERIFIED** | `rehearsal_outcomes` written against recorded snapshots |
| Gauntlet spends a governed permanent trial | **VERIFIED** | `MARKETPULSE_AUTONOMOUS_TRIALS=1`, Trial Budget Governor, 1/day |
| Costs priced at the product actually traded | **FIXED TODAY** | intraday was charged the delivery DP fee in three separate layers |
| **Intraday strategies reachable at all** | **FIXED TODAY** | all 10 intraday specs were unreadable; the factory had stopped breeding them entirely |
| Promotion to forward paper | **PARTIAL** | the ladder exists; **0 paper challengers** stand today, 1 selection trial spent, nothing validated |
| Multiple-testing arithmetic (family denominators) | **VERIFIED** | campaign NSE-QC-001 registered, hash-pinned, 28/3325 eligible |

### L3 — Execution (paper only)

| capability | state | evidence |
|---|---|---|
| Deterministic paper engine, INR + USD books | **VERIFIED** | 38 paper orders; `/paper` renders the book |
| Intraday ORB mandate IN1 (Zarattini, Barbon & Aziz 2023) | **BUILT, NEVER RUN** | `intraday_setup` recorded once; **zero `intraday_decision` rows** |
| Autonomous fund FN1 / FC1 / FC2, frozen and hash-pinned | **VERIFIED** | FN1 correctly OUT (close 266.08 < SMA200 278.01, Faber 2007); FC1 and FC2 holding |
| Append-only ledger; the decision is recorded before its outcome exists | **VERIFIED** | `audit_events` BEFORE DELETE trigger; 3 decisions, 2 executions, 6 NAV marks |
| Risk kernel, kill switches, eleven prohibited actions | **VERIFIED** | `lib/governance/policy.ts` + database triggers + build-failing tests |
| **Real-money execution** | **ABSENT BY DESIGN** | no broker adapter; the owner trades by hand |

### L4 — Meta: memory, agents, watchdog

| capability | state | evidence |
|---|---|---|
| Model router across free and paid CLIs | **VERIFIED** | codex 5 SUCCEEDED, opencode-free 6 SUCCEEDED, claude-sonnet-5 3 COMPLETED |
| Quota rest / resume, per-job tool allowlists, sandboxing | **VERIFIED** | rests recorded in `audit_events`; no non-Claude CLI can touch the repo |
| Shared memory (MarketPulse MCP + local Mem0, free) | **PARTIAL** | registered in all four CLIs and proven to recall; **the MCP servers were down during this audit** |
| Antigravity (replacing Gemini) | **BLOCKED** | 4 FAILED runs; needs the owner's one-time login (`! agy`) |
| Watchdog reading each layer's own ledger | **VERIFIED, AND IT WORKED** | it reported the cycle and agent outages before I found them |
| Telling the owner when a layer dies | **MISSING** | the watchdog writes to a page nobody is watching |

---

## 3. What this audit found and fixed today

| # | defect | how it hid | state |
|---|---|---|---|
| 1 | The **cost repair destroyed the specs it repaired** — it replaced the whole `costs` object, dropping `assumedSpreadBps`, which the DSL requires at intraday resolution | every unit test passed; the rewrite also raised the declared cost, so no later pass ever re-examined it. All 10 intraday specs were dead, permanently | **fixed**: one shared `repairDeclaredCosts()` that preserves the object and refuses to write a DSL that will not parse back |
| 2 | The **authoring script could not author** an intraday strategy — it priced 5m specs at the delivery schedule and refused them at 29 bps | the refusal looked like a correct cost gate doing its job | **fixed**: priced at the implied product |
| 3 | The **factory stopped breeding intraday** when training moved to ₹25,000 DELIVERY this morning | every candidate was valid; the only symptom was silence in the one lane the real ₹5,000 can trade | **fixed**: breeds for both books, sizing live-book candidates by the live book |
| 4 | `/paper` told the owner to **destroy the training book** ("run set-paper-capital to align them") | the sentence was true yesterday and wrong today, in three copies | **fixed**: one `paperBookDrift()` measured against `TRAINING_CAPITAL` |
| 5 | A **5h12m cycle outage** left no record: a 72h time limit plus `IgnoreNew` means one hung run suppresses every trigger after it | the watchdog reported it; nothing reads the watchdog | **fixed**: limits now 40 / 25 / 3 min, and every scheduled run's stdout lands in `logs/` |
| 6 | `/data-quality` loaded **3,574,571 candle rows into JavaScript** to count them | it was only slow, and slow reads as "big database" | **improved**: 12.8s→8.3s and 17.2s→1.7s. The page is still slow — see §4.3 |
| 7 | The gauntlet's `tradable_at_capital` guard compared products for **equality**; cost-gate and promotion priced every strategy as DELIVERY | fixed earlier the same day, in the capital-split commit | **fixed** |

---

## 4. The gaps between here and "it can earn me"

Ranked by what actually blocks the owner's goal.

### 4.1 P0 — Nothing has been forward-validated. There is no edge on record.

1 selection trial spent, **nothing validated**, 0 paper challengers, 2 strategies rejected. The
fund's three mandates are 1–3 days live. Trust gates: **0 of 12 passing** (T1 needs 30 days, T2
needs 90 days plus the declared benefit appearing, T3 needs MinTRL cleared).

This is not a defect — it is the system being honest. But it is the whole distance to the goal.
Nothing can be trusted with money until forward evidence exists, and forward evidence only
accrues in calendar time.

**What it needs:** the pipeline running unattended and correctly for 30, then 90 days, with the
intraday lane finally alive. Everything below serves that.

### 4.2 P0 — The intraday lane has never executed a single decision

IN1 is built and scheduled every minute on weekdays 09:14–15:39, and has produced **zero
`intraday_decision` rows** because it was set up after Friday's close. Its first real minute is
**Monday 2026-09-21 09:14 IST** — and until today the specs it draws on were unreadable and the
factory was not breeding them.

**Acceptance:** by Monday 15:40 IST, `intraday_decision` rows exist for all three names, the
watchdog `intraday` check reads OK, and `/fund` shows the day's decisions with their reasons.

### 4.3 P1 — Two pages take over a minute

Measured warm, with a cycle running: `/data-quality` 77s, `/brain` 80s. `storedCoverage` is no
longer the whole story; the rest is unprofiled. A dashboard nobody can open is a dashboard that
does not exist.

**Acceptance:** both under 5s warm, measured by `scripts/audit-live.mjs`.

### 4.4 CLOSED BY THE OWNER — no alerting; the watchdog stays on the page

The watchdog knows when a layer dies, and writes it to `/fund`. During today's five-hour outage
nothing reached the owner.

**Owner's decision, 2026-09-20: keep it on the page.** No Telegram, no email. The cost is
accepted knowingly: an overnight or weekend outage stays invisible until someone opens `/fund`,
which is why the scheduled-task time limits (§3, defect 5) matter more than they otherwise would
— they cap a single failure at 40 minutes instead of letting it run for five hours.

Revisit only if the owner asks.

### 4.5 P1 — 8 e2e artifacts and 28 dead jobs sit in the production database

`e2e_ledger_api_…`, `e2e_orb_…` and six siblings are Playwright fixtures living in the live
database, still unreadable. 28 `research_jobs` are dead with no recorded error. Neither is
dangerous today; both are exactly how a fixture ends up counted as a strategy tomorrow — the
14-of-22 contamination this repo already survived once.

**Acceptance:** e2e runs write to a separate database; the existing rows are quarantined with a
recorded reason rather than deleted silently.

### 4.6 P2 — Antigravity is blocked on a human login

4 failed runs. One `! agy` from the owner unblocks a whole free model tier.

### 4.7 P2 — No news, filings or earnings intake (Fund OS S4); no skill-pack import (S7)

### 4.8 P2 — `next build` has not been verified since 8deb4c9 (OOM under memory pressure)

---

## 5. Build order

Each item states the falsifiable condition that ends it. Nothing is "done" because a file exists.

**Week of 2026-09-21**

1. **Watch Monday's intraday session end to end** (§4.2). If IN1 produces no decision, that is the
   week's only work until it does.
2. **Owner: `! agy`** (§4.6). One minute of human time.
3. **Profile `/brain` and `/data-quality`** (§4.3) the way `storedCoverage` was profiled: measure
   first, fix the measured thing, measure again.

**Weeks 2–5**

5. **Let the evidence accrue.** The governor rations one trial a day. Do not add strategies to
   make the pipeline look busy — the multiple-testing denominator is real and permanent.
6. **Quarantine the e2e rows; separate the e2e database** (§4.5).
7. **T1 (30 days operational)** falls due around 2026-10-18 for FN1/FC1/FC2. Report it from the
   ledger, not from a claim.

**Month 2+**

8. **News and filings intake** (§4.7) — only once the existing lanes are producing.
9. **Broker adapter design** (not implementation): what it would take, what the owner must
   approve, and what can never be automated. The owner wants one eventually; it stays a document
   until T1–T3 pass and the owner says otherwise.

---

## 6. The trust ladder to real money

Unchanged from `docs/plans/autonomous-fund/`, restated because it is the spine of this PRD:

| gate | condition | state today |
|---|---|---|
| **T1** operational | 30 days of unbroken, recorded decisions | FN1/FC1/FC2 at 1–3 days |
| **T2** behaves as declared | 90 days, and the declared benefit actually appears | not started |
| **T3** statistical | MinTRL (Bailey & López de Prado) cleared against the real trial count | not started |
| **Owner** | explicit approval, per mandate | never granted |

All four are required. The system **cannot** grant any of them to itself, and real-money
execution does not exist to be switched on.

---

## 7. What must never happen

- No order placement. No broker adapter without the owner's explicit, separate authorisation.
- No trial spent to make the pipeline look productive.
- No number invented when a source is unavailable — `RESOURCE_NOT_PROVIDED` is the answer.
- No name that promises more than the code delivers (`switchOn`, `researchReady`, `RAW`).
- No deletion of a trial, no re-query of the locked holdout, no edit of the risk kernel.
- No e2e fixture counted as a strategy.

---

## 8. Open questions for the owner

1. **Training capital**: stay at ₹25,000, or raise to ₹50,000? (`TRAINING_CAPITAL` is one constant.)
2. ~~Alert channel~~ — answered 2026-09-20: none; the watchdog stays on the page (§4.4).
3. **The 8 e2e rows**: quarantine (recommended) or delete?
4. **Intraday universe**: RELIANCE, HDFCBANK, ICICIBANK only, or widen once Monday proves the lane?
