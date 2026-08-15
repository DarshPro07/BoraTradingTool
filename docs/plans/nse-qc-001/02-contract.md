# NSE-QC-001 — the frozen research contract

**Pinned 2026-08-15, BEFORE the first result** (owner directive). The machine declaration is
`lib/strategy/campaigns/nse-qc-001.ts`; the registry (`lib/strategy/campaign-registry.ts`)
hashes each family into `strategy_families.declaration_hash` and **refuses** a changed
re-registration — altering this contract after results exist is mechanically impossible without
declaring a new family/campaign. That refusal is the point: do not silently widen a search box
because early results look poor.

## ResearchCampaignId

`camp_nse_qc_001` — question: across the eligible NSE universe, do any of five declared
families hold a repeatable NET positive edge after the full effective-dated Indian cost stack,
surviving rehearsal → cost-aware gauntlet (DSR/PBO over counted trials) → sealed holdout →
forward evidence → paper?

## StrategyFamilyIds (declarations verbatim in the module; hashes bind them)

| Family | Id | Product |
|---|---|---|
| Opening Range Breakout | `fam_qc001_orb` | INTRADAY, 5m |
| Relative-volume momentum breakout | `fam_qc001_rvol_breakout` | INTRADAY, 5m |
| Intraday mean reversion (midday fade) | `fam_qc001_intraday_mr` | INTRADAY, 5m |
| Swing cross-sectional momentum | `fam_qc001_xsec_momentum` | DELIVERY, daily |
| Swing mean reversion (oversold snap-back) | `fam_qc001_swing_mr` | DELIVERY, daily |

Published inputs (`docs/external/orb-research-inputs.md`): SSRN 5198458 (NSE ORB block
evaluation) and SSRN 4729284 (US equity ORB) generated the ORB hypothesis. **Inputs, not
proof** — different universes, different market structure, no shared cost model.

## UniverseSnapshot policy

The eligibility ladder, evaluated at campaign scan time and RECORDED with each scan:

1. **Canonical**: the NSE security master (`nse_securities`; 3,325 securities at pin time).
2. **Data-quality eligible**: ≥ 250 gap-checked daily bars in the canonical store; intraday
   families additionally require ≥ 100 sessions of 5m bars. (At pin time only **28 instruments**
   carry ≥ 60 daily bars — the eligible set is honestly TINY until ingestion breadth grows; the
   scoreboard states universe vs eligible side by side, and a scan over 28 is reported as 28,
   never extrapolated.)
3. **Liquidity eligible**: median 20-session share volume ≥ 100,000 AND the 5 bps assumed
   per-side spread (`ASSUMED_INTRADAY_SPREAD_BPS`, a STATED assumption, not a measurement) must
   be defensible — both proxies recorded per instrument at scan time.
4. **Execution-feasible**: one share affordable at the owner's capital basis (last close ≤
   ₹2,000 — the internal policy floor, see memory/capital-floors), price-band-hit sessions
   ≤ 2% of the lookback.

## DatasetSnapshot policy

Every rehearsal, gauntlet and holdout verdict is judged on a pinned `dataset_snapshots` row
(the item-13/13b apparatus); a verdict without its snapshot id is invalid. No development stage
may read bars inside a live sealed-holdout window (fail-closed exclusion, the e0f2a3d design).

## Timeframe

Intraday families: 5m bars, entries 09:30–14:30 IST, mandatory flat by close. Swing families:
daily bars, delivery product, holds per family declaration (≤ 10 sessions MR; rebalance 5–10
days momentum).

## Parameter-search space

Exactly each family's `allowedVariantDimensions` (hashed). A configuration outside the box is a
NEW family by definition and must be declared as one.

## Cost schedule

The effective-dated schedules in `lib/paper/cost-model.ts` + `lib/paper/fees.ts`, evaluated AT
THE TRADE DATE — never today's rates over history. Statutory stack per
`docs/external/india-equity-costs.md` (STT 0.025% intraday sell-side; SEBI ₹10/crore; stamp
0.003% intraday buy-side; GST 18%; brokerage min(0.03%, ₹20)/order; flat DP ≈ ₹15.93 per
delivery sell scrip-day — the charge that dominates at small notional). Plus stated frictions:
5 bps/side assumed spread (intraday), slippage per `ASSUMED_SLIPPAGE_BPS`. NSE's levy page is
explicitly updated for 2026-04-01 rates — re-verify sources before adding any new schedule row.

## Execution assumptions

No broker adapter; nothing is placed. Paper fills at bar prices with the stated
spread/slippage; DELIVERY legs pay the flat DP charge on sells; capacity is NOT modelled (the
capital basis is ₹1,000–2,000 — spread realism, not market impact, is the binding friction, and
market impact is recorded as 0 WITH THAT STATEMENT, not silently).

## Validation gates (the gauntlet, as coded at pin time)

`lib/strategy/gauntlet.ts` GATES: OOS profit factor ≥ 1.1 (walk-forward, chronological splits
only — no shuffled CV anywhere, ever); PBO ≤ 0.5 (CSCV); **Deflated Sharpe ≥ 0.95 computed over
the family's counted prior trials**; cost-stress: survives 2× the modelled costs; Monte-Carlo,
causality and no-trade-comparison stages as coded. Every stage failure lands as a typed
rejection (`trials.kind` + verdict + reason).

## Trial budget

The Trial Budget Governor's default: **1 gauntlet trial per day** across the autonomous lane,
enforced by reservation slots. Autonomous spending stays OFF until the owner sets
`MARKETPULSE_AUTONOMOUS_TRIALS=1` on the serving process — a human-only switch this contract
does not override. Every selection configuration (spent or not) is a `selection_trials` row —
the DSR denominator.

## Holdout policy

The sealed apparatus as shipped (`e0f2a3d`): immutable definition, one FAMILY-LEVEL evaluation
per holdout generation, access-ledgered, consumed-once; tuning against consumed holdout data is
prohibited in every state (governance-enforced).

## Forward requirements

The shadow stage's policy as coded: adaptive minSignals 20–80 (per-session × minSessions), net
expectancy ≥ 0, drift ≤ 0.6, max drawdown ≤ 10%, trigger-immutable signals. Only
forward-resolved observations count as unbiased evidence.

## Paper requirements

Paper-forward only after forward evidence suffices (the promotion ladder's own gate); NET after
the full modelled cost stack; every position outcome persisted with gross/fees/net.

## The behavioral rule (binding on AUTO)

**No survivor-optimization.** "Nothing survived" triggers ANALYSIS of the typed rejection
distribution, never parameter generation until something passes:

- cost_stress dominant (≥ 80%) → the family's economics are probably too weak for the cost stack
- parameter_stability dominant (≥ 70%) → the hypothesis is fragile, not under-tuned
- PBO repeatedly high → the search process is too flexible — NARROW it, never widen
- holdout degradation → development overfit — the answer is fewer trials, not more
- all families failing → investigate different market phenomena; close the campaign honestly

**A result of "0 survivors, with strong evidence explaining why" is a SUCCESSFUL campaign
outcome.** Prefer no strategy over a statistically weak strategy.
