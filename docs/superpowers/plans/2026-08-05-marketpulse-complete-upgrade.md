# MarketPulse Complete Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The owner requested inline execution without subagents or additional approval stops.

**Goal:** Build a secure market-aware US/India research terminal with deterministic paper trading, provider-neutral AI analysis, a read-only MCP server, responsive UI, and comprehensive automated verification while keeping broker execution disabled.

**Architecture:** Keep one modular Next.js monolith. Route handlers validate and authorize requests before calling server-only market, research, paper, risk, and AI services; a separate stdio MCP entry point imports only read services. SQLite remains local persistence, with additive versioned migrations and separate USD/INR paper ledgers.

**Tech Stack:** Next.js 16.3, React 19, TypeScript 5, SQLite, Drizzle ORM, Zod 4, official Anthropic SDK, official OpenAI SDK, MCP TypeScript SDK v2, Vitest 4, Playwright 1.60, Tailwind CSS 4.

## Global Constraints

- Support US, NSE, and BSE instruments with equal research and paper-trading capability.
- Paper Research Mode is the default and has no broker capability.
- Confirmed Live Mode stops at `EXECUTION_ADAPTER_MISSING`; no broker adapter is installed by this plan.
- No approval-free Autopilot path may remain.
- Bind development and production servers to `127.0.0.1`.
- All browser mutations require loopback host, same origin, and CSRF header; agent mutations additionally accept a 32-byte-or-longer bearer capability token.
- Model providers are advisory and receive no mutation or broker tools.
- MCP is stdio-only and read-only; protocol output uses stdout and diagnostics use stderr.
- Do not read, overwrite, or commit `.env.local`, existing SQLite data, generated context files, or credentials.
- Preserve the user's existing `package-lock.json` changes while reviewing dependency-generated changes carefully.
- Use `MARKETPULSE_DB_PATH` and `MARKETPULSE_TEST_MODE=1` for tests so verification never opens the owner's runtime database.
- Do not commit unless the owner explicitly requests it.

---

## File Map

### Security And HTTP

- `lib/security/request.ts`: loopback, origin, CSRF, and bearer-token authorization.
- `lib/security/request.test.ts`: unit tests for every trust-boundary branch.
- `lib/http/input.ts`: bounded JSON parsing and reusable strict primitives.
- `lib/http/input.test.ts`: malformed, oversized, control-character, and range tests.
- `lib/client/mutation-fetch.ts`: browser mutation helper that adds the CSRF header.

### Persistence

- `lib/db/index.ts`: configurable SQLite path and Drizzle initialization.
- `lib/db/migrate.ts`: additive migration runner and one-time pre-migration backup.
- `drizzle/0000_existing_baseline.sql`: non-destructive current table baseline.
- `drizzle/0001_multi_market_paper_ai.sql`: canonical instruments, paper ledger, and AI-run tables.
- `lib/db/schema.ts`: typed schema for current and new tables.
- `lib/db/migrate.test.ts`: fresh and representative legacy migration tests.

### Market And Providers

- `lib/market/types.ts`: canonical market, exchange, currency, instrument, quality, provenance, quote, and candle types.
- `lib/market/instruments.ts`: parser, formatter, provider-symbol mapping, and validation.
- `lib/market/instruments.test.ts`: US/NSE/BSE identity and rejection cases.
- `lib/market/catalog.ts`: bounded starter catalog and search.
- `lib/market/calendar.ts`: US and India cash-session calculations.
- `lib/market/calendar.test.ts`: timezone, weekend, and session tests.
- `lib/market/service.ts`: normalized quote, candle, and research snapshot application service.
- `lib/providers/yahoo.ts`: encoded provider requests with timeouts and source timestamps.
- `lib/providers/index.ts`: Yahoo-first provider that does not require Finnhub.
- `lib/providers/market-contract.test.ts`: shared US/NSE/BSE provider fixture contract.

### Paper Trading And Risk

- `lib/paper/types.ts`: paper order, fill, ledger, portfolio, and fee-policy types.
- `lib/paper/fees.ts`: versioned deterministic USD/INR fee estimates.
- `lib/paper/engine.ts`: pure order validation and fill simulation.
- `lib/paper/engine.test.ts`: cash, holdings, session, limit, slippage, and currency tests.
- `lib/paper/repository.ts`: transactional paper account/order/position/ledger persistence.
- `lib/paper/service.ts`: API-facing paper orchestration and portfolio DTOs.
- `app/api/paper/orders/route.ts`: list and create paper orders.
- `app/api/paper/portfolio/route.ts`: read paper portfolio.

### AI

- `lib/ai/schema.ts`: Zod request and structured-analysis schemas.
- `lib/ai/evidence.ts`: bounded evidence package and stable SHA-256 hash.
- `lib/ai/provider.ts`: provider-neutral interface and safe error taxonomy.
- `lib/ai/providers/anthropic.ts`: official Anthropic Messages adapter.
- `lib/ai/providers/openai.ts`: official OpenAI Responses adapter.
- `lib/ai/providers/fake.ts`: deterministic test-only adapter.
- `lib/ai/service.ts`: concurrency, provider selection, validation, and run persistence.
- `lib/ai/ai.test.ts`: schema, evidence, adapter-contract, and secret-boundary tests.
- `app/api/ai/analyze/route.ts`: secured AI-analysis route.
- `app/api/ai/status/route.ts`: secret-free provider availability.

