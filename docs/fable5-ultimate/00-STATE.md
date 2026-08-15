# MarketPulse OS — Fable 5 mission state

**This file is the single entry point for a new session.** Read it first; it tells you where the
real evidence lives. It deliberately holds no truth of its own beyond current state — every claim
below points at a gate document, a commit, or a test run. (Masterclass §6 / C37: context survival.)

The masterclass asked for a `docs/fable5-ultimate/` document set. This repository already runs the
mandatory `software-factory-autonomous` gates, which produce **one directory per piece of work**
under `docs/plans/<slug>/` (`00-status.md` … `07-final.md`). Duplicating those into a parallel tree
would create exactly the second, disconnected source of truth the masterclass forbids (C10). So this
file **indexes** them instead, and `99-FINAL-VERIFICATION.md` beside it carries the C53 final report.

---

## Repository

| | |
|---|---|
| Path | `E:\BoraTradingTool` |
| Branch | `checkpoint/m5-research-bridge-verified` |
| Last commit | `973852a` (see the leg table below for the chain) |
| Known-good baseline | `9627ee5` — Master Golden 221/221 ×2, units 1786. Never declare a new baseline without focused tests **and** a full master acceptance. |
| Owner's other repo | `E:\Trading_BOT` — **do not write to it.** A hook blocks the attempt. |

## The one rule that outranks everything

**No broker adapter. No orders. Ever.** `/api/trade/place` returns `EXECUTION_ADAPTER_MISSING`.
If you find yourself reasoning about *how to place* a trade, stop — that is not a capability here.
Paper and forward evidence only. See `CLAUDE.md`.

Protected paths (hook- and test-enforced, read-only): `lib/governance/**`, `lib/security/**`,
`lib/trading/capabilities.ts`, `lib/paper/risk.ts`, `lib/quantcore/contract.ts`, `.claude/hooks/**`,
`.mcp.json`, `mcp/**`, `dist/mcp/**`, `esbuild.mcp.mjs`, `.github/workflows/**`, `.env*`, and any
**applied** migration in `drizzle/` (adding a new one is fine). Full list: `lib/governance/paths.ts`.

---

## Legs completed after the frozen baseline

Each row is a full gate cycle (Reality → Product → Architecture → Program design → Slices →
Independent verification) with its own plan directory. Read that directory, not a summary.

| Leg | Commit | Plan directory | What it established |
|---|---|---|---|
| Extended crash matrix (C39) | `873ff07` | `docs/plans/crash-matrix/` | Kill mid-real-model-call across six job kinds → restart → exactly-once everywhere. Found and fixed a **stranded lane lease** on crash (`lib/runtime/supervisor.ts`): recovery now releases the crashed run's research/supervisor leases; post-recovery all-terminals 121.7s → 36.4s. |
| Strategy pipeline progression | `342414f` | `docs/plans/strategy-progression/` | Five structural funnel defects (22→10→2→0). Authored NSE strategies are now born **5m/INTRADAY** — the product the ₹1,000 capital basis can actually trade — plus rehearsal rotation, guarded cost standing, rendered `blockedOn`, and a path above `validated`. |
| Sealed holdout apparatus | `e0f2a3d` | `docs/plans/sealed-holdout/` | The owner's six pieces: immutable `HoldoutDefinition`, seal states (SEALED / AUTHORIZED_FOR_EVALUATION / CONSUMED / INVALIDATED), access ledger, deterministic evaluator, **family-level** consumption, rich `HoldoutResult`. Holdout sits AFTER DSR/PBO as an architectural invariant — it does not replace them. |
| Provider transport families | `7cbc249`, `973852a` | `docs/plans/provider-transports/` | ONE architecture for a 75+ roster, not 75 adapter files: three HTTP wires (OpenAI-compatible / Anthropic-native / Gemini-native) + the CLI path, 16 registry providers, wire-driven detection ladder, binding provenance stored (`REQUEST_BOUND_ONLY` when a provider cannot guarantee binding — stated, not faked). |
| Brain execution observability | *in flight* | `docs/plans/brain-observability/` | Read-model over existing ledgers: one correlated tree job → TeamRun → AgentRuns → ModelCalls → Artifacts. Assigned vs executed vs verification never collapsed; dissent first-class; TOKENS MEASURED / COST UNAVAILABLE. Produced the **first live team execution in the product's history**. |

## Standing owner order after this leg

> Stop adding infrastructure. Shift to **quant quality**: which strategy families, if any, survive
> gauntlet → sealed holdout → forward → paper after realistic costs across genuinely independent
> NSE data?

Anything that adds a new subsystem instead of answering that question is out of order. The queue in
`docs/autonomous-build/WORK_QUEUE.md` records the freeze.

---

## How to verify anything here

```bash
npm run check                      # typecheck + units + build
npx vitest run lib/governance      # the guardrail suite
npm run test:master-golden         # full product acceptance (~1h, needs a server — see below)
```

