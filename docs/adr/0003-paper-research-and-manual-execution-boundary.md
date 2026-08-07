# ADR 0003: Paper Research and Manual Execution Boundary

Status: Accepted

Date: 2026-08-06

Supersedes: ADR 0001 and ADR 0002

## Context

Earlier revisions described a Robinhood MCP path with Confirm and Autopilot modes. The wider system now includes a governed learning loop and an India-first quant core whose authoritative product boundary prohibits automated order execution. Retaining an agent-to-broker mutation path would create unbounded operational and compliance risk.

## Decision

MarketPulse is decision-support software.

- Paper Research Mode is the only in-application order lifecycle.
- Live-order, approval, broker-heartbeat, portfolio-push, Telegram-decision, and fill-report routes fail closed with `EXECUTION_ADAPTER_MISSING`.
- The local MCP server exposes research reads and local knowledge writes only.
- Claude Code may analyze and record evidence but may not place or authorize orders.
- The owner performs any real-world execution manually outside this software.
- `lib/trading/capabilities.ts` is an owner-protected file and keeps `confirmedLive` false with no broker adapter.

## Consequences

The application can be developed, tested, and operated without brokerage credentials. Paper fills remain simulations and are labeled accordingly. A future live capability requires a separate architecture, legal and compliance review, threat model, owner decision, and new ADR; it cannot be enabled by changing a UI setting.
