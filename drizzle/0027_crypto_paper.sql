-- Solana paper book (owner instruction 2026-09-19: "Build the Solana paper slice").
--
-- Separate from the NSE paper tables on purpose: a different asset, currency, cost model and
-- market with no session hours. Fills come from real Jupiter swap quotes for the order's exact
-- size; nothing here holds a key or signs a transaction.
--
-- Seeded at 300 USDC, roughly the 25,000 INR the NSE paper account runs at, so the two books are
-- judged at comparable size.

CREATE TABLE IF NOT EXISTS crypto_paper_accounts (
  asset TEXT PRIMARY KEY,
  starting_cash REAL NOT NULL,
  cash REAL NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS crypto_paper_positions (
  mint TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  quantity REAL NOT NULL,
  average_cost REAL NOT NULL,
  realized_pnl REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS crypto_paper_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mint TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  quantity REAL NOT NULL,
  usdc_amount REAL NOT NULL,
  fill_price REAL,
  fees_usdc REAL NOT NULL DEFAULT 0,
  price_impact REAL NOT NULL,
  route TEXT,
  status TEXT NOT NULL,
  reason TEXT,
  thesis TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO crypto_paper_accounts (asset, starting_cash, cash, updated_at)
VALUES ('USDC', 300, 300, CAST(strftime('%s', 'now') AS INTEGER));
