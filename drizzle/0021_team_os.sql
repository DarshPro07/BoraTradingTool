-- Team OS (Chief-of-Staff / bounded semantic teams) — rung 3, second leg.
--
-- Two new ledgers plus one nullable link column. Additive only: the existing single-agent path
-- writes none of these and is unchanged.
--
--   team_runs        — one row per Chief-of-Staff coordination; pins the versioned TeamDefinition,
--                      persists the TeamExecutionPlan BEFORE members run, and the dissent-preserving
--                      TeamResult after. Distinct from agent_runs the way AgentRun is from
--                      AgentDefinition: it records what a team DID, by version.
--   agent_artifacts  — the structured, persisted output each member produces. The owner's rule:
--                      members exchange artifacts (consumed by id), never chat transcripts.
--   agent_runs.team_run_id — a chief/member run points back at its TeamRun; NULL for solo runs.

CREATE TABLE IF NOT EXISTS team_runs (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  team_version TEXT NOT NULL,
  job_id INTEGER,
  instrument_id TEXT,
  status TEXT NOT NULL,
  chief_agent_run_id TEXT,
  member_agent_run_ids TEXT,
  artifact_ids TEXT,
  plan TEXT,
  result TEXT,
  tokens INTEGER,
  cost REAL,
  cost_currency TEXT,
  error TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS agent_artifacts (
  id TEXT PRIMARY KEY,
  team_run_id TEXT NOT NULL,
  job_id INTEGER,
  role TEXT NOT NULL,
  kind TEXT NOT NULL,
  agent_run_id TEXT,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_artifacts_team_run ON agent_artifacts (team_run_id);

ALTER TABLE agent_runs ADD COLUMN team_run_id TEXT;
