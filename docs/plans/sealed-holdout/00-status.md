# Sealed holdout apparatus — status

**Owner architecture (2026-08-14):** six pieces — HoldoutDefinition (immutable window + snapshot
+ purge/embargo + fingerprint), HoldoutSeal (existence ≠ permission; SEALED →
AUTHORIZED_FOR_EVALUATION → CONSUMED / INVALIDATED), HoldoutAccessLedger (permanent,
family-identity), HoldoutEvaluator (deterministic, same declared costs as the qualifying
experiment, never an LLM), family-level consumption (no free peek via rename/re-version), rich
HoldoutResult (degradation vs validation, reason codes). Chronology: purge gap + embargo
(time-series leakage; TimeSeriesSplit/purged-CV rationale). **Architectural invariant: holdout
comes AFTER robust validation (DSR/PBO gates) and never replaces it** (PBO literature: ordinary
holdout alone is unreliable under repeated selection).

## Gate 0 — reality (verified in source, 2026-08-14)

ALREADY BUILT (and stays the enforcement):
- `holdout_access` + `requestHoldoutAccess` (lib/strategy/selection-ledger.ts:208): identity-based
  charging with BOTH gates — family (stops v1→v2→v3) and campaign (stops invent-a-new-family) —
  refusing without identity, hash-keyed ids. The gauntlet consumes it when evidence carries a
  `holdoutId` (gauntlet.ts:267). Legacy per-spec `holdout_ledger` + `requestHoldout` remain as
  the audit record and the ladder's source (`holdoutStanding`).
- `recordHoldoutOutcome` (lib/strategy/holdout.ts): budget-then-trial (`sealed_holdout` kind);
  "budget spent with no verdict" is treated as exhausted → bury, never re-query. Crash-safe
  conservatively by construction.
- Governance: `requery_locked_holdout` PROHIBITED in every state (protected policy).
- Dataset machinery (13b): `snapshotFromStore` fingerprints every bar; experiments pin
  `datasetSnapshotId` + executionProfileId; `runPortfolioBacktest` is the deterministic engine
  the evaluator reuses.

MISSING (this build):
- No HoldoutDefinition/seal: `holdoutId` is a free string; no window, no sealed dataset, no
  states, no pinned decision rule.
- **No development exclusion**: `snapshotFromStore` serves the ENTIRE store to
  backtest/validation/rehearsal — the would-be holdout window is already visible to development.
  Consequence recorded honestly: every experiment run BEFORE a seal existed is CONTAMINATED with
  respect to that seal; eligibility for evaluation requires the qualifying validation experiment
  to POSTDATE the seal (deterministic check via experiment.createdAt > sealedAt, since post-seal
  snapshots exclude the window by construction).
- No deterministic evaluator over a sealed window; no HoldoutResult.

KEY CONSTRAINT SURFACED: the campaign gate means ONE evaluation per holdout generation per
campaign — with the singleton autonomous campaign, one family's look consumes the generation for
everyone. That is the designed discipline (a sample answers one question); the apparatus
therefore carries GENERATIONS: sealing a new (later) window mints generation N+1 and the next
look. The UI must say this plainly.

## Design (Gates 1-4, condensed)