### MCP

- `mcp/server.ts`: stdio server factory and seven read-only tools.
- `mcp/server.integration.test.ts`: spawned client/server contract and tool-set audit.
- `esbuild.mcp.mjs`: bundle configuration for `dist/mcp/server.mjs`.

### UI

- `components/layout/MarketSelector.tsx`: persistent US/NSE/BSE selector.
- `components/layout/ModeBadge.tsx`: permanent PAPER or broker-missing state.
- `components/layout/TopNav.tsx`: responsive navigation including AI Desk and Paper.
- `components/layout/SetupGate.tsx`: non-blocking optional-provider setup guidance.
- `components/ai/AiResearchDesk.tsx`: complete AI request and result state machine.
- `components/paper/PaperOrderTicket.tsx`: explicit paper-order entry.
- `app/ai/page.tsx`: AI Desk page.
- `app/paper/page.tsx`: paper portfolio and order page.
- `app/dashboard/page.tsx`: market-aware dashboard query.
- `app/analyze/[ticker]/page.tsx`: canonical instrument support and AI deep link.
- `app/globals.css`: responsive terminal additions and reduced-motion behavior.

### Verification And Documentation

- `playwright.config.ts`: isolated local E2E server.
- `e2e/market-research.spec.ts`: US and India discovery and research.
- `e2e/paper.spec.ts`: separate USD and INR paper workflows.
- `e2e/ai-desk.spec.ts`: provider setup, success, failure, keyboard, and mobile flows.
- `.github/workflows/ci.yml`: type, unit, MCP, build, Playwright, and audit gates.
- `.env.example`, `README.md`, `SETUP.md`, `CONTEXT.md`, `CLAUDE.md`: accurate setup and safety boundaries.
- `docs/adr/0003-paper-first-multi-market-ai.md`: replacement architectural decision.

---

### Task 1: Dependency And Command Baseline

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `esbuild.mcp.mjs`

**Interfaces:**
- Produces: `npm run typecheck`, `npm run test:mcp`, `npm run test:e2e`, `npm run build:mcp`, and loopback-only server commands.

- [ ] **Step 1: Record but do not reverse the pre-existing lockfile diff**

Run: `git diff -- package-lock.json`

Expected: the known peer/dedupe changes remain visible for comparison after installation.

- [ ] **Step 2: Update package scripts and dependencies**

Use these scripts:

```json
{
  "dev": "next dev --hostname 127.0.0.1",
  "build": "next build && npm run build:mcp",
  "build:mcp": "node esbuild.mcp.mjs",
  "start": "next start --hostname 127.0.0.1",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:mcp": "npm run build:mcp && vitest run mcp/server.integration.test.ts",
  "test:e2e": "playwright test",
  "check": "npm run typecheck && npm run test && npm run build",
  "audit:prod": "npm audit --omit=dev --audit-level=high"
}
```

Install current compatible releases:

```powershell
npm.cmd install next@16.3.0 react@latest react-dom@latest zod@^4.4.3 @anthropic-ai/sdk@^0.115.0 openai@^7.4.0 @modelcontextprotocol/server@^2.0.0 @modelcontextprotocol/client@^2.0.0
npm.cmd install --save-dev @playwright/test@^1.60.0 esbuild@latest
```

Remove the redundant `playwright` package if `npm ls playwright` shows it only as the direct dependency replaced by `@playwright/test`.

- [ ] **Step 3: Add the MCP bundle script**

```js
import { build } from "esbuild";

await build({
  entryPoints: ["mcp/server.ts"],
  outfile: "dist/mcp/server.mjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
});
```

- [ ] **Step 4: Verify the dependency baseline**

Run: `node --version && npm.cmd run typecheck && npm.cmd audit --omit=dev`

Expected: Node is at least 22, TypeScript passes before feature edits, and audit output is recorded. Do not run `npm audit fix --force`.

- [ ] **Step 5: Checkpoint**

Run: `git diff -- package.json package-lock.json esbuild.mcp.mjs`

Expected: only intentional package, script, and preserved lockfile changes; do not commit.

### Task 2: Local Mutation Security Boundary

**Files:**
- Create: `lib/security/request.ts`
- Create: `lib/security/request.test.ts`
- Create: `lib/http/input.ts`
- Create: `lib/http/input.test.ts`
- Create: `lib/client/mutation-fetch.ts`
- Modify: every route exporting `POST`, `PATCH`, `PUT`, or `DELETE` under `app/api/`
- Modify: client components that call those routes

**Interfaces:**
- Produces: `requireMutationAccess(request): Response | null`, `readJsonObject(request, maxBytes)`, `mutationFetch(input, init)`.

- [ ] **Step 1: Write failing request-authorization tests**

Cover these exact cases:

