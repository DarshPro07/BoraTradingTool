# MarketPulse Multi-Market Upgrade Design

Status: Approved for implementation
Date: 2026-08-05
Target repository: `E:\BoraTradingTool`

## Summary

MarketPulse will evolve from a US-focused research application with an unsafe
cooperative real-money workflow into one market-aware Next.js application with
equal US and India support.

The product has two modes:

1. Paper Research Mode provides the complete research and simulated-trading
   product without any broker capability.
2. Confirmed Live Mode includes the same product and can submit a real order only
   after the owner approves that exact order immediately before placement.

Broker adapters are deliberately last. Until one is installed, Confirmed Live
Mode can prepare and approve an order ticket but must stop at
`EXECUTION_ADAPTER_MISSING`. It never invents a fill.

## Current Baseline

The existing application provides a useful foundation:

- Next.js 16 App Router and React 19 UI;
- SQLite with Drizzle ORM;
- Yahoo quote, candle, screener, sector, and target integrations;
- optional Finnhub fundamentals, analyst, earnings, insider, and news data;
- technical indicators and rule-based signals;
- stock, dashboard, watchlist, news, portfolio, settings, and trade screens;
- a pure Trade Fence with 19 passing unit tests; and
- Claude Code context files and operating instructions.

The baseline also has release-blocking risks:

- mutation and real-money control APIs have no authentication;
- `next dev` and `next start` bind to `0.0.0.0` by default;
- HTTP callers can assert broker heartbeat and portfolio state;
- pending approvals do not rerun the fence;
- authorized orders are omitted from the daily cap;
- authorized orders have no claim, expiry, or idempotency contract;
- user limit prices are treated as live sizing prices;
- Telegram approvals do not verify sender or chat;
- HTTP input can inject new lines into `.env.local`;
- ticker-derived paths are not constrained to the context directory;
- startup SQL is acting as an unversioned migration system and drops tables;
- the only test file covers the pure fence, not the order lifecycle or APIs;
- documentation disagrees about framework version, default mode, and paper
  behavior; and
- the dependency audit reports high-severity vulnerabilities, including the
  installed Next.js version.

The pre-existing `package-lock.json` modification must be preserved and reviewed
separately. Existing `.env.local`, SQLite files, context files, and secrets must
not be read, overwritten, or committed during the upgrade.

## Goals

- Deliver equal product capability for US and Indian equities.
- Keep one TypeScript and Next.js codebase.
- Make market, exchange, currency, timezone, and calendar explicit domain data.
- Provide complete research, risk, backtesting, paper execution, and paper
  portfolio workflows before adding a broker.
- Require fresh per-order owner approval for every future real broker mutation.
- Make duplicate, stale, changed, or unverified live orders non-executable.
- Preserve source provenance and distinguish live, delayed, stale, conflicted,
  and unavailable market data.
- Replace destructive startup migration logic with versioned migrations.
- Establish broad automated tests and CI gates.
- Upgrade vulnerable dependencies without broad, unreviewed rewrites.

## Non-Goals

- No approval-free Autopilot mode.
- No broker adapter in the initial upgrade increment.
- No options, futures, crypto, forex, leverage, short selling, or margin in V1.
- No multi-tenant hosting or public internet deployment.
- No claim that Yahoo, yfinance, or the community Indian API is
  exchange-authoritative or suitable as a final execution quote.
- No automatic currency conversion or FX trading.
- No Python sidecar in this architecture.
- No migration of secrets into source control.

## Product Modes

### Paper Research Mode

Paper Research Mode is the default and includes:

- US and India market dashboards;
- symbol search and instrument detail;
- quotes, candles, fundamentals, technicals, news, and signals;
- watchlists, alerts, research notes, and strategy evaluation;
- historical backtests and forward paper validation;
- paper orders, fills, positions, cash, risk, and performance analytics; and
- generated order tickets for manual review.

