-- Research identity: campaign → family → spec → selection trial, and holdout entitlement.
--
-- The defect this repairs
-- -----------------------
-- Every strategy_specs row has hypothesis_id = NULL, so countSelectionTrials() walks a family of
-- one and deflates the Sharpe ratio against a denominator of 1. And holdout_ledger is keyed on
-- (holdout_id, strategy_spec_id), so a rename, a copy or a new version buys another look at the
-- sealed data — behaviour currently asserted as correct by strategy.test.ts.
--
-- The invariant being installed
-- -----------------------------
--   Changing the name, id, version, parameters or representation of an idea must never erase the
--   statistical history that informed its selection.
--
-- Two ideas are kept deliberately separate, because collapsing them is how the current bug would
-- be replaced by a subtler one:
--
--   * a FAMILY is methodological lineage — one economic hypothesis and its variants;
--   * a SELECTION TRIAL is one configuration that was actually tested and allowed to influence
--     which candidate was chosen.
--
-- Ten ORB variants are ONE family and TEN selection trials. Keying the deflated-Sharpe denominator
-- to the family label would understate N exactly as badly as keying it to the spec id does today.

-- ---------------------------------------------------------------------------
-- The statistical search universe. Everything selected within one campaign was
-- selected using the same data, so contamination is shared across it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS research_campaigns (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL UNIQUE,
  -- What is being searched for. Recorded because the campaign's scope is what makes two families
  -- statistically related, and a campaign nobody can describe cannot be reasoned about later.
  question             TEXT NOT NULL,
  created_at           INTEGER NOT NULL,
  created_by           TEXT NOT NULL,
  closed_at            INTEGER
);

-- ---------------------------------------------------------------------------
-- Methodological lineage. Declared before the first experiment, not inferred
-- afterwards — a family invented after seeing a result is not a new hypothesis,
-- it is adaptive refinement of the old one.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS strategy_families (
  id                        TEXT PRIMARY KEY,
  research_campaign_id      TEXT NOT NULL REFERENCES research_campaigns(id),
  name                      TEXT NOT NULL,
  -- The causal claim. "Early price discovery creates momentum continuation" — not "ORB with a
  -- 15-minute range". The latter is a variant; only the former justifies a separate family.
  economic_hypothesis       TEXT NOT NULL,
  mechanism                 TEXT NOT NULL,
  -- JSON. The box inside which a change stays a variant rather than becoming a new family, e.g.
  -- {"range_window":"10m-30m","stop":"0.25-1.0 ATR"}. Declared up front so the boundary is not
  -- argued about after a disappointing result.
  allowed_variant_dimensions TEXT,
  -- Hash of the declaration above, so a family cannot be silently redefined after experiments ran.
  declaration_hash          TEXT NOT NULL,
  created_at                INTEGER NOT NULL,
  created_by                TEXT NOT NULL,
  UNIQUE (research_campaign_id, name)
);