```ts
expect(requireMutationAccess(request("http://127.0.0.1:3000/x", {
  origin: "http://127.0.0.1:3000",
  "x-marketpulse-csrf": "1",
}))).toBeNull();

expect(requireMutationAccess(request("http://127.0.0.1:3000/x", {
  origin: "https://evil.example",
  "x-marketpulse-csrf": "1",
}))?.status).toBe(403);

expect(requireMutationAccess(request("http://192.168.1.20:3000/x", {
  origin: "http://192.168.1.20:3000",
  "x-marketpulse-csrf": "1",
}))?.status).toBe(403);

expect(requireMutationAccess(agentRequest("correct-token"), {
  MARKETPULSE_AGENT_TOKEN: "correct-token",
})).toBeNull();
```

Also test missing token, token shorter than 32 characters, unequal token lengths, forwarded non-loopback host, missing origin, missing CSRF header, IPv6 loopback, and `localhost`.

- [ ] **Step 2: Implement the guard with timing-safe bearer comparison**

The guard order is fixed:

```ts
export function requireMutationAccess(
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
): Response | null {
  const url = new URL(request.url);
  if (!isLoopbackHost(url.hostname) || hasNonLoopbackForwardedHost(request)) {
    return problem(403, "NON_LOOPBACK_REQUEST");
  }

  const bearer = readBearer(request.headers.get("authorization"));
  if (bearer) {
    const expected = env.MARKETPULSE_AGENT_TOKEN?.trim() ?? "";
    if (expected.length < 32 || !safeEqual(bearer, expected)) {
      return problem(401, "INVALID_AGENT_TOKEN");
    }
    return null;
  }

  if (request.headers.get("origin") !== url.origin) {
    return problem(403, "CROSS_ORIGIN_MUTATION");
  }
  if (request.headers.get("x-marketpulse-csrf") !== "1") {
    return problem(403, "CSRF_HEADER_REQUIRED");
  }
  return null;
}
```

- [ ] **Step 3: Write and implement bounded JSON tests**

`readJsonObject` must reject invalid JSON, arrays, null, bodies over 64 KiB, invalid `content-length`, and non-JSON content type. It returns:

```ts
type JsonReadResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; response: Response };
```

Add strict helpers for finite numbers, bounded strings, enums, positive integers, and canonical symbols. No helper coerces `NaN`, infinity, empty strings, or unknown enum values.

- [ ] **Step 4: Protect every mutation route before body or database access**

At the first line of each mutation handler:

```ts
const denied = requireMutationAccess(request);
if (denied) return denied;
```

Replace direct `request.json()` calls with `readJsonObject`. Cover watchlist,
research refresh, trade, trade decisions/fill, Telegram polling, agent config,
strategies, Robinhood heartbeat/portfolio, AI analysis, and paper orders.

- [ ] **Step 5: Route browser mutations through one helper**

```ts
export function mutationFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("x-marketpulse-csrf", "1");
  return fetch(input, { ...init, headers });
}
```

Replace every client-side mutation `fetch` call with `mutationFetch`.

- [ ] **Step 6: Verify security tests and route imports**

Run: `npm.cmd test -- lib/security/request.test.ts lib/http/input.test.ts`

Expected: all trust-boundary and parser tests pass.

### Task 3: Disable Unsafe Real-Money Execution

**Files:**
- Create: `lib/trading/capabilities.ts`
- Modify: `lib/trading/engine.ts`
- Modify: `lib/trading/config.ts`
- Modify: `lib/trading/fence.ts`
- Modify: `lib/trading/fence.test.ts`
- Modify: `app/api/trade/place/route.ts`
- Modify: `app/api/trade/[id]/approve/route.ts`
- Modify: `app/api/trade/[id]/fill/route.ts`
- Modify: `app/api/agent/robinhood/heartbeat/route.ts`
- Modify: `app/api/agent/robinhood/portfolio/route.ts`
- Modify: `app/api/telegram/poll/route.ts`
- Modify: `components/settings/AutonomousTradingSettings.tsx`

**Interfaces:**
- Produces: `executionCapabilities` with `paper: true`, `confirmedLive: false`, `brokerAdapter: null`.

- [ ] **Step 1: Add failing capability and fence tests**

Assert that all legacy modes, fresh heartbeats, limit prices, old authorized rows,
and direct fill reports still produce `EXECUTION_ADAPTER_MISSING` or
`LIVE_EXECUTION_DISABLED` and never `authorized` or `filled`.

- [ ] **Step 2: Add the immutable capability declaration**

```ts
export const executionCapabilities = Object.freeze({
  paper: true,
  confirmedLive: false,
  brokerAdapter: null,
  reason: "EXECUTION_ADAPTER_MISSING" as const,
});
```

- [ ] **Step 3: Remove Autopilot from the effective mode model**

Use:

```ts
export type TradingMode = "paper" | "confirmed";

export function effectiveTradingMode(): TradingMode {
  return "paper";
}
```

Keep legacy database values readable, but never return them as an executable mode.
Configuration mutations attempting `autopilot`, `confirm`, or `real` return 410
with `LIVE_EXECUTION_DISABLED`.

