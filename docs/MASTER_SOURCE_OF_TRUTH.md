# MarketPulse OS — master plan, requirements, and verified state

**Single source of truth. Written 2026-08-09.** Supersedes the plan and requirement sections of
`docs/MASTER_PLAN.md`, `docs/REQUIREMENTS.md`, `docs/GOAL.md` and
`docs/OWNER_BRIEF_AND_PLAN_2026-08-08.md` wherever they disagree with it.

Every claim below is labelled: **REPRODUCED** (run and observed), **CONFIRMED** (read in code),
or **ASSUMED** (stated, not verified).

---

## Part 1 — What the owner is building

### Mission (owner-adopted wording, 2026-08-09)

> MarketPulse OS is an autonomous, evidence-driven trading research, software-evolution,
> risk-management, and capital-allocation system for Indian and US markets. It continuously
> acquires evidence, forms hypotheses, creates and tests strategies, rejects statistical
> illusions, improves its own software through independently verified changes, monitors live
> markets, and eventually executes eligible trades under externally enforced risk and regulatory
> controls. It is designed to require no routine human intervention, while never bypassing
> mandatory authentication, regulatory requirements, immutable governance, or emergency controls.
> Its objective is long-term capital growth and capital preservation — not guaranteed daily or
> monthly income. It may abstain from trading whenever evidence, liquidity, costs, risk, or
> market conditions are insufficient.

Corollaries, all owner-confirmed 2026-08-09:

- **Income is an outcome, not a quota.** The system is never given a revenue target as an
  objective function; a target would reward leverage, frequency and weak trades exactly when the
  market offers least. The objective is maximum long-term risk-adjusted after-cost realized
  return under capital-preservation, drawdown, liquidity, position and data-quality constraints.
- **NO TRADE is a successful output**, stated with its reason.
- The ₹1,000 starting balance is **production-validation capital**, not income-producing
  capital: its job is to prove that real execution behaves as research predicted.
- Capital scales only along BACKTEST → SEALED HOLDOUT → FORWARD SHADOW → PAPER → SMALL REAL
  CAPITAL → EVIDENCE → SLOW SIZE INCREASE. Autonomy never extends to modifying risk ceilings,
  broker permissions, holdout policy, trial accounting, validation thresholds, secrets,
  governance or audit history (SEBI retail-algo framework applies from 2026-04-01; broker 2FA
  and IP-whitelisting requirements are constraints to satisfy, never to bypass).

| Decision | Value | Source |
|---|---|---|
| Market | **NSE only.** US on hold | owner, 2026-08-09 |
| Capital | ₹1,000, growing | owner |
| Execution | Automatic, **gated on forward evidence** (≥20 resolved observations) | ADR 0006 |
| Self-modification | Strategies auto; code auto behind an independent verifier | ADR 0006 |
| Edge sources | Kronos ML, classical patterns, LLM research synthesis, factory search — all four | ADR 0006 |
| Human involvement | Minimal. Owner-only: credentials, governance policy, irreversible migrations | ADR 0006 |

### The capital arithmetic, stated once

**ASSUMED→CONFIRMED.** The owner's stated trajectory is ₹1,000 → ₹50,000 in one month: 50× in ~22
trading days ≈ **19.5%/day compounded with no losing days**. No measured edge of that magnitude
exists here or in the literature. This project proceeds on the assumption that the trajectory is
funded by owner contributions and the system's job is to be **proven** by the time capital arrives.

---

## Part 2 — Verified state, 2026-08-09 (run, not assumed)

A full `evolving` cycle was executed against a copy of the owner database. What it actually did:

**REPRODUCED — working:**

