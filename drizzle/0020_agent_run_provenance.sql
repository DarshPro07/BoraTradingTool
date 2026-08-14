-- Agent-run provenance: link a run to its AgentDefinition and the durable job that drove it.
--
-- The AgentRun ledger (0015) recorded provider/model/tokens/cost/status but not WHICH agent
-- definition ran or WHICH job scheduled it. Rung 3 (Agents/Teams on the Job OS) needs both, so a
-- prompt change to an agent never makes its historical runs irreproducible (agent_version pins the
-- exact definition) and so a run is traceable to the job that owns its lifecycle (job_id).
--
-- All three are NULLABLE: existing browser-triggered runs (trigger=USER) have no agent definition
-- or job, and must remain valid. A run created by the durable job path carries all three.

ALTER TABLE agent_runs ADD COLUMN agent_id TEXT;
ALTER TABLE agent_runs ADD COLUMN agent_version TEXT;
ALTER TABLE agent_runs ADD COLUMN job_id INTEGER;