- [ ] **Step 4: Make legacy execution routes terminally safe**

Return:

```ts
return Response.json(
  {
    error: "EXECUTION_ADAPTER_MISSING",
    message: "Live broker execution is not installed. Use Paper Research Mode.",
  },
  { status: 503 },
);
```

The place, approve, fill, heartbeat, portfolio-push, and Telegram-decision routes
must return before importing or calling a broker-facing service.

- [ ] **Step 5: Replace autonomous controls with a capability panel**

The settings screen shows Paper Research Mode active, Confirmed Live unavailable,
broker adapter missing, and no Autopilot control. Keep research strategy editing
separate from execution capability.

- [ ] **Step 6: Verify no executable legacy status remains**

Run:

```powershell
rg -n 'autopilot|place_equity_order|status:\s*"authorized"|Robinhood trade filled' app components lib CLAUDE.md SETUP.md CONTEXT.md
npm.cmd test -- lib/trading/fence.test.ts
```

Expected: matches exist only in historical ADR/design text or explicit disabled-legacy handling; tests pass.

### Task 4: Additive Versioned Persistence

**Files:**
- Create: `lib/db/migrate.ts`
- Create: `lib/db/migrate.test.ts`
- Create: `drizzle/0000_existing_baseline.sql`
- Create: `drizzle/0001_multi_market_paper_ai.sql`
- Create: `drizzle/meta/_journal.json`
- Modify: `lib/db/index.ts`
- Modify: `lib/db/schema.ts`

**Interfaces:**
- Produces: `openDatabase(path)`, `getDb()`, `closeDbForTests()`, additive canonical/paper/AI tables.

- [ ] **Step 1: Write fresh and legacy migration tests**

Use a temporary directory and create a representative old database containing
`paper_account` and `paper_positions`. Assert migration keeps both tables and rows,
adds all new tables, records two migration versions, and is idempotent.

- [ ] **Step 2: Write additive SQL migrations**

`0000_existing_baseline.sql` uses only `CREATE TABLE IF NOT EXISTS` and
`CREATE INDEX IF NOT EXISTS` for current tables. It contains no `DROP`, `DELETE`,
or table recreation.

`0001_multi_market_paper_ai.sql` creates:

```sql
CREATE TABLE IF NOT EXISTS instruments (
  id TEXT PRIMARY KEY,
  market TEXT NOT NULL CHECK (market IN ('US', 'IN')),
  exchange TEXT NOT NULL CHECK (exchange IN ('XNAS', 'XNYS', 'XNSE', 'XBOM')),
  symbol TEXT NOT NULL,
  provider_symbol TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('USD', 'INR')),
  timezone TEXT NOT NULL,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('EQUITY', 'ETF')),
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS paper_accounts (
  currency TEXT PRIMARY KEY CHECK (currency IN ('USD', 'INR')),
  starting_cash REAL NOT NULL CHECK (starting_cash >= 0),
  cash REAL NOT NULL CHECK (cash >= 0),
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS paper_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instrument_id TEXT NOT NULL REFERENCES instruments(id),
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  quantity REAL NOT NULL CHECK (quantity > 0),
  order_type TEXT NOT NULL CHECK (order_type IN ('MARKET', 'LIMIT')),
  limit_price REAL,
  status TEXT NOT NULL,
  quote_price REAL NOT NULL,
  fill_price REAL,
  fees REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL CHECK (currency IN ('USD', 'INR')),
  reason TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  filled_at INTEGER
);

CREATE TABLE IF NOT EXISTS paper_positions (
  instrument_id TEXT PRIMARY KEY REFERENCES instruments(id),
  quantity REAL NOT NULL CHECK (quantity >= 0),
  average_cost REAL NOT NULL CHECK (average_cost >= 0),
  realized_pnl REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS paper_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  currency TEXT NOT NULL CHECK (currency IN ('USD', 'INR')),
  instrument_id TEXT,
  order_id INTEGER,
  entry_type TEXT NOT NULL,
  cash_delta REAL NOT NULL,
  quantity_delta REAL NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instrument_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  purpose TEXT NOT NULL,
  question TEXT,
  snapshot_hash TEXT NOT NULL,
  result_json TEXT,
  status TEXT NOT NULL,
  error_code TEXT,
  provider_request_id TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  started_at INTEGER NOT NULL,
  completed_at INTEGER
);
```

- [ ] **Step 3: Make database paths injectable and back up before default migration**

Use `MARKETPULSE_DB_PATH` when present. If the default database exists and the
new migration journal does not, copy it once to `.backups/marketpulse-before-v2-<timestamp>.db`
before running additive migrations. Tests always supply a temp path.

- [ ] **Step 4: Remove destructive startup SQL**

Delete `DROP TABLE IF EXISTS paper_account` and
`DROP TABLE IF EXISTS paper_positions`. Startup calls the versioned runner only.

- [ ] **Step 5: Verify migrations**

Run: `npm.cmd test -- lib/db/migrate.test.ts`

Expected: fresh, legacy, preservation, and rerun cases pass without opening `marketpulse.db`.