The mode has no broker capability. Its application service does not import or
receive a live broker adapter. An HTTP request, database mutation, agent prompt,
or UI action cannot turn a paper order into a real order.

### Confirmed Live Mode

Confirmed Live Mode includes everything in Paper Research Mode. It additionally
allows a live order ticket to enter a confirmation workflow.

Every broker mutation requires a separate confirmation. There is no blanket,
daily, session, or persistent approval. Confirmation binds:

- owner identity and local session;
- account and broker adapter;
- canonical instrument;
- side and quantity;
- order type, limit, and time in force;
- fresh quote identity and timestamp;
- expected native-currency notional and fees;
- portfolio snapshot version;
- risk-check result;
- a random single-use nonce; and
- a short expiration.

A pending ticket may remain visible, but confirmation requotes and reruns all
checks. The resulting approval expires after 60 seconds by default and can never
exceed five minutes. Placement reruns halt, mode, account, quote, position, cash,
daily-cap, and expiry checks.

Until a broker adapter exists, a confirmed ticket transitions to
`EXECUTION_ADAPTER_MISSING` and remains auditable but non-executable.

## Market Model

### Canonical Instrument Identity

Provider tickers are not primary keys. Each instrument has a stable identity:

```text
InstrumentId
  market: US | IN
  exchange: XNAS | XNYS | XNSE | XBOM
  symbol: exchange-native symbol
  providerSymbol: source-specific symbol, such as AAPL or RELIANCE.NS
  currency: USD | INR
  timezone: America/New_York | Asia/Kolkata
  assetType: EQUITY | ETF
```

Examples:

- `US:XNAS:AAPL`
- `IN:XNSE:RELIANCE`
- `IN:XBOM:500325`

All watchlists, quotes, candles, research records, orders, positions, and alerts
reference the canonical instrument identity. Display symbols remain user-friendly.

### Equal Market Parity

A user-facing feature is not complete until it supports both markets or clearly
records why the concept does not apply. Release tests cover US and India fixtures
for every shared provider contract, calculation, order rule, and UI workflow.

### Calendars And Sessions

A market calendar service owns:

- exchange timezone;
- holidays and special sessions;
- regular, pre-open, and extended-session labels;
- completed-candle rules; and
- session-aware paper fills.

US extended-hours data may be displayed but is not automatically eligible for a
paper or future live order. India V1 uses NSE and BSE cash-market sessions. The
calendar source and version are recorded with validation artifacts.

### Currency And Portfolio Accounting

USD and INR use separate cash ledgers. No order can consume another currency's
cash. Cross-market portfolio views show native values and may show a clearly
labeled reference conversion using a timestamped FX rate. Reference conversion
never creates cash or enables an order.

## Application Architecture

The application remains a modular Next.js monolith:

```text
app and components
  -> application services
  -> market, research, risk, paper, and order domains
  -> provider and broker ports
  -> versioned repositories and SQLite
```

### Domain Modules

- `market`: instruments, exchanges, calendars, currencies, sessions, quotes,
  candles, corporate actions, and data quality.
- `research`: technicals, fundamentals, news, signals, hypotheses, backtests,
  and reports.
- `portfolio`: cash ledgers, positions, valuation, exposure, realized and
  unrealized results.
- `paper`: order simulation, fees, slippage, fills, partial fills, and ledger.
- `risk`: position limits, daily limits, concentration, liquidity, stale data,
  and order eligibility.
- `orders`: draft tickets, confirmation, live-order state machine, claims,
  idempotency, audit, and future broker handoff.
- `security`: local session, capability token, same-origin enforcement, CSRF,
  owner confirmation, and secret boundaries.

Route handlers validate input and call application services. They do not contain
financial calculations or mutate tables directly.

### Provider Ports

Provider interfaces return normalized records plus provenance:

```text
provider
source event time
ingestion time
exchange
currency
quality status
raw source identifier or hash
```

Primary source strategy:

- Direct Yahoo endpoints provide shared US, NSE (`.NS`), and BSE (`.BO`) quote
  and candle coverage.
- Finnhub remains optional US enrichment where the configured plan supports the
  requested field.
- `0xramm/Indian-Stock-Market-API` is an optional, health-checked fallback only.
  Its GitHub repository contains documentation but no server source, its listed
  endpoint uses plain HTTP and was unreachable during design review, and it wraps
  Yahoo Finance.
- yfinance and Yahoo-derived data are research-oriented and subject to Yahoo's
  terms and personal-use restrictions. They are not final broker evidence.
- A future broker adapter must verify an executable quote immediately before a
  live order is placed.

The system never silently replaces a failed source with fabricated zeros. A
source switch is recorded in the returned provenance.

## Data Quality And Failure States

Every market datum has one status:

- `LIVE`: current enough for the configured research or paper policy.
- `DELAYED`: valid but explicitly delayed.
- `STALE`: older than the policy threshold.
- `CONFLICTED`: authoritative sources disagree beyond tolerance.
- `UNAVAILABLE`: no valid observation exists.
- `AUTH_REQUIRED`: the configured provider cannot supply the field without
  additional authorization.

Research screens may display delayed or stale data with clear age and provider
labels. Paper fills require an eligible quote under the paper policy. Future live
confirmation requires a fresh broker-verifiable quote. Provider errors degrade
the affected panel and do not erase the last known observation.

Requests use bounded concurrency, timeouts, retries with jitter, circuit breakers,
and provider-specific rate limits. Failure logs never include credentials, full
account numbers, Telegram tokens, or broker payload secrets.

## Research And Signal Boundary

Rule-based indicators and signals are research evidence, not automatic orders.
Every signal records:

- canonical instrument;
- strategy and parameter version;
- source snapshot identifiers;
- calculation time;
- market session;
- input quality;
- bull, bear, and abstain evidence; and
- whether the result was used only for research, paper evaluation, or an order
  ticket.

The system supports abstention. Missing fundamentals, short candle history,
conflicted sources, or stale prices produce `INSUFFICIENT_EVIDENCE` rather than a
neutral zero that can accidentally become a trade recommendation.

Backtests use completed candles, chronological splits, explicit fees and
slippage, and immutable run records. Paper-forward evidence remains separate from
historical results.

## Paper Execution

The paper engine is deterministic for a given market-event stream and policy.
It models:

- market and limit orders;
- exchange sessions and holidays;
- configurable commissions, taxes, levies, spread, and slippage by market;
- insufficient cash and holdings;
- rejected, canceled, expired, partial, and filled orders;
- separate USD and INR cash;
- corporate-action adjustments; and
- an append-only double-entry-style cash and position ledger.

Paper order states are separate from live order states. A paper fill cannot be
reported through a live endpoint or reused as live confirmation evidence.

## Confirmed Order State Machine

Initial state machine:

```text
DRAFT
  -> PROPOSED
  -> PENDING_CONFIRMATION
  -> CONFIRMED
  -> EXECUTION_ADAPTER_MISSING
```

Future broker-enabled extension:

```text
CONFIRMED
  -> CLAIMED
  -> PLACING
  -> PARTIALLY_FILLED | FILLED | REJECTED | CANCELED | EXPIRED | UNKNOWN
```

Rules:

- confirmation and placement both rerun the current fence;
- `halt` wins over every state;
- confirmation is single-use and expires;
- only one worker can atomically claim an order;
- a client-supplied idempotency key prevents duplicate proposals;
- a broker client-order ID prevents duplicate placement;
- authorization states count toward daily and exposure limits;
- changed account, price, fees, quantity, or portfolio invalidates approval;
- unknown broker outcome never becomes `FILLED`; and
- fill records originate from broker evidence, not an arbitrary HTTP price.

## Security Boundary

The first implementation increment closes the current exposure before adding
features:

- bind `dev` and `start` explicitly to `127.0.0.1`;
- reject non-loopback host and forwarded-host requests;
- require a local capability token for agent mutation APIs;
- require same-origin plus CSRF protection for browser mutations;
- apply strict request schemas and bounded body sizes;
- validate canonical instruments and reject path separators and control
  characters;
- write context artifacts by canonical hashed filename and verify the resolved
  path remains inside the context directory;
- remove HTTP-based arbitrary `.env.local` editing;
- keep secrets in process environment or an OS-backed secret store;
- verify Telegram chat, sender, callback nonce, and pending order state;
- mask account identifiers in responses and logs; and
- disable broker placement when no adapter is installed and show the explicit
  missing-adapter state; the confirmation workflow may still be tested safely.

The current Claude operating guide is changed before future use: it may never
interpret an `authorized` database row as sufficient placement authority. Only a
fresh, exact confirmation claim returned by the secured application service can
permit a future broker call.

## Persistence And Migration

Drizzle schema definitions remain the typed source. Versioned SQL migrations are
stored under `drizzle/` and applied through a migration journal.

Migration rules:

- back up the existing database before the first schema migration;
- never drop a table during normal application startup;
- make each migration transactional where SQLite permits;
- preserve the current runtime database and Telegram settings;
- add canonical market identity without silently reclassifying symbols;
- record schema version and migration outcome; and
- test upgrade from a representative current database and fresh install.

Context JSON files are derived outputs. SQLite records are authoritative. Context
writes are atomic and use a temporary file plus rename.

## UI Changes

Shared navigation adds a persistent market selector and mode indicator.

Equal US and India experiences include:

- market dashboard, indices, sectors, movers, and status;
- market-aware search with exchange badges;
- instrument analysis with native currency and source freshness;
- watchlists and alerts;
- research and strategy reports;
- paper order ticket and portfolio;
- performance and risk dashboard; and
- confirmed live ticket review, disabled with an explicit broker-missing state
  until a broker is installed.

The confirmation screen shows the exact instrument, account, quote age, quantity,
notional, fees, resulting exposure, risk checks, expiration, and differences from
the original draft. It has no bulk-approve action.

## Dependency Upgrade

Dependency work is controlled rather than delegated to `npm audit fix --force`:

- update Next.js from vulnerable 16.2.9 to a patched supported release;
- update compatible React, React DOM, Base UI, Tailwind, Vitest, Playwright, and
  patch/minor dependencies;
- keep TypeScript on a supported 5.x release until a separate TypeScript 7
  migration is justified;
- evaluate major `better-sqlite3` and type-package updates separately;
- move build-only packages such as `drizzle-kit`, `shadcn`, and type packages to
  development dependencies where runtime behavior permits;
- remove extraneous packages and regenerate the lockfile deterministically; and
- require zero known high-severity production vulnerabilities before release.

The README and operator docs must name the installed Next.js version and the two
approved product modes accurately.

## Testing Strategy

### Unit Tests

- canonical US, NSE, and BSE instrument parsing;
- calendars, sessions, timezones, and completed candles;
- USD and INR cash separation;
- market-specific fees, slippage, and paper fills;
- technical and signal calculations with insufficient-data cases;
- risk fence checks and abstention;
- order-state transition table;
- approval expiry, nonce, and exact-payload binding; and
- context-path containment.

### Provider Contract Tests

The same contract suite runs against US and India provider fixtures:

- normalized identity, exchange, currency, and timestamps;
- quote and candle invariants;
- provenance and quality status;
- timeout, rate-limit, empty, malformed, and conflicting responses; and
- fallback source recording.

Network-dependent tests are separated from deterministic fixture tests.

### Integration Tests

- versioned migrations from current and empty databases;
- authenticated mutation APIs;
- host, origin, CSRF, body-size, and schema enforcement;
- Paper Research Mode has no broker capability;
- pending confirmation reruns current quote, portfolio, and fence;
- halt and mode changes invalidate executable orders;
- authorized states count toward caps;
- one atomic worker claim under concurrency;
- repeated idempotency keys create one order; and
- unknown or missing broker evidence cannot create a fill.