| Capability | Evidence from the run |
|---|---|
| Quant-core artifacts | "Refreshed 5 artifact(s)" |
| Memory introspection | "2 finding(s), 1 needing attention, across 130 memory nodes" |
| Promotion ladder | "8 strategies: 2 past draft, 1 buried, waiting — 2 on gauntlet, 5 on rehearsal" |
| Research discovery | "Discovered 81 source(s): enqueued 0, already seen 81" — dedupe working |
| Rehearsal | "Rehearsed 7 candidate(s)… sma_cross_20_50 (165 trades / 24 instruments)" |
| Forecast archive | "15 forecast(s) archived and awaiting a grade" |
| Factory | "bred 100, screened 63, 5 survivors recorded as draft. Selection cost 63" |
| Guarded gauntlet | "8 considered, none eligible. No trial was spent" |

The loop is **not** idle. It does a great deal correctly.

**REPRODUCED — the deadlock:**

```
sma_cross_20_50      eligible=false  failing: tradable_at_capital
sma_cross_ui_probe   eligible=false  failing: tradable_at_capital
f1_gen_*  (×5)       eligible=false  failing: rehearsal, awaiting_gauntlet, tradable_at_capital
```

**Every strategy in the system fails `tradable_at_capital`.** The two that pass rehearsal are
daily-resolution, which implies DELIVERY (needs ~₹23,000). ₹1,000 can only trade INTRADAY. The
factory then breeds *more* daily strategies, so it manufactures candidates its own guard will never
accept.

Consequence: nothing reaches `validated` → nothing reaches `paper_forward` → nothing reaches
`owner_review` → the trade board is permanently empty → **no income is possible by construction.**

This is the root cause of "the system is not working". It is not a missing feature; it is two
modules disagreeing about which product the owner trades.

---

## Part 3 — Requirements

Numbered so work can cite them. **MUST** = the system is wrong without it.

### R1 — Coherence between capital and candidates
- **R1.1 MUST** The factory breeds at a resolution the owner's capital can actually trade.
- **R1.2 MUST** No module produces candidates another module refuses on a property fixed at birth.
- **R1.3 SHOULD** When the two disagree, the system says so rather than silently producing nothing.

### R2 — Research becomes testable ideas
- **R2.1 MUST** A hypothesis that can be expressed in the DSL becomes a draft strategy automatically.
- **R2.2 MUST** A hypothesis that cannot is refused with a stated reason, never converted anyway.
- **R2.3 MUST** A strategy authored from a hypothesis carries that hypothesis as its family.

### R3 — Honest statistics
- **R3.1 MUST** Missing identity fails closed — never a denominator of 1. *(done, verified)*
- **R3.2 MUST** Holdout entitlement gated at family and campaign level. *(done, verified)*
- **R3.3 MUST** Every tested configuration is recorded before its result is computed. *(done)*

### R4 — Learning is measurable
- **R4.1 MUST** The system records whether it is improving over time, not only what it did.
- **R4.2 MUST** Metrics distinguish *activity* (cycles run) from *progress* (evidence accumulated).
- **R4.3 SHOULD** A metric that cannot be computed reports as unavailable, never as zero.

### R5 — Nothing fabricated
- **R5.1 MUST** Missing is not zero, everywhere. *(established convention)*
- **R5.2 MUST** No threshold, cost, timestamp or feature is defaulted where it was not stated.

### R6 — Autonomy without self-approval
- **R6.1 MUST** The system never grants itself a permission. *(governance allowlist, protected)*
- **R6.2 MUST** Irreversible spending (trials, holdout) is guarded and counted. *(done)*

### R7 — NSE security identity and universe truth
- **R7.1 MUST** Current NSE selection comes from a verified official NSE master, never a hardcoded
  fallback. *(done, verified)*
- **R7.2 MUST** ISIN is the durable security identity; symbol/name/series/status are dated listing
  observations. *(done, ADR 0007)*
- **R7.3 MUST** Historical queries see only observations available at that date and refuse dates
  before archive coverage. *(done, verified)*
- **R7.4 MUST** Listing status and market-data availability remain separate facts. *(done, verified)*

---

## Part 4 — Research findings behind the plan