### Task 5: Canonical Market Domain

**Files:**
- Create: `lib/market/types.ts`
- Create: `lib/market/instruments.ts`
- Create: `lib/market/instruments.test.ts`
- Create: `lib/market/catalog.ts`
- Create: `lib/market/calendar.ts`
- Create: `lib/market/calendar.test.ts`

**Interfaces:**
- Produces: `parseInstrument`, `formatInstrumentId`, `searchInstruments`, `getMarketSession`.

- [ ] **Step 1: Write canonical identity tests**

Required results:

```ts
expect(parseInstrument("US:XNAS:AAPL").providerSymbol).toBe("AAPL");
expect(parseInstrument("IN:XNSE:RELIANCE").providerSymbol).toBe("RELIANCE.NS");
expect(parseInstrument("IN:XBOM:500325").providerSymbol).toBe("500325.BO");
expect(parseInstrument("../../../package")).toEqualError("INVALID_INSTRUMENT");
expect(parseInstrument("RELIANCE.NS\nX")).toEqualError("INVALID_INSTRUMENT");
```

Also test currency, timezone, exchange mismatch, max length, unsupported suffix,
case normalization, ETF catalog entries, and no silent exchange guessing for an
unknown bare symbol.

- [ ] **Step 2: Implement canonical types and parser**

```ts
export type Market = "US" | "IN";
export type Exchange = "XNAS" | "XNYS" | "XNSE" | "XBOM";
export type Currency = "USD" | "INR";
export type DataQuality = "LIVE" | "DELAYED" | "STALE" | "CONFLICTED" | "UNAVAILABLE" | "AUTH_REQUIRED";

export interface Instrument {
  id: string;
  market: Market;
  exchange: Exchange;
  symbol: string;
  providerSymbol: string;
  name: string;
  currency: Currency;
  timezone: "America/New_York" | "Asia/Kolkata";
  assetType: "EQUITY" | "ETF";
}
```

- [ ] **Step 3: Add a balanced starter catalog**

Include at least 20 liquid US equities/ETFs, 20 NSE equities/ETFs, and 10 BSE
equities. Search matches canonical ID, symbol, provider symbol, and name and
returns at most 25 results.

- [ ] **Step 4: Implement session classification**

Return `CLOSED`, `PRE_OPEN`, `REGULAR`, or `EXTENDED`, plus local timestamp and
next boundary. US regular cash session is 09:30-16:00 America/New_York. India
regular cash session is 09:15-15:30 Asia/Kolkata. Weekends are closed; holiday
overrides come from a versioned array and remain clearly identified by source.

- [ ] **Step 5: Verify market tests**

Run: `npm.cmd test -- lib/market/instruments.test.ts lib/market/calendar.test.ts`

Expected: US, NSE, and BSE fixtures all pass.

### Task 6: Normalized Market Data And Research

**Files:**
- Create: `lib/market/service.ts`
- Create: `lib/providers/market-contract.test.ts`
- Modify: `lib/providers/types.ts`
- Modify: `lib/providers/yahoo.ts`
- Modify: `lib/providers/index.ts`
- Modify: `lib/data/research.ts`
- Modify: `lib/data/context-writer.ts`
- Modify: quote, candle, research, dashboard, and top-pick routes

**Interfaces:**
- Produces: `getNormalizedQuote(instrument)`, `getNormalizedCandles(instrument, request)`, `buildResearchSnapshot(instrument)`.

- [ ] **Step 1: Write provider contract fixtures**

The same contract runs for `US:XNAS:AAPL`, `IN:XNSE:RELIANCE`, and
`IN:XBOM:500325`. Assert identity, currency, exchange, positive timestamp,
finite OHLC values, `source`, `sourceEventAt`, `ingestedAt`, and `quality`.

- [ ] **Step 2: Add provenance to normalized outputs**

```ts
export interface Provenance {
  provider: "YAHOO" | "FINNHUB" | "INDIAN_API" | "TEST_FIXTURE";
  sourceEventAt: string | null;
  ingestedAt: string;
  quality: DataQuality;
  delayedBySeconds: number | null;
  sourceId: string;
}
```

Every normalized quote and candle batch includes this object. Missing data is an
explicit result, never a zero-price fabricated quote.

- [ ] **Step 3: Make Yahoo usable without Finnhub**

`getProvider()` returns Yahoo-backed quote/candle functionality when Finnhub is
absent. Finnhub enrichments return `AUTH_REQUIRED` DTOs instead of preventing the
entire app from rendering.

- [ ] **Step 4: Harden outbound requests**

Provider symbols come only from `Instrument.providerSymbol`, are URL encoded, and
all fetches use an abort signal with a 10-second timeout. Limit concurrency to
five, preserve stale cache on transient failure, and expose source changes in
provenance.

- [ ] **Step 5: Make context writes contained and atomic**

Use a SHA-256 filename derived from canonical instrument ID, verify the resolved
path starts with the resolved context directory plus path separator, write a temp
file, then rename. Add a path-containment test using traversal and control chars.

- [ ] **Step 6: Verify provider and research contracts**