- **`drizzle/0022_sealed_holdout.sql`** (+ schema.ts + MIGRATIONS registration): 
  `holdout_definitions` (id, generation, market, resolution, start/end epoch-secs, purge/embargo
  secs, sealed-window `dataset_snapshot_id` + fingerprint + bar_count, `decision_rule` JSON
  PINNED AT SEAL TIME — copies of GATES.minOutOfSampleProfitFactor / minTradesForEvidence so a
  later GATES change never moves a sealed bar — state machine columns, actor/timestamps; UNIQUE
  (market,resolution,generation); partial UNIQUE one ACTIVE seal per (market,resolution)).
  `holdout_results` (per owner's field list incl. gross/fees/net, degradation_ratio vs the
  qualifying validation's OOS PF, passed, reason_codes JSON; UNIQUE (holdout_id, family)).
- **lib/strategy/holdout-seal.ts**: createSeal (window defaults: trailing store tail; purge
  default 10 sessions daily / 2 intraday; embargo 5 / 1 — stated, overridable), authorize,
  invalidate (fingerprint drift), activeSealsFor(market, resolution), integrity check
  (recompute window fingerprint = sealed fingerprint, else INVALIDATED).
- **snapshot.ts**: `snapshotWindow(market, resolution, start, end)` (holdout-only build,
  distinct hash namespace); `snapshotFromStore` EXCLUDES [start−purge, end+embargo] of every
  ACTIVE seal (fail-first test: dev snapshot currently contains sealed bars).
- **lib/strategy/holdout-evaluator.ts**: authorize-state check → contamination check →
  `requestHoldoutAccess` (family/campaign) → snapshotWindow + fingerprint verify →
  `runPortfolioBacktest` with the SPEC'S OWN declared costs (same DSL the gauntlet judged) →
  decision by the PINNED rule → `holdout_results` + `recordHoldoutOutcome` (trial + ladder) →
  seal CONSUMED. Every refusal is a coded, stored reason.
- **Job kind `holdout_decision`** (double-gated: confirmed:true + seal state must be
  AUTHORIZED_FOR_EVALUATION; never autonomously enqueued — same constitutional pattern as
  validation/forward_enroll) + API: POST /api/strategy/holdout (seal), POST authorize, GET
  status. Cycle reports eligibility/contamination per validated spec.
- **UI**: /strategies HOLDOUT panel (definition, state, generation, consumption); funnel
  per-stage reason breakdown (owner's cockpit ask).

## Slices — ALL COMPLETE 2026-08-14

- [x] Gate 0
- [x] S1 `drizzle/0022_sealed_holdout.sql` + schema + registration; `holdout-seal.ts`
      (createSeal with trailing-window default, WINDOW_TOO_THIN floor, one-active partial
      unique, generations; authorize/consume/invalidate transitions; fingerprint integrity that
      INVALIDATES on drift). 4/4 unit, first try — the migration applies on a fresh DB.
- [x] S2 development exclusion — **fail-first proven: "development snapshot leaks 94 bar(s)
      from the sealed region"** — `snapshotFromStore` now excludes [start − purge, end + embargo]
      of the active seal for every research build; the unsealed fingerprint returns
      byte-identically after consumption (asserted). `snapshotWindow` (distinct hash namespace)
      builds the sealed window itself.
- [x] S3 `holdout-evaluator.ts` — gate order: seal AUTHORIZED → fingerprint intact → stage ==
      validated (AFTER DSR/PBO, the architectural invariant) → development uncontaminated
      (qualifying gauntlet experiment must POSTDATE the seal — pre-seal snapshots contained the
      window by construction) → family/campaign budget (`requestHoldoutAccess`, the gates that
      already existed) → engine (same `runPortfolioBacktest`, the spec's own declared costs) →
      verdict from the rule PINNED AT SEAL TIME → `holdout_results` (full economics +
      degradation vs validation OOS PF + reason codes) + `sealed_holdout` trial (ladder moves:
      pass → holdout_cleared, fail → graveyard) + seal CONSUMED. Crash-window honesty: access
      consumed before the engine looks; a crash leaves "budget spent, no verdict" which buries.
      2/2 unit incl. the contamination refusal consuming nothing.
- [x] S4 `holdout_decision` durable kind (confirmed:true + never auto-enqueued — the
      validation/forward_enroll constitutional pattern) + POST /api/strategy/holdout (seal;
      decision rule pinned from GATES at the route), /authorize (house 428 confirm gate), GET
      (seals + results) + cycle actions stating the one next act per universe. worker-kinds 8/8.
- [x] S5 HoldoutPanel on /strategies (definition, window, pinned rule, state, next act,
      evaluations with degradation) + funnel per-rung waiting breakdown (owner cockpit ask).
- [x] S6 e2e (seal over real ingested history → bare authorize 428 → confirm → panel states
      it): found one honest refinement live — a single instrument's 260-bar tail is 52 bars,
      UNDER the 60-bar floor, and the seal REFUSED (WINDOW_TOO_THIN working as designed; journey
      now ingests two instruments). Clean runs: 9 passed (40.8s) + virgin-DB 3 passed (16.8s).

**The consumption discipline surfaced for the owner:** one look per generation per campaign —
with the singleton autonomous campaign, ONE family's evaluation consumes the generation; the
next look is a NEW seal (generation N+1) over later data. The panel and cycle actions both say
this. Existing validated strategies whose gauntlet ran before any seal are
CONTAMINATED_DEVELOPMENT until re-validated post-seal under the governor — stated, not hidden.
