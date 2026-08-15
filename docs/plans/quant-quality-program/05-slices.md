# Quant Quality Program — slices

## Slice 1 — the Quant Scoreboard (DONE 2026-08-15)

**What**: `lib/dashboard/quant-scoreboard.ts` (`quantScoreboard()`) + the QUANT SCOREBOARD panel
at the top of `/brain` + `e2e/quant-scoreboard.spec.ts`. Read-model only — no new tables, no
writer changes. The 12-stage funnel with per-count BASIS strings; ladder rungs from
`standings()` (evidence-derived, injectable seam for tests); typed gauntlet rejections GROUP BY
trial kind; the DSR denominator from `selection_trials`; survivors (latest validation passed)
with DSR/PBO/OOS-PF/cost-multiple; holdout/forward counts; paper NET identity
(gross − fees = net, expectancy/trade, cost share of gross — null over nothing, never fake 0).

**Verification**:
- Units: 5/5 (`quant-scoreboard.test.ts`) — empty-DB honesty (zeros with bases, null ratios),
  rejection grouping order, rung arithmetic incl. graveyard separation, latest-validation
  survivor selection over a superseded failure, paper NET arithmetic; seeds honour the real FK
  chain (campaign → family → spec; outcome → intent → signal → challenger — the ledger refused
  anything less, which is itself the provenance design working).
- tsc silent.
- Live e2e twice on the exact tree: EMPTY state (fresh DB — honest zeros, 2 passed, 24.0s) and
  POPULATED state (a copy of the run-14 acceptance database — 2 passed, 8.6s), console/pageerror
  watched. The populated run rendered the real thing: universe 32, researched 31, hypotheses 17,
  and the typed rejection table `cost_stress 10 · monte_carlo 1 · no_trade_comparison 1 ·
  parameter_stability 1 · walk_forward 1 · graveyard 10` — the owner's "0 survivors can now say
  WHY" table, live, from ledgers that already existed.
- One spec defect found and fixed during verification: a `\b` word-boundary regex cannot match
  concatenated textContent ("STAGEcost_stress") — the populated-state run caught it; assertion
  loosened to substring alternation, both states re-proven.

**Deliberately not in this slice**: universe-coverage beyond master count (needs the engine-lane
bootstrap), regime-stability and per-cost-component KPIs (their reality is UNKNOWN in
01-reality.md), API-cost-per-survivor (needs an agent_runs→campaign join that does not exist).

## Slice 2 — Scoreboard v2: family comparison + rejection diagnosis (DONE 2026-08-16)

**What**: `familyComparison()` (per family: campaign, selection trials, gauntlet passes via
latest-validation×strategy_identity, family-level holdout passes, forward-resolved via the
signal→challenger chain, paper NET via challengers, worst holdout max-DD — nulls render "—")
and `rejectionDiagnosis()` (the owner's behavioral rule as a read model: cost-negative ≥ 80% →
weak economics; parameter-instability ≥ 70% → fragile hypothesis; ≥ 2 validations above the 0.5
PBO gate → "NARROW the search, never widen"; any failed family-level holdout → development
overfit; silent under 5 failures — insufficient evidence is stated, not guessed). Both rendered
in the /brain scoreboard panel: the FAMILY COMPARISON table (the owner's exact columns) and
"WHEN NOTHING SURVIVES — READ THE REJECTIONS, NEVER TUNE UNTIL SOMETHING PASSES".

**Verification**: units 7/7 (FK-complete seeds through the full provenance chains); tsc silent;
live e2e on a fresh DB (honest empty: "no registered families yet" / "no diagnosis yet") AND on
a safe BACKUP COPY of the real production database, where the table rendered 14 families —
including all five newly registered NSE-QC-001 families at 0 trials and the historical
autonomous families — with the 1-trial family correctly sorted first. Full suite 163 files /
1846 passed / 2 skipped / 0 failed. Verification-harness note: a cold `next dev` SSR of /brain
on the production copy exceeds a 30s goto until warmed (~4.6s steady) — warm before driving
Playwright at a dev server; the acceptance context serves prebuilt and is unaffected.

## Next candidate slices (in owner-value order, each needs its own gate pass)

1. Per-campaign drill-in filter (same read model, campaign-scoped).
2. API/model cost per survivor (join design first — 01-reality UNKNOWN).
3. Regime-stability KPI (define regime segmentation honestly before displaying anything).
4. AUTO-loop integration of the diagnosis (the machine READING rejectionDiagnosis before
   deciding next work — a behavior change in the cycle, needs its own gate pass).