Run: `npm.cmd test -- lib/providers/market-contract.test.ts lib/data/context-writer.test.ts`

Expected: deterministic fixtures pass without network access.

### Task 7: Multi-Currency Paper Engine

**Files:**
- Create: `lib/paper/types.ts`
- Create: `lib/paper/fees.ts`
- Create: `lib/paper/engine.ts`
- Create: `lib/paper/engine.test.ts`
- Create: `lib/paper/repository.ts`
- Create: `lib/paper/service.ts`
- Create: `app/api/paper/orders/route.ts`
- Create: `app/api/paper/portfolio/route.ts`

**Interfaces:**
- Produces: `evaluatePaperOrder`, `simulatePaperFill`, `placePaperOrder`, `getPaperPortfolio`.

- [ ] **Step 1: Write pure engine tests**

Cover buy, sell, insufficient USD, insufficient INR, no cross-currency funding,
sell-more-than-held, market closed, stale quote, market order slippage, limit not
crossed, limit fill, duplicate idempotency key, and deterministic fees.

- [ ] **Step 2: Define the pure engine contract**

```ts
export interface PaperOrderIntent {
  instrument: Instrument;
  side: "BUY" | "SELL";
  quantity: number;
  orderType: "MARKET" | "LIMIT";
  limitPrice?: number;
  idempotencyKey: string;
}

export type PaperDecision =
  | { status: "FILLED"; fillPrice: number; fees: number; cashDelta: number }
  | { status: "OPEN"; reason: "LIMIT_NOT_REACHED" }
  | { status: "REJECTED"; reason: string };
```

- [ ] **Step 3: Add versioned fee policies**

Implement deterministic research estimates under IDs `US_EQUITY_2026_01` and
`IN_EQUITY_DELIVERY_2026_01`. Display policy ID and `estimated` label. Keep rates
in one frozen object so policy changes create a new ID rather than rewriting old
fills.

- [ ] **Step 4: Persist fills transactionally**

Inside one SQLite transaction: insert or retrieve idempotent order, validate the
currency account and current position, insert order, update cash, upsert position,
and append cash plus quantity ledger entries. A failed step rolls back all writes.

- [ ] **Step 5: Add secured APIs**

`POST /api/paper/orders` accepts canonical instrument ID, side, quantity, order
type, optional limit, and UUID idempotency key. `GET /api/paper/orders` and
`GET /api/paper/portfolio` return minimal DTOs with native currency.

- [ ] **Step 6: Verify paper behavior**

Run: `npm.cmd test -- lib/paper/engine.test.ts lib/paper/repository.test.ts`

Expected: both currencies and all rejection paths pass against a temporary DB.

### Task 8: Provider-Neutral AI Research

**Files:**
- Create: `lib/ai/schema.ts`
- Create: `lib/ai/evidence.ts`
- Create: `lib/ai/provider.ts`
- Create: `lib/ai/providers/anthropic.ts`
- Create: `lib/ai/providers/openai.ts`
- Create: `lib/ai/providers/fake.ts`
- Create: `lib/ai/service.ts`
- Create: `lib/ai/ai.test.ts`
- Create: `app/api/ai/analyze/route.ts`
- Create: `app/api/ai/status/route.ts`

**Interfaces:**
- Produces: `ResearchAnalysisSchema`, `AiProvider`, `analyzeInstrument`, `getAiStatus`.

- [ ] **Step 1: Write schema and provider contract tests**

Require verdict, confidence, summary, bull case, bear case, risks, invalidation,
missing evidence, citations, and disclaimer. Reject unknown fields, confidence
outside 0..1, citations absent from the supplied evidence IDs, and output over
the configured limits.

- [ ] **Step 2: Define the shared provider interface**

```ts
export interface AiProvider {
  readonly id: "anthropic" | "openai" | "fake";
  readonly model: string;
  analyze(input: EvidencePackage, signal?: AbortSignal): Promise<AiProviderResult>;
}

export interface AiProviderResult {
  analysis: ResearchAnalysis;
  requestId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}
```

- [ ] **Step 3: Build stable bounded evidence**

Use at most 260 completed candles, 12 news items, 20 signals, 8 earnings records,
and 24,000 serialized characters. Assign `quote`, `technical:*`, `fundamental:*`,
and `news:*` evidence IDs. Hash canonical JSON with SHA-256.

- [ ] **Step 4: Implement official SDK adapters**

Anthropic reads `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL`; OpenAI reads
`OPENAI_API_KEY` and `OPENAI_MODEL`. Instantiate clients only on the server with
30-second timeout, one retry, and non-debug logging. Request structured JSON,
then always validate again with `ResearchAnalysisSchema`.

System instruction includes:

```text
Use only the supplied evidence. Cite evidence IDs exactly. If evidence is stale,
conflicted, missing, or insufficient, choose ABSTAIN. This is research analysis,
not financial advice, and you have no authority to create or execute an order.
```

- [ ] **Step 5: Add service limits and persistence**

