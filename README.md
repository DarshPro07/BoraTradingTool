# MarketPulse OS

A local-first equity research terminal for US, NSE, and BSE instruments. It combines normalized market evidence, deterministic paper trading, a governed research and learning ledger, a read-only quant-core bridge, and optional structured AI analysis.

## Safety Boundary

- Broker execution is not installed.
- Legacy live-order endpoints return `EXECUTION_ADAPTER_MISSING`.
- There is no Autopilot or remote order-approval path.
- The MCP server exposes research reads and local knowledge writes only.
- The owner places any real order manually, outside this software.

## Quick Start

Requirements: Node.js 20.9 or newer.

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Open `http://127.0.0.1:3000`. The app binds to loopback by default.

For a deterministic credential-free demo, set `MARKETPULSE_TEST_MODE=1`. Fixture data is always labeled and is never presented as live market data.

## Capabilities

- US, NSE, and BSE market views with canonical instrument identifiers and native currencies
- Market session awareness, quote provenance, and explicit unavailable/stale states
- Instrument research, scanner, strategy lab, experiment ledger, and data-quality views
- Separate USD and INR paper accounts with deterministic fills and estimated fee policies
- Evidence-linked analyst, research library, memory graph, curriculum, jobs, and audit views
- Optional Anthropic or OpenAI API analysis for unattended model runs
- Claude Code control plane through a classified local stdio MCP server
- Quant-core bridge with HTTP-first and filesystem fallback semantics

## Configuration

Yahoo-derived research data is the default shared source. Finnhub can optionally enrich supported data. AI keys are optional. Never expose keys through client-side variables.

See [`.env.example`](./.env.example) for the supported variables and [`SETUP.md`](./SETUP.md) for operational details.

## Claude Code and MCP

Build the local MCP server, then start Claude Code in this repository:

```powershell
npm run build:mcp
claude
```

The project `.mcp.json` registers `dist/mcp/server.mjs`. Claude Code can read bounded evidence and record local analyses, claims, hypotheses, lessons, failures, and research jobs. Directional analyses must resolve citations against the exact stored evidence package. The protected MCP manifest permits only `READ` and `WRITE_LOCAL` capabilities; it cannot place, approve, cancel, or fill an order.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start the loopback development server |
| `npm run typecheck` | Compile TypeScript without emitting files |
| `npm test` | Run unit and integration tests |
| `npm run test:mcp` | Build and test the spawned MCP server |
| `npm run test:e2e` | Run Playwright browser tests |
| `npm run build` | Build the app and MCP bundle |
| `npm run check` | Run typecheck, tests, and production build |
| `npm run audit:prod` | Audit production dependencies at high severity |

## Main Screens

`/command`, `/dashboard`, `/scanner`, `/analyst`, `/ai`, `/analyze/[instrument]`, `/edge-factory`, `/strategies`, `/experiments`, `/library`, `/memory`, `/paper`, `/portfolio`, `/learning`, `/jobs`, `/data-quality`, `/audit`, and `/settings`.

## Architecture

| Layer | Choice |
|---|---|
| Web | Next.js 16.3, React 19, TypeScript |
| UI | Tailwind CSS 4, shadcn/ui, Lightweight Charts |
| Storage | SQLite, Drizzle ORM, additive migrations |
| Market data | Yahoo research source, optional Finnhub enrichment |
| AI | Official Anthropic and OpenAI server SDKs |
| Agent interface | MCP over local stdio |
| Quant bridge | Versioned JSON contract to `E:/Trading_BOT` |

## Disclaimer

MarketPulse is decision-support software, not financial advice. Market data may be delayed or unavailable, simulations omit real-world effects, and model output can be wrong. Validate evidence independently. Real orders remain the owner's manual responsibility outside this application.
