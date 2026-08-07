# MarketPulse AI And MCP Extension Design

Status: Approved by direct implementation instruction
Date: 2026-08-05
Target repository: `E:\BoraTradingTool`
Parent design: `2026-08-05-multi-market-upgrade-design.md`

## Purpose

MarketPulse will add model-assisted research and a local MCP interface without
giving a model, CLI agent, or MCP client authority to place a real order. The AI
layer explains evidence, challenges a thesis, and produces a structured research
opinion. Deterministic application services remain responsible for data quality,
risk, accounting, paper fills, and order-state transitions.

This extension applies equally to US and Indian instruments. A provider that
cannot reason from the normalized evidence for either market is not considered
complete.

## Approaches Considered

### Official API adapters plus a read-only MCP server

The application calls Anthropic or OpenAI through their official server-side
TypeScript SDKs. A provider-neutral interface returns the same structured
analysis schema. A separate stdio MCP server exposes concise read-only market,
research, watchlist, paper-portfolio, and risk tools.

This is the selected approach. It supports the in-app UI, Claude Code, Codex,
and other MCP clients while preserving one deterministic domain core.

### Claude Code or Codex CLI as the only model runtime

The app could continue writing context files and require a user to run an
external CLI. This avoids API keys in the app but cannot provide a reliable
in-app experience, typed outputs, provider status, request limits, or repeatable
tests. It remains an optional workflow through MCP, not the primary integration.

### An autonomous model tool loop inside Next.js

The app could let a model choose and call market and trading tools recursively.
This offers flexibility but creates unnecessary prompt-injection, cost, latency,
and order-authority risk. It is rejected for V1. Model input is assembled by the
application from a bounded evidence snapshot; no model-selected mutation tools
are exposed.

## Trust Boundary

The AI output is advisory evidence, never executable authority.

- Model adapters receive normalized, size-bounded research snapshots.
- Snapshots contain provenance and quality labels, not credentials.
- Model output must pass a runtime schema before storage or display.
- Invalid, refused, timed-out, or partial output becomes an explicit failure.
- The model may return `BUY`, `HOLD`, `SELL`, or `ABSTAIN`; `ABSTAIN` is valid.
- A model recommendation cannot create a paper order automatically.
- A model recommendation cannot create, confirm, claim, fill, or cancel a live
  order.
- Prompt text and model output are treated as untrusted data in the UI and logs.
- API keys stay in server environment variables and are never returned to the
  browser or exposed through MCP.

The MCP server is read-only in its first release. It intentionally has no trade,
approval, broker, heartbeat, fill, configuration, secret, file-write, or shell
tool. Tool annotations document this but are not the security boundary; the
server implementation itself imports only read services.

## AI Provider Contract

The shared contract accepts:

```text
ResearchAnalysisRequest
  instrument
  quote and candle evidence
  technical and fundamental evidence
  news evidence
  source provenance and quality
  user question or thesis
  requested provider
```

It returns:

```text
ResearchAnalysis
  provider and model
  generatedAt
  verdict: BUY | HOLD | SELL | ABSTAIN
  confidence: 0..1
  summary
  bullCase[]
  bearCase[]
  risks[]
  invalidationConditions[]
  missingEvidence[]
  citations[] -> evidence identifiers from the supplied snapshot only
  disclaimer
```

Provider implementations:

- Anthropic uses the official `@anthropic-ai/sdk` Messages API with a JSON Schema
  output format where the configured model supports it.
- OpenAI uses the official `openai` Responses API with structured output.
- Model IDs come from `ANTHROPIC_MODEL` and `OPENAI_MODEL`; defaults are
  documented but replaceable without code changes.
- API clients use a 30-second timeout, at most one retry, bounded output tokens,
  and disabled debug-body logging.
- The route applies per-process local rate limiting and one concurrent analysis
  per provider by default.
- No provider is required for the deterministic product. If neither is
  configured, the AI workspace remains visible with setup guidance.

Provider-neutral tests use fakes. Network tests are opt-in and never run in CI
without explicit test credentials.

## Evidence Assembly

The application builds the evidence package before calling a model:

1. Parse a canonical instrument such as `US:XNAS:AAPL` or
   `IN:XNSE:RELIANCE`.
2. Load normalized quote, completed candles, available fundamentals, technical
   indicators, and recent news.
3. Attach provider, source event time, ingestion time, currency, market,
   exchange, and quality status to every relevant item.
