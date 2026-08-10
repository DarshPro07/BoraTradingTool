# MarketPulse OS Setup

MarketPulse is a local, single-user research application. It has no broker adapter and cannot place, approve, cancel, or report a real order. The owner performs any real-world execution manually outside the software.

## 1. Prerequisites

- Node.js 20.9 or newer
- npm
- Optional: Claude Code for interactive analysis through MCP
- Optional: `E:/Trading_BOT` for quant-core artifacts

## 2. Install and Start

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Open `http://127.0.0.1:3000`.

The SQLite database is created and migrated automatically. To place it somewhere else, set `MARKETPULSE_DB_PATH` before startup.

The first NSE search automatically bootstraps the canonical security master from fixed official NSE main-board, SME, and ETF files. The request can take several seconds on a new database. If the automatic fetch is interrupted, retry the search or run the same importer explicitly:

```powershell
npm run sync:nse
```

A failed refresh never replaces the last verified master.

## 3. Choose a Data Mode

### Deterministic fixture mode

Set `MARKETPULSE_TEST_MODE=1` for credential-free development, demonstrations, and browser tests. You must also set `MARKETPULSE_DB_PATH` to an explicit disposable database; fixture mode refuses the default owner database. Fixture provenance is persisted on every simulated paper order and remains explicit in API and UI output.

### Research sources

Yahoo-derived data is the default shared research source. Set `FINNHUB_API_KEY` only if optional Finnhub enrichment is needed. Missing or failed sources must render `UNAVAILABLE`, `STALE`, or `AUTH_REQUIRED`; they must never be replaced by invented data.

## 4. Optional AI Providers

Interactive Claude Code analysis uses the local MCP server and does not require an AI key in the app. Unattended structured analysis can use one of the official provider SDKs by setting `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` and the optional model variables shown in `.env.example`.

Provider keys are server-only. The application must not write `.env.local` through an HTTP route.

## 5. Claude Code and MCP

```powershell
npm run build:mcp
claude
```

The project `.mcp.json` points Claude Code at `dist/mcp/server.mjs`. At session start:

1. Read `CLAUDE.md` and `CONTEXT.md`.
2. Confirm the `marketpulse` MCP server is available.
3. Read a research snapshot before forming an opinion.
4. Record conclusions with citations and invalidation conditions.
5. Stop at decision support. Never look for or add a broker mutation path.

The MCP surface is classified as `READ` or `WRITE_LOCAL`. Local writes are limited to the application knowledge store.

## 6. Optional Quant Core

By default, filesystem fallback reads approved artifacts from `E:/Trading_BOT`. Configure `QUANT_CORE_URL` for the loopback HTTP service when it is available. If neither source is usable, the UI shows `QUANT_CORE_UNAVAILABLE`; it does not synthesize scanner, regime, risk, or outcome data.

## 7. Paper Research Mode

The `/paper` screen maintains independent USD and INR ledgers. Fills are deterministic and include estimated fees and slippage. Paper orders require an eligible quote and a regular market session, and enforce the configured watchlist, daily-order, strategy, and position limits transactionally. Simulated limit orders are immediate-or-expire: an uncrossed limit terminates as `EXPIRED` at submission rather than resting without a resolver. They do not touch a broker.

Legacy `/api/trade/*`, Robinhood heartbeat/portfolio, Telegram decision, and fill-report routes are retained only as disabled compatibility surfaces. Mutations return HTTP 503 with `EXECUTION_ADAPTER_MISSING`.

## 8. Security

- Keep the server bound to `127.0.0.1`; do not expose it through a tunnel or public reverse proxy.
- Browser mutations require same-origin requests and `x-marketpulse-csrf: 1`.
- Agent mutations require a timing-safe bearer token from `MARKETPULSE_AGENT_TOKEN` with at least 32 characters.
- Owner-only controls require a distinct `MARKETPULSE_OWNER_TOKEN` with at least 32 characters. Enter it on `/learning` to create a 15-minute HttpOnly local session; it is never stored in browser storage.
- Never configure the owner and agent tokens to the same value; owner authentication fails closed if they match.
- `.env*`, SQLite files, backups, generated context, and test artifacts are gitignored.
- Never commit or paste provider keys, tokens, account identifiers, or database files.

## 9. Verification

```powershell
npm run typecheck
npm test
npm run test:mcp
npm run build
npm run test:e2e
npm run audit:prod
```

Use an isolated database and fixture mode for verification. See `docs/RUNBOOK.md` for health checks and recovery procedures.
