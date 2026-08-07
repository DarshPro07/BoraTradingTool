ALTER TABLE knowledge_sources ADD COLUMN content TEXT;
ALTER TABLE ai_runs ADD COLUMN evidence_json TEXT;
ALTER TABLE paper_orders ADD COLUMN expires_at INTEGER;
ALTER TABLE paper_orders ADD COLUMN resolved_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_paper_orders_status_expiry
  ON paper_orders(status, expires_at);
