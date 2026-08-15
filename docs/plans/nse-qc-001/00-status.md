# NSE-QC-001 — status

The first explicitly registered research campaign (owner directive 2026-08-15). The frozen
contract is `02-contract.md`; the machine declaration `lib/strategy/campaigns/nse-qc-001.ts`;
the registry `lib/strategy/campaign-registry.ts` refuses silent redefinition by declaration
hash.

- [x] Gate 0 — reality (01-reality.md): production DB read directly; eligible universe honestly
      tiny (28 of 3,325 with usable daily history) — the campaign runs on the eligible subset
      with coverage stated, never extrapolated
- [x] Contract pinned BEFORE any result (02-contract.md): universe ladder, dataset policy,
      timeframes, per-family parameter boxes, cost schedule at trade date, gates, trial budget
      (governor 1/day; autonomous spending stays behind the owner's
      MARKETPULSE_AUTONOMOUS_TRIALS switch), holdout/forward/paper requirements, and the
      binding no-survivor-optimization rule
- [x] Registered in PRODUCTION: campaign `camp_nse_qc_001` + 5 families created (hashes
      383cfb…/ba404a…/132faf…/1cc28e…/6edf49…), idempotent re-run verified "unchanged",
      tamper-refusal pinned by unit test
- [x] Published ORB studies recorded as hypothesis inputs (docs/external/orb-research-inputs.md)
- [ ] Campaign execution: variant authoring inside the declared boxes with selection-trial
      counting; rehearsal over the eligible subset; gauntlet only under the owner's trial
      switch; typed-rejection analysis after each round

## Exact next action

Machine-side: run the funnel over the eligible subset under the existing AUTO loop.
Owner-side switches when ready: `MARKETPULSE_AUTONOMOUS_TRIALS=1` (gauntlet spending) and
ingestion breadth for universe coverage. Scoreboard v2 (campaign/family views) makes both
visible — see docs/plans/quant-quality-program/05-slices.md slice 2.
