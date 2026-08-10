# Gate 0 — Reality (all STATICALLY_CONFIRMED by reading, then REPRODUCED by probes)

- `runValidationRehearsal` took an injected `CandleLoader` (bare bars, no identity); the cycle
  passed `marketCandleLoader` (store-first ≥250 bars, silent provider fallback) AND a
  daily-sample reuse closure. No snapshot recorded anywhere.
- `/api/strategy/gauntlet` line 81 and `auto-gauntlet` line 298 built evidence from the same
  loaders. `GauntletEvidence.datasetFingerprint` was optional and usually absent.
- `selection_trials` / `holdout_access` / `rehearsal_outcomes` carried no dataset identity.
- Promotion's cost rung (`costStanding`) THREW `CostModelError` out of `evidenceFor` when no fee
  schedule was in force — a crash, not a stated block.
- The simulation battery is fully seeded (seed 42) — determinism tests are meaningful.
- `trial_` ids were `familyId.slice(0,8) + fingerprint.slice(0,10)` — a latent PK collision for
  prefix-sharing families testing the same configuration (found by the new determinism test).
- Hypothesis refusals PERSIST a durable hypothesis row (content-hash idempotent, listed by GET,
  shown in the inbox) — so 201 on refusal is the correct status per the owner's rule.
- `MARKETPULSE_TEST_MODE=1` swaps in a FIXTURE provider (not an empty one): the cycle's
  accumulator leg ingests fixture bars into the store mid-test. Ingestion-via-provider is the
  permitted flow; tests that need a pinned store must mark the session's accumulation done.