Allow one concurrent request per provider, ten requests per ten minutes per local
process, and a 64 KiB route body. Store structured output and safe metadata only;
never store API keys, authorization headers, raw SDK payloads, or hidden reasoning.

- [ ] **Step 6: Add API routes**

`GET /api/ai/status` returns configured provider IDs and model display names only.
`POST /api/ai/analyze` is mutation-guarded and accepts provider, canonical
instrument ID, purpose, and a question up to 2,000 characters.

- [ ] **Step 7: Verify AI contracts without network calls**

Run: `npm.cmd test -- lib/ai/ai.test.ts`

Expected: fake Anthropic and OpenAI adapters normalize identically, failures map
to safe codes, and secret scans of persisted fixtures are empty.

### Task 9: Read-Only MCP Server

**Files:**
- Create: `mcp/server.ts`
- Create: `mcp/server.integration.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `createMarketPulseMcpServer()` and `dist/mcp/server.mjs`.

- [ ] **Step 1: Write the spawned MCP integration test**

Build the server, connect with `StdioClientTransport`, assert the exact seven-tool
set, call each tool against a temporary test database, and fail if any tool name
matches `/place|trade|order|approve|fill|cancel|config|secret|write|shell/i`.

- [ ] **Step 2: Register seven read-only tools**

Use strict Zod 4 input schemas and these annotations:

```ts
const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
```

Register search instruments, quote, research snapshot, compare instruments,
watchlist, paper portfolio, and risk summary. Return both text and structured
content, with concise as the default and 20,000 characters as the hard maximum.

- [ ] **Step 3: Connect stdio safely**

```ts
import { serveStdio } from "@modelcontextprotocol/server/stdio";

void serveStdio(createMarketPulseMcpServer);
console.error("MarketPulse MCP server running on stdio");
```

No `console.log` call may exist in `mcp/`.

- [ ] **Step 4: Verify build and protocol**

Run: `npm.cmd run test:mcp`

Expected: bundle succeeds, client lists exactly seven tools, all fixture calls
pass, stdout remains valid MCP protocol, and mutation-name audit passes.

### Task 10: Market-Aware And AI UI

**Files:**
- Create: `components/layout/MarketSelector.tsx`
- Create: `components/layout/ModeBadge.tsx`
- Create: `components/ai/AiResearchDesk.tsx`
- Create: `components/paper/PaperOrderTicket.tsx`
- Create: `app/ai/page.tsx`
- Create: `app/paper/page.tsx`
- Modify: `components/layout/TopNav.tsx`
- Modify: `components/layout/TickerTape.tsx`
- Modify: `components/layout/SetupGate.tsx`
- Modify: `app/layout.tsx`
- Modify: `app/dashboard/page.tsx`
- Modify: `app/analyze/[ticker]/page.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: market search/read APIs, paper APIs, AI status/analyze APIs.
- Produces: responsive US/NSE/BSE research, AI Desk, and paper flows.

- [ ] **Step 1: Make provider configuration non-blocking**

Remove the full-app Finnhub gate. The terminal renders with Yahoo research data;
optional Finnhub and AI providers show setup guidance in Settings and the relevant
panel. Remove HTTP secret editing and instruct the owner to set server environment
variables and restart.

- [ ] **Step 2: Add persistent market and mode controls**

The market selector has labeled buttons for US, NSE, and BSE, stores the selection
in local storage, and mirrors it in `?market=` for shareable server-rendered pages.
Mode badge always shows `PAPER`; it may show `LIVE ADAPTER MISSING` in Settings but
never an active live state.

- [ ] **Step 3: Build the AI Desk state machine**

Use accessible labels and live regions. Required visible states are idle, loading,
provider not configured, partial evidence, rate limited, timeout, invalid output,
and success. Render structured plain text only. Show provider, model, snapshot
hash prefix, source freshness, verdict, confidence, bull/bear evidence, risks,
missing evidence, invalidation conditions, and citations.

- [ ] **Step 4: Build the paper page**

Show separate USD and INR cash cards, native-currency positions, order history,
fee policy, and an explicit order ticket. Submission button says `Place paper
order`; no copy says buy, sell, execute, or confirm without the word `paper`.

- [ ] **Step 5: Add responsive and reduced-motion behavior**

Desktop AI layout uses three columns; under 900 px it becomes one column. All
controls meet a 44 px touch target. Ticker animation stops under
`prefers-reduced-motion: reduce`. Focus styles remain visible against the terminal
background.

- [ ] **Step 6: Verify static UI quality**

Run: `npm.cmd run typecheck && npm.cmd run build`

Expected: all pages and routes compile, server-only modules are absent from client
bundles, and MCP bundle completes.