**Why the factory must breed intraday.** CONFIRMED from `lib/paper/cost-model.ts` and its tests:
delivery carries a flat ₹15.93 DP charge per scrip per sell, so its cost *ratio* falls with size
(1.816% at ₹1,000 → 0.238% at ₹1,00,000). Intraday carries no DP charge and its charges are all
proportional, so the ratio is **flat at ~0.106% regardless of size**. That is precisely why intraday
reaches down to a small account and delivery cannot. Breeding daily strategies for a ₹1,000 account
is therefore not a preference — it is arithmetically excluded.

**Why the opening range and session position exist.** Intraday strategies need to know where a bar
sits inside its session. Added 2026-08-09 with `minutes_since_open`, `opening_range_high/low`.

**Why hypothesis→strategy must refuse more than it converts.** REPRODUCED: of the three hypotheses
the system has formed, two must not become strategies — one is about the gauntlet itself, one needs
model-disagreement data that does not exist. A converter that converted all three would be wrong
twice, plausibly and silently.

**Why learning metrics are not activity metrics.** The run log records cycles. Cycles are activity.
The question the owner actually has is *"is this getting better?"*, which requires measuring
evidence accumulated per unit of budget spent — forward observations, trials consumed, hypotheses
resolved — not passes completed.

---

## Part 5 — Build order