### End-To-End Tests

- US and India search-to-research flows;
- US and India paper order and portfolio flows;
- stale and failed provider experiences;
- mode switching and visible capability boundaries;
- confirmed ticket review with missing broker adapter; and
- no mutation from an untrusted origin.

### CI Gates

- formatting and lint;
- TypeScript;
- Vitest unit and integration suites;
- production build;
- Playwright smoke flows;
- migration verification;
- dependency audit; and
- secret and generated-artifact checks.

## Delivery Sequence

1. Preserve dirty work, record dependency state, and back up the runtime database.
2. Bind to loopback and secure all mutation APIs.
3. Disable the existing unsafe real-order authorization workflow and update the
   Claude operating guide.
4. Upgrade dependencies and align documentation with Next.js 16 and the new modes.
5. Introduce canonical instruments, markets, calendars, currencies, provenance,
   and versioned migrations.
6. Refactor current Yahoo and Finnhub access behind normalized provider ports.
7. Add equal US and India provider contracts, dashboards, search, and analysis.
8. Build the multi-currency paper ledger, execution simulator, portfolio, and
   performance views.
9. Add research run records, backtest discipline, risk, alerts, and abstention.
10. Add the exact-order confirmation state machine and secured UI while keeping
    execution at `EXECUTION_ADAPTER_MISSING`.
11. Complete integration, concurrency, end-to-end, migration, and security tests.
12. Review release evidence for equal US and India parity.
13. Design and implement broker adapters as a separate, later specification.

## Implementation Planning Boundary

This is the master architecture. Work is split into independently verifiable
increments:

1. safety baseline and vulnerable dependency remediation;
2. canonical market domain and versioned persistence;
3. equal US and India provider and research workflows;
4. paper execution, portfolio, risk, and performance;
5. confirmed-order workflow with broker placement disabled; and
6. future broker adapters under separate specifications.

Each increment receives its own executable plan, tests, and migration review.
The owner authorized continuous implementation on 2026-08-05, so passing gates
advance automatically without an additional approval stop. Broker enablement
remains a separate decision because it changes the real-money trust boundary.

## Acceptance Criteria

- One Next.js application supports US and India with equal feature parity.
- Paper Research Mode is the default and cannot access a broker.
- Confirmed Live Mode requires fresh explicit approval for every exact order.
- No approval-free Autopilot path exists.
- Without a broker adapter, confirmed orders stop at
  `EXECUTION_ADAPTER_MISSING`.
- All mutation APIs are loopback-bound, authenticated, same-origin protected,
  validated, and bounded.
- Canonical instrument identity prevents US, NSE, and BSE symbol collisions.
- Quotes and candles expose source, age, exchange, currency, and quality.
- USD and INR accounting are separate and deterministic.
- Paper execution models sessions, fees, slippage, partial fills, and failures.
- Live confirmation is exact, expiring, single-use, idempotent, and revalidated.
- Daily and exposure caps include pending, confirmed, claimed, and placing states.
- Telegram decisions verify the configured owner and order nonce.
- Context output cannot escape its directory.
- Database startup performs no destructive schema changes.
- Current database migration and fresh installation both pass.
- US and India provider contract suites pass.
- Unit, integration, concurrency, end-to-end, build, migration, and audit gates
  pass.
- No known high-severity production dependency vulnerability remains.
- Documentation accurately describes data limitations, modes, and broker status.

## Deferred Broker Decision

The first broker adapter is intentionally not selected in this design. Broker
selection occurs only after the complete research, paper, risk, confirmation,
security, and audit system passes acceptance. Each broker requires a separate
threat model, capability map, account model, order-state mapping, sandbox or
replay plan, contract tests, and owner approval.