4. Exclude stale or conflicted evidence from calculations that require live data
   while retaining it for clearly labeled context.
5. Truncate articles and arrays to fixed limits.
6. Assign stable evidence IDs used by model citations.
7. Calculate a SHA-256 snapshot hash and store it with the AI result.

The model cannot browse independently in V1. This prevents unbounded source
collection and ensures every citation maps to evidence the application can show.
Future web-search connectors require a separate provenance and prompt-injection
review.

## MCP Server

The TypeScript stdio server is built from the official MCP SDK and Zod 4 schemas.
It exposes these initial tools:

- `marketpulse_search_instruments`: search the supported US/NSE/BSE catalog.
- `marketpulse_get_quote`: get one normalized quote with provenance and quality.
- `marketpulse_get_research_snapshot`: get bounded research evidence.
- `marketpulse_compare_instruments`: compare two to five normalized snapshots.
- `marketpulse_get_watchlist`: list canonical watchlist entries.
- `marketpulse_get_paper_portfolio`: show USD and INR ledgers and positions.
- `marketpulse_get_risk_summary`: show deterministic paper risk metrics.

Every result supports concise and detailed formats and has an output character
limit. Errors tell the client how to correct a symbol, reduce the request, or
configure missing data. Stdio protocol messages use stdout; diagnostics use
stderr only.

The MCP process reads the same database path and domain services as Next.js. It
does not call Next.js HTTP mutation routes. A test client launches the built
server, lists tools, calls each tool with US and India fixtures, and verifies no
mutating tools exist.

## User Interface

The existing dark terminal language is preserved rather than replaced.

The top navigation gains:

- a market switcher for `US`, `NSE`, and `BSE`;
- a persistent `PAPER` mode badge;
- an AI provider-status indicator; and
- an `AI Desk` destination.

The AI Desk uses a three-column desktop composition and a single-column mobile
flow:

- instrument and provider controls;
- evidence ledger with age, source, quality, and market labels;
- structured model opinion with verdict, confidence, bull case, bear case,
  risks, missing evidence, invalidation conditions, and citations.

The page has explicit idle, loading, partial-data, provider-not-configured,
rate-limited, timeout, invalid-output, and success states. It never renders raw
model HTML. A visible banner states that AI output is research opinion and cannot
place an order.

Instrument pages gain an `Analyze with AI` action that opens the AI Desk with the
canonical instrument selected. Paper-order creation remains a separate explicit
user action after reviewing deterministic risk checks.

## Persistence

AI runs are auditable records containing:

- canonical instrument ID;
- provider and model;
- request purpose and sanitized user question;
- evidence snapshot hash;
- normalized structured output;
- start and completion times;
- status and safe error category;
- provider request ID when available; and
- estimated input and output token counts when supplied by the SDK.

Raw API keys, authorization headers, full provider payloads, and chain-of-thought
are never stored. The application stores only the structured answer needed by
the product.

## Testing

Unit tests cover schemas, evidence truncation, citation validation, hash
stability, provider configuration, and refusal/error mapping.

Contract tests run the same fixtures against Anthropic and OpenAI fake adapters
and require equivalent normalized output.

Integration tests verify:

- same-origin and CSRF protection on the AI mutation route;
- missing provider credentials return setup state without leaking environment;
- malformed model output is rejected;
- one market cannot be mislabeled as another;
- AI output cannot create an order; and
- stored runs omit secrets and raw reasoning.

Playwright covers US and India AI Desk flows with intercepted deterministic model
responses, provider-not-configured state, mobile layout, keyboard operation, and
visible capability boundaries.

MCP tests spawn the stdio server, call all seven tools, validate bounded output,
and assert the listed tool set contains no mutation or execution capability.

## Acceptance Criteria

- Anthropic and OpenAI are interchangeable behind one structured contract.
- The deterministic app works when no model provider is configured.
- AI analysis supports US, NSE, and BSE instruments equally.
- Every conclusion is tied to a stored evidence snapshot and visible citations.
- Model output cannot mutate an order or broker state.
- The MCP server is local, stdio-based, read-only, bounded, and testable from
  Claude Code, Codex, and other MCP clients.
- The AI Desk is responsive, accessible, and covers all failure states.
- Secrets remain server-only and absent from logs, browser data, MCP output, and
  persisted AI records.
- Unit, contract, integration, MCP, Playwright, build, and dependency-audit gates
  pass before the extension is considered complete.
