# Gates 1–3 — Product, architecture, program design (consolidated)

The owner's directive is the product spec (lifecycle, structures, 18 tests). Design decisions on
top of it:

## Structures (migration 0012, all trigger-enforced)
- `forward_challengers` — frozen identity: spec/family/campaign, activation time, code
  fingerprint (`marketpulse-dsl@<COMPILER_VERSION>`), engine version, broker profile, fee model,
  universe JSON, dsl hash, pinned gauntlet experiment + snapshot, predeclared policy JSON +
  version, status, watermark. UPDATE allowed ONLY on status/retirement/watermark (trigger);
  DELETE refused. UNIQUE(spec) — a logic change is a new version and a new challenger.
- `forward_signals` — full payload (clause evidence, feature values, entry/stop/target, horizon,
  profile, cost model, data quality, fingerprint); UNIQUE(challenger, instrument, event_time);
  NO UPDATE, NO DELETE.
- `forward_signal_outcomes` — PK signal_id (idempotency by construction); fills, exit reason,
  MFE/MAE, gross/cost/net, `economics_unavailable`, benchmark, fingerprint; NO UPDATE/DELETE.

## Engine (`lib/forward/shadow.ts`)
- `activateChallenger`: refuses without research identity, without a gauntlet experiment
  (the frozen baseline it must be compared against), with unpriceable economics, or when a
  challenger already observes the spec. Policy predeclared via `deriveForwardPolicy`
  (frequency-aware; fp-2026-08-09.1).
- `runShadowPass`: per challenger — bars strictly AFTER the watermark from `snapshotFromStore`
  (store-only, shared per market|resolution); full condition-tree evaluation (incl. crossings via
  previous vector); signal inserted BEFORE any outcome logic; then open signals resolve from bars
  strictly after their event time (stop → gap-aware fill; target; broker square-off minute for
  intraday via the execution profile; horizon); watermark advances last. Late/out-of-order bars
  below the watermark are settled history and cannot mint signals.
- `forwardScorecard`: forward record vs the pinned inspection experiment's per-trade ledger;
  drift = mean of capped expectancy + win-rate divergences; verdicts INSUFFICIENT / ON_TRACK /
  DRIFTING / MEETS_POLICY / FAILS_POLICY — never a pass invented after the fact.

## Wiring
- Cycle leg (learning mode, gated by `run_historical_replay` permission) after auto-gauntlet.
- `/api/forward` (GET scorecards + eligible), `/api/forward/activate` (428 → confirm → 201),
  `/api/forward/run` (manual/e2e pass). `ForwardEvidencePanel` on /paper.

## Deliberate simplifications (stated)
- Long-only, entry at triggering bar close, notional-normalized costs (₹10,000 probe) — the
  shadow stage measures signal survival, not execution microstructure; the paper stage owns
  fills/sizing/liquidity (WS1b).
- Shadow does NOT write into the legacy `forward_outcomes` ledger — that is the paper-stage
  record and the promotion ladder's input; blending stages was explicitly forbidden.