Master Golden is not a `npm run` you can background on Windows (`nohup npm` dies silently). The
working pattern, used for every acceptance run in this session:

1. Build once into a **stable** dist dir (`.tmp/next-e2e-30stock`), so tsconfig's auto-append converges.
2. Start the server on **:3100** against a **virgin** DB (`MARKETPULSE_DB_PATH=.../master-runN.sqlite`,
   `MARKETPULSE_TEST_MODE=1`, `QUANT_CORE_URL=off`). The owner's own dev server on **:3000** must not be touched.
3. Compute the identity pin **before** the server starts (`MARKETPULSE_E2E_EXPECT_STARTED_AFTER`);
   a pin that postdates server start is refused by the gate — that refusal is the gate working.
4. Launch `npx playwright test --project=desktop-chromium` detached, then poll the log for
   `N passed (Xm)` / `N failed`.

Two consecutive clean runs on a fresh database are required before any completion claim (C36/C50).

## Traps this repository has already paid for

- **Two concurrent drainers by design** — the research lane (5s/event) and the cycle's embedded
  worker, under separate lease files. Tests must tolerate co-flight, not assume a single drainer.
- `acquireLease` has **no same-holder re-entry**; a crash strands lane leases unless recovery releases them.
- Journey specs seed **daily** bars; strategies are born **5m**. Seed both (`e2e/lib/gap-sessions.ts`)
  or the forward stage truthfully emits zero signals over bars that do not exist.
- Development actors (`rehearsal`, `backtest`, `validation`, `research`) are excluded from a sealed
  holdout window; the forward/shadow evaluator must **not** be — blinding it was a real defect.
- A verdict enum that omits a legitimate value (`MEETS_POLICY`) fails a passing system.

---

## Current state

Filled at the end of each working session. See `99-FINAL-VERIFICATION.md` for the full C53 report.

- **Objective**: brain-observability leg — acceptance #20 (full Master Golden) + the second clean
  run, then commit and freeze infrastructure. **DONE — committed on
  `checkpoint/m5-research-bridge-verified`; see the commit after `973852a`.**
- **The clean pair (C36/C50)**: **run 13: 208 passed / 2 skipped / 0 failed (57.1m)** and
  **run 14: 208 passed / 2 skipped / 0 failed (58.3m)**, both on build `973852a-dirty.4920d47e`,
  virgin identity-gated DBs, launcher `EXIT=0` markers, tree unchanged between the runs. Mobile
  was excluded from runs 9→14 by owner instruction — run 8 (210/2/0, 54.4m) remains the one
  mobile-inclusive green run. Verdict: **VERIFIED_FOR_DEFINED_SCOPE**
  (`docs/plans/brain-observability/07-final.md`).
- **Verification under it**: units 160 files / 1829 passed / 0 failed, tsc clean, production
  build clean. Master Golden runs 4→12: every failure root-caused with ledger/filesystem
  evidence, never retried blindly — three measured budget resizes, one spec-architecture fix
  (provider-transports boots `next start` on the prebuilt dist; compile is out of the readiness
  path), one idempotent ECONNRESET retry, six launcher-environment defects (all recorded in
  07-final's saga, incl. defect 6: harness-child processes do not survive task cleanup — launch
  acceptance runs via the detached `run-master.ps1` shape with an explicit node PATH prefix).
- **What the acceptance runs taught (do not relearn the hard way)**:
  - A spec that boots its own `next dev` inside the master run can blow a 240s readiness budget
    under load. Reuse the ambient server (`MARKETPULSE_E2E_BASE_URL`) unless killing the server
    IS the subject, as it is for the crash specs.
  - A spec that starts the autonomous machine on the shared server **must stop it in `finally`**.
    One left running ticked 15 times and starved the journey chains of real model calls.
  - `net::ERR_NETWORK_IO_SUSPENDED` is the machine dozing, not the product failing. Hold it awake
    for long runs (`SetThreadExecutionState`), and never edit the owner's power plan to do it.
  - Long unbreakable ids (55-char strategy names) are the recurring mobile-overflow cause. They
    must wrap; truncating them would hide which strategy the machine is talking about.
- **Exact next action**: infrastructure is FROZEN. The scoreboard is now the **Quant Quality
  Program** — `docs/plans/quant-quality-program/` (owner directive 2026-08-15): can MarketPulse
  discover a repeatable NET positive NSE edge that survives independent evidence? Read its
  `02-product.md` (funnel, family catalogue, 16-step mission, KPIs) before any work. The
  measurement-honesty residual is CLOSED (`9fb5d7e`,
  `docs/plans/telemetry-measurement-honesty/`).
- **Permanent truthfulness rule (owner, 2026-08-15)**: the acceptance verdict is
  `VERIFIED_FOR_DEFINED_SCOPE — Desktop / Master Golden acceptance; Mobile: separate known gap
  (previously single-run green, run 8)`. Never shorten it to "fully verified" in any document.