### Task 11: Playwright, Accessibility, And CI

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/market-research.spec.ts`
- Create: `e2e/paper.spec.ts`
- Create: `e2e/ai-desk.spec.ts`
- Create: `.github/workflows/ci.yml`
- Modify: `package.json`

**Interfaces:**
- Produces: isolated deterministic browser suite and release CI gates.

- [ ] **Step 1: Configure an isolated E2E server**

Use `127.0.0.1:3100`, a temp DB path under `.tmp/e2e/`,
`MARKETPULSE_TEST_MODE=1`, and `MARKETPULSE_AGENT_TOKEN` set to a fixed 64-character
test-only value. Never use `.env.local`.

- [ ] **Step 2: Add market parity flows**

Using role and label selectors, verify US AAPL, NSE RELIANCE, and BSE 500325 can be
selected, show the correct currency and exchange, open research, and preserve the
market selector through navigation.

- [ ] **Step 3: Add paper workflows**

Place a US paper buy and an India paper buy, verify USD and INR ledgers change
independently, repeat the idempotency key and verify one order, and test an
insufficient-cash rejection.

- [ ] **Step 4: Add AI Desk workflows**

Verify provider-not-configured guidance, fake Anthropic success, fake OpenAI
success, stale-evidence abstention, timeout error, keyboard-only submission,
visible disclaimer, and absence of order-placement controls.

- [ ] **Step 5: Test mobile layout and core accessibility**

At 390x844, assert no horizontal overflow, navigation remains operable, labels
are associated, status updates use live regions, and focus reaches every control
in logical order. Do not use fixed sleeps.

- [ ] **Step 6: Add CI**

CI runs Node 24, `npm ci`, typecheck, Vitest, MCP integration, production build,
Playwright Chromium, `npm audit --omit=dev --audit-level=high`, `git diff --check`,
and a tracked-secret-pattern scan excluding fixtures.

- [ ] **Step 7: Verify E2E locally**

Run: `npx.cmd playwright install chromium && npm.cmd run test:e2e`

Expected: all desktop and mobile flows pass against the isolated test database.

### Task 12: Documentation And Final Product Audit

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `SETUP.md`
- Modify: `CONTEXT.md`
- Modify: `CLAUDE.md`
- Create: `docs/adr/0003-paper-first-multi-market-ai.md`

**Interfaces:**
- Produces: accurate owner setup, Claude Code/Codex MCP registration, product boundary, and broker deferral instructions.

- [ ] **Step 1: Document server-only configuration**

Add names only, never values:

```dotenv
MARKETPULSE_AGENT_TOKEN=
MARKETPULSE_DB_PATH=
FINNHUB_API_KEY=
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-5
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.5
```

State that Yahoo-derived data is research-oriented and may be delayed or
unavailable. Remove all UI-based secret-writing instructions.

- [ ] **Step 2: Replace the old agent execution guide**

`CLAUDE.md` must state:

```text
MarketPulse is decision support. Use the MarketPulse MCP tools for read-only
research and paper-portfolio inspection. No MarketPulse MCP tool or HTTP route
authorizes a real order. Do not call a broker placement tool on the basis of any
MarketPulse row, model opinion, alert, or paper fill.
```

Remove the Robinhood heartbeat, authorized-order polling, Autopilot, and fill
report workflow.

- [ ] **Step 3: Document MCP registration**

After `npm run build:mcp`, document the absolute Windows command for Claude Code
and the equivalent stdio JSON entry for Codex/OpenAI-compatible MCP clients. The
server command is `node E:/BoraTradingTool/dist/mcp/server.mjs` and inherits only
the configured database path.

- [ ] **Step 4: Record the superseding ADR**

ADR 0003 supersedes ADR 0001 and ADR 0002: paper-first, equal US/India, no
Autopilot, model advice only, read-only MCP, and broker adapter deferred.

- [ ] **Step 5: Run the complete evidence gate**

Run:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:mcp
npm.cmd run build
npm.cmd run test:e2e
npm.cmd audit --omit=dev --audit-level=high
git diff --check
git status --short
```

Expected: every command succeeds, no high-severity production vulnerability
remains, no secret or runtime database is tracked, and the existing lockfile work
is still represented in the final reviewed diff.

- [ ] **Step 6: Browser evidence audit**

Use Playwright or Chrome DevTools to inspect desktop and mobile dashboard, AI Desk,
paper portfolio, Settings, console errors, failed network requests, keyboard flow,
and accessibility tree. Record any residual issue and fix it before completion.

- [ ] **Step 7: Final boundary scan**

Run:

```powershell
rg -n 'autopilot|place_equity_order|authorized.*MCP|paper trading was removed|all trading is real money' --glob '!docs/adr/0001-autonomous-trading.md' --glob '!docs/adr/0002-remove-paper-trading.md'
rg -n 'ANTHROPIC_API_KEY=\S|OPENAI_API_KEY=\S|FINNHUB_API_KEY=\S|MARKETPULSE_AGENT_TOKEN=\S' --glob '!package-lock.json'
```

Expected: no active unsafe instructions and no populated secret assignments.

---

## Deferred Broker Adapter Gate

This plan intentionally ends with a complete research, paper, AI, MCP, and exact
confirmation-capability product but no broker adapter. A later broker plan must
select a jurisdiction-appropriate broker, review its official API and terms,
model account/quote/order states, add sandbox or replay tests, implement atomic
claim and idempotency, bind fresh per-order owner confirmation, and pass a new
security review. Until that separate gate completes, the only valid live result
is `EXECUTION_ADAPTER_MISSING`.
