# NSE-QC-001 — Gate 0 reality (2026-08-15, production database read directly)

## What exists (STATICALLY_CONFIRMED / OBSERVED)

- **Canonical universe**: 3,325 securities in `nse_securities` (production). The master sync
  machinery exists; the deterministic fresh-install bootstrap remains the engine lane's release
  item.
- **Data coverage — the honest constraint**: 28 instruments hold ≥ 60 daily bars in production;
  12 hold 5-minute history; 50,464 candles total. **The eligible universe at pin time is ~0.8%
  of canonical.** Full-NSE coverage is an INGESTION-BREADTH item, not a campaign-machinery item.
- **Campaign machinery**: `research_campaigns`/`strategy_families` with `declaration_hash`
  (0008), `strategy_identity`, `selection_trials` — all live in production (2 prior campaigns,
  9 prior families, 1 selection trial, 22 specs). Until tonight campaigns were created only by
  the autonomous author's catch-all (`camp_autonomous_research`, one auto-family per
  hypothesis); an explicit registration surface did not exist — built this leg as
  `lib/strategy/campaign-registry.ts` (idempotent, tamper-refusing) + the
  `scripts/register-nse-qc-001.mts` runner, matching the established `scripts/*.mts` pattern.
- **Cost model**: effective-dated schedules with trade-date lookup exist (`cost-model.ts`);
  gauntlet cost-stress at 2×; the flat DP charge modelled.
- **Gates**: gauntlet GATES (OOS PF ≥ 1.1, PBO ≤ 0.5, DSR ≥ 0.95 over counted prior trials);
  forward policy (adaptive minSignals 20–80, expectancy ≥ 0, drift ≤ 0.6, maxDD ≤ 10%); sealed
  holdout family-level one-shot; trial governor default 1/day.
- **Learning state**: production machine is ON (`learning`, set by owner 2026-08-11).

## What blocks a full-scale production run (stated precisely)

1. **Data breadth** — 28 eligible of 3,325. The campaign RUNS on the eligible subset honestly;
   scaling coverage needs real-provider ingestion breadth (engine-lane data work; the NSE
   connector exists, `lib/market/nse-connector.ts` + data-priority policy).
2. **Autonomous trial spending** — `MARKETPULSE_AUTONOMOUS_TRIALS=1` is OFF unless the OWNER
   sets it on the serving process. Until then the machine rehearses and prepares but does not
   spend gauntlet trials autonomously; this contract does not and must not override the switch.
3. **Quant core** — optional analytics enrichment; its absence degrades honestly
   (RESOURCE_NOT_PROVIDED), it does not block.

## What is NOT blocked

Registration (done), rehearsal on eligible instruments, variant generation inside declared
dimensions with selection-trial counting, the scoreboard's campaign/family views, and the typed
rejection analysis loop.