-- ---------------------------------------------------------------------------
-- Identity, in a side table rather than as columns on strategy_specs.
--
-- Deliberate: `strategy_specs` is read by the whole application with `SELECT *`. Adding columns
-- there would break every one of those reads on any database where this migration has not yet run
-- — and this file cannot register itself, because the MIGRATIONS array lives in the protected
-- `lib/db/migrate.ts`. A side table is additive, so the interim state is "identity absent", which
-- is exactly the fail-closed state wanted anyway.
--
-- A spec with no row here may exist and may be rehearsed. It may not be validated.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS strategy_identity (
  strategy_spec_id      TEXT PRIMARY KEY REFERENCES strategy_specs(id),
  research_campaign_id  TEXT NOT NULL REFERENCES research_campaigns(id),
  strategy_family_id    TEXT NOT NULL REFERENCES strategy_families(id),
  parent_spec_id        TEXT REFERENCES strategy_specs(id),
  -- Structural hash of the normalised rule, ignoring parameter values. An anti-evasion signal,
  -- never the identity itself: EMA(9,21) and EMA(10,22) hash differently while plainly being one
  -- family, and an identical hash can appear in two genuinely different hypotheses.
  semantic_fingerprint  TEXT NOT NULL,
  -- Set only after a human has confirmed the family placement. Fail closed: absent means false,
  -- and false blocks validation. Defaulting a missing identity to "family of one" is the defect
  -- this whole migration exists to repair.
  validation_eligible   INTEGER NOT NULL DEFAULT 0,
  classified_by         TEXT NOT NULL,
  classified_at         INTEGER NOT NULL,
  -- SAME_FAMILY / NEW_FAMILY / UNKNOWN, and why. Kept so a placement can be re-examined later
  -- without re-deriving the reasoning from scratch.
  classification        TEXT NOT NULL,
  classification_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_strategy_identity_family
  ON strategy_identity (research_campaign_id, strategy_family_id);

-- ---------------------------------------------------------------------------
-- The selection trial ledger: one immutable row per configuration that was
-- tested and permitted to influence selection.
--
-- NOT one row per gauntlet stage — that was an earlier bug, where adding a gate
-- silently raised the bar for every strategy in the system.
-- NOT one row per spec — a search that spawns two hundred siblings and reports
-- the best must carry a denominator of two hundred.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS selection_trials (
  id                        TEXT PRIMARY KEY,
  research_campaign_id      TEXT NOT NULL REFERENCES research_campaigns(id),
  strategy_family_id        TEXT NOT NULL REFERENCES strategy_families(id),
  strategy_spec_id          TEXT NOT NULL REFERENCES strategy_specs(id),
  -- Identifies the tested configuration, including parameter values. Two runs of the same
  -- configuration are one trial; two parameter settings are two.
  configuration_fingerprint TEXT NOT NULL,
  experiment_run_id         TEXT,
  -- False for a run that could not influence selection — a crashed job, a data outage. Recorded
  -- rather than deleted, because deleting trial evidence is permanently prohibited.
  selection_eligible        INTEGER NOT NULL DEFAULT 1,
  reason                    TEXT,
  evidence_hash             TEXT,
  started_at                INTEGER NOT NULL,
  completed_at              INTEGER,
  -- One trial per distinct configuration within a family. A re-run of an identical configuration
  -- does not inflate N; a genuinely new setting does.
  UNIQUE (research_campaign_id, strategy_family_id, configuration_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_selection_trials_family
  ON selection_trials (research_campaign_id, strategy_family_id);

-- ---------------------------------------------------------------------------
-- Holdout entitlement, gated twice.
--
-- The family gate stops: v1 → peek → rename to v2 → peek again.
-- The campaign gate stops: family A → peek → learn → invent family B → peek again.
-- Both must permit, because the second attack survives the first gate untouched.
--
-- Keyed on holdout_generation_id, NOT dataset_version. Repairing, re-normalising or extending a
-- dataset does not create a statistically fresh holdout. Only information that could not have
-- influenced prior research does.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS holdout_access (
  id                     TEXT PRIMARY KEY,
  holdout_generation_id  TEXT NOT NULL,
  research_campaign_id   TEXT NOT NULL REFERENCES research_campaigns(id),
  strategy_family_id     TEXT NOT NULL REFERENCES strategy_families(id),
  strategy_spec_id       TEXT NOT NULL REFERENCES strategy_specs(id),
  experiment_run_id      TEXT,
  request_fingerprint    TEXT NOT NULL,
  code_hash              TEXT,
  dataset_hash           TEXT,
  requested_at           INTEGER NOT NULL,
  -- Written in the same transaction as the entitlement check, BEFORE the result is computed. A
  -- crash between consuming and computing must lose the result, never the record of the look.
  consumed_at            INTEGER NOT NULL,
  result_disclosed       INTEGER NOT NULL DEFAULT 0,
  reason                 TEXT
);

-- The budgets, enforced by the database rather than by application logic.
--
-- A UNIQUE index is the whole mechanism: two concurrent requests both pass an application-level
-- "have we used it?" check, but only one can insert. This is what makes the entitlement atomic
-- under concurrency without a lock.
--
-- Both budgets are exactly one. Raising either means deliberately replacing the index below —
-- friction that is the point, not an oversight.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_holdout_campaign_budget
  ON holdout_access (holdout_generation_id, research_campaign_id);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_holdout_family_budget
  ON holdout_access (holdout_generation_id, strategy_family_id);

-- Append-only, matching holdout_ledger. Deleting an access record would restore an entitlement
-- that was genuinely spent, and the result has already been seen by then.
CREATE TRIGGER IF NOT EXISTS holdout_access_no_delete
BEFORE DELETE ON holdout_access
BEGIN
  SELECT RAISE(ABORT, 'holdout_access is append-only: a look at sealed data cannot be un-taken.');
END;

CREATE TRIGGER IF NOT EXISTS holdout_access_no_update
BEFORE UPDATE OF holdout_generation_id, research_campaign_id, strategy_family_id, consumed_at
  ON holdout_access
BEGIN
  SELECT RAISE(ABORT, 'holdout_access entitlement fields are immutable once written.');
END;

-- Selection trials are evidence too. `delete_trial_record` is one of the eleven permanently
-- prohibited actions; this enforces it in the one place application code cannot route around.
CREATE TRIGGER IF NOT EXISTS selection_trials_no_delete
BEFORE DELETE ON selection_trials
BEGIN
  SELECT RAISE(ABORT, 'selection_trials is append-only: removing a trial lowers the multiple-testing denominator and flatters every surviving sibling.');
END;
