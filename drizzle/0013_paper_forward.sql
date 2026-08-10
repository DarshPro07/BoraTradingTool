-- WS1b: the paper stage for forward challengers (owner directive 2026-08-10).
--
-- Three ledgers, deliberately separate and never overwritten into each other:
--   execution_intents        — what was DECIDED, with the account state at decision time.
--                              Rejections are evidence ("signal valid, capital insufficient").
--   paper_forward_orders     — the order lifecycle. Identity/intent columns are frozen; only the
--                              lifecycle fields may move, and terminal states are final.
--   paper_position_outcomes  — what actually happened, append-only.
--
-- Accounts start from the owner's real validation capital (default ₹1,000), never a flattering
-- crore — the most valuable paper result may be a rejection.

CREATE TABLE IF NOT EXISTS paper_forward_accounts (
  challenger_id   TEXT PRIMARY KEY REFERENCES forward_challengers(id),
  currency        TEXT NOT NULL,
  starting_cash   REAL NOT NULL,
  cash            REAL NOT NULL,
  enrolled_at     INTEGER NOT NULL,
  enrolled_by     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS execution_intents (
  id                  TEXT PRIMARY KEY,
  -- One intent per forward signal, ever. Restarts and replays cannot double-execute a signal.
  signal_id           TEXT NOT NULL UNIQUE REFERENCES forward_signals(id),
  challenger_id       TEXT NOT NULL REFERENCES forward_challengers(id),
  instrument_id       TEXT NOT NULL,
  decision_time       INTEGER NOT NULL,
  side                TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  desired_quantity    INTEGER NOT NULL,
  order_type          TEXT NOT NULL,
  expected_price      REAL NOT NULL,
  stop_price          REAL,
  target_price        REAL,
  capital_before      REAL NOT NULL,
  risk_budget         REAL NOT NULL,
  broker_profile_id   TEXT,
  fee_model_id        TEXT NOT NULL,
  decision            TEXT NOT NULL CHECK (decision IN ('EXECUTE', 'REJECT')),
  reject_reason       TEXT,
  fingerprint         TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS execution_intents_no_update
BEFORE UPDATE ON execution_intents
BEGIN SELECT RAISE(ABORT, 'execution_intents is immutable; a decision cannot be revised after it is made'); END;

CREATE TRIGGER IF NOT EXISTS execution_intents_no_delete
BEFORE DELETE ON execution_intents
BEGIN SELECT RAISE(ABORT, 'execution_intents is append-only'); END;

CREATE TABLE IF NOT EXISTS paper_forward_orders (
  intent_id        TEXT PRIMARY KEY REFERENCES execution_intents(id),
  challenger_id    TEXT NOT NULL,
  instrument_id    TEXT NOT NULL,
  accepted_at      INTEGER NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('ACCEPTED', 'TRIGGER_PENDING', 'FILLED', 'REJECTED', 'CANCELLED', 'EXPIRED')),
  fill_time        INTEGER,
  fill_price       REAL,
  filled_quantity  INTEGER NOT NULL DEFAULT 0,
  fees             REAL,
  slippage         REAL,
  reason           TEXT,
  updated_at       INTEGER NOT NULL
);

-- Lifecycle-only mutability: identity is frozen, terminal states are final.
CREATE TRIGGER IF NOT EXISTS paper_forward_orders_frozen
BEFORE UPDATE ON paper_forward_orders
WHEN OLD.intent_id IS NOT NEW.intent_id
  OR OLD.challenger_id IS NOT NEW.challenger_id
  OR OLD.instrument_id IS NOT NEW.instrument_id
  OR OLD.accepted_at IS NOT NEW.accepted_at
  OR OLD.status IN ('FILLED', 'REJECTED', 'CANCELLED', 'EXPIRED')
BEGIN
  SELECT RAISE(ABORT, 'paper_forward_orders: identity is frozen and terminal states are final');
END;

CREATE TRIGGER IF NOT EXISTS paper_forward_orders_no_delete
BEFORE DELETE ON paper_forward_orders
BEGIN SELECT RAISE(ABORT, 'paper_forward_orders is append-only'); END;

CREATE TABLE IF NOT EXISTS paper_position_outcomes (
  intent_id       TEXT PRIMARY KEY REFERENCES execution_intents(id),
  challenger_id   TEXT NOT NULL,
  instrument_id   TEXT NOT NULL,
  entry_time      INTEGER NOT NULL,
  entry_price     REAL NOT NULL,
  quantity        INTEGER NOT NULL,
  exit_time       INTEGER NOT NULL,
  exit_price      REAL NOT NULL,
  exit_reason     TEXT NOT NULL,
  mfe             REAL,
  mae             REAL,
  gross_pnl       REAL NOT NULL,
  fees            REAL NOT NULL,
  net_pnl         REAL NOT NULL,
  capital_after   REAL NOT NULL,
  fingerprint     TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS paper_position_outcomes_no_update
BEFORE UPDATE ON paper_position_outcomes
BEGIN SELECT RAISE(ABORT, 'paper_position_outcomes is immutable'); END;

CREATE TRIGGER IF NOT EXISTS paper_position_outcomes_no_delete
BEFORE DELETE ON paper_position_outcomes
BEGIN SELECT RAISE(ABORT, 'paper_position_outcomes is append-only'); END;