| # | Work | Requirement | State |
|---|---|---|---|
| 1 | Factory breeds at the tradable resolution | R1.1, R1.2 | **done 2026-08-09** |
| 2 | Hypothesis → draft strategy, with refusals | R2.1–R2.3 | **done 2026-08-09** |
| 3 | Learning metrics: progress vs activity | R4.1–R4.3 | **done 2026-08-09** |
| 4 | Kite adapter behind forward-evidence promotion | ADR 0006 | contract seam done (`lib/broker/kite-contract.ts`). Production credentials HUMAN-GATED (local env only). **Kite sandbox: official sources CONFLICT** — support portal says none; developer docs describe `sandbox.kite.trade` (demo credentials; no GTT/margins/contract notes/MARKET orders). Runtime probe 2026-08-10: host answers HTTP 200; API contract semantics still unverified. See `docs/autonomous-build/BLOCKERS.md` |
| 5 | Broker execution profiles (dated, sourced) | R5.2 | **done 2026-08-09** — `docs/plans/broker-execution-profiles/`, VERIFIED |
| 6 | Capital feasibility per instrument, with leverage bounds | R5.1 | **done 2026-08-09** — `lib/paper/feasibility.ts` |
| 7 | CI determinism for the three DB-dependent browser tests | — | **done 2026-08-09** — 66 e2e green on a fresh database |
| 8 | UI: learning-metrics + execution-assumptions panel | R4.2 | **done 2026-08-09** — `LearningProgressPanel` on /learning, e2e-verified on a fresh database |
| 9 | Golden Playwright journey (author → rehearse → refuse, 2 viewports, run twice, traces kept) | — | **done 2026-08-09** — `e2e/golden-journey.spec.ts`, `docs/plans/golden-journey/` |
| 10 | CAS/conflict semantics on broker profiles (securityClass; CONFLICTED F&O recorded, conservative 15:25 adopted as stated assumption) | R5.2 | **done 2026-08-09** |
| 11 | Hypothesis creation UI/HTTP surface | R2.1 | **done 2026-08-09** — `docs/plans/hypothesis-ui/`, professor-path e2e green both viewports |
| 12 | Per-trade inspection UI + authoring provenance | — | **done 2026-08-09** — `docs/plans/trade-inspection/`; chart markers deferred |
| 13 | Historical-research data contract: provider → ingestion → canonical store → **dataset snapshot** → experiment → **immutable trade ledger** (found by the inspector: 0 trades from the provider window vs 73 from the 30,832 stored bars) | R5.1, R5 | **done 2026-08-09** — `docs/plans/dataset-source-of-truth/`; snapshots fingerprinted (`lib/research-data/snapshot.ts`), migration 0009 append-only ledger, inspection route ledger-first with provenance, dev build-identity badge, e2e ledger + browser-network proof. Slice **13b done 2026-08-09 (late evening)** — `docs/plans/snapshot-evaluation/`: rehearsal/gauntlet/auto-gauntlet/cycle evaluation now accept ONLY `ResearchDatasetSource` (recorded snapshots); `runGauntlet` throws `DatasetIdentityMissing` on identity-free evidence; migration 0010 adds `experiments.manifest` (strategy/dataset/engine/broker-profile/fee-model/calendar/seed/code-fingerprint/timestamp) + `dataset_snapshot_id` on selection_trials/holdout_access/rehearsal_outcomes; promotion fails closed on `CostModelError` (`costVerdictOrBlocked`); provider-import pin test guards regression; UI shows gauntlet + rehearsal dataset provenance. Hypothesis-refusal 201 kept deliberately: a refusal PERSISTS a durable held-hypothesis resource (listed by GET, shown in the inbox), which is the owner's stated condition for 201 |
| 16 | **Forward Evidence Engine — shadow stage** (mission WS1): frozen challengers, immutable prospective signals/outcomes (trigger-enforced), predeclared frequency-aware policy, drift scorecard vs pinned frozen experiment, cycle leg, /paper panel | ADR 0006, R3 | **done 2026-08-09 (night)** — `docs/plans/forward-evidence/` VERIFIED; migration 0012; WS1b (paper-stage consumption) queued in `docs/autonomous-build/WORK_QUEUE.md`; NSE universe (WS2) owned by the OpenCode agent, in flight |
| 17 | **Paper stage for forward challengers** (WS1b): capital-constrained execution of forward signals at real validation cash; immutable intent/order/outcome ledgers; rejections recorded as evidence; deterministic asOf passes | ADR 0006, R5 | **done 2026-08-10** — `docs/plans/paper-forward/` VERIFIED; migration 0013 |
| 14 | Chart entry/exit markers on trade click | — | **done 2026-08-09** — `docs/plans/chart-trade-markers/`; `TradeChart` on store bars via `/api/research-data/bars`, markers + fill price lines, provider-free by e2e network capture |
| 15 | Held-hypothesis inbox panel (GET exists, unrendered) | R2 | **done 2026-08-09** — `docs/plans/hypothesis-inbox/`; `HypothesisInbox` on /strategies, held-first with reasons visible, e2e both viewports |
| 16 | Official NSE security master: ISIN identity, effective-dated listings, atomic sync, bounded selectors, no survivor/static fallback | R5, R7 | **done 2026-08-09** — `docs/plans/nse-security-master/`; 2,957 official listings parsed twice on isolated DB, mutation guard, 1,356 unit + 36 browser tests, VERIFIED |

### Addendum 2026-08-09 (evening) — execution truth

The hardcoded 15:20 square-off is gone. Zerodha's own documentation (independently fetched) says
15:25 for non-CAS equity, 15:10 for CAS, 15:26 for F&O, Rs 50+GST per forced order, timings
adjustable on volatile days. Deadlines now come from effective-dated `BrokerExecutionProfile`
records carrying source URL, retrieval date, confidence tier and an assumptions list; the engines
refuse (`EXECUTION_PROFILE_UNAVAILABLE`) rather than default, every intraday result returns the
assumptions it ran under, and the fee engine is broker-keyed (Upstox priced as a delta,
cross-broker borrowing refused). Feasibility is per-instrument and cash-based, with the SEBI 5x
ceiling reported only as a labelled bound because per-stock VaR+ELM margins are not held.

---

## Part 6 — Standing rules

- Every task runs the `software-factory-autonomous` gates and writes `docs/plans/<slug>/`.
- A regression test guarding a real defect must be proven to **fail** against the unfixed code.
- Verification runs against a **copy** of the owner database, never the original.
- Owner-only boundaries: credentials, `lib/governance/policy.ts`, `lib/db/migrate.ts`,
  real-money actions.
