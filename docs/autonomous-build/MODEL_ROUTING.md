# Model routing (current truth; §37 registry is QUEUED, this file is the interim record)

## What exists today
- Deterministic engines own ALL math: backtests, fees, risk gate, analytics (Lo-adjusted Sharpe
  beside naive), simulations (seeded), statarb. No LLM computes a market number anywhere.
- lib/ai/ providers (Anthropic claude-sonnet-5, OpenAI gpt-5.5, Fake for tests): advisory
  research analyses only, schema-forced output, citations validated against server-issued
  evidence snapshots, rate-limited, evidence persisted per run (aiRuns).
- Claude Code via MCP (marketpulse_* tools): analyst records with epistemic guardrails; write
  surface is local-database-only.
- Kronos forecasts: file-contract from the quant runner; reader stamps not_forward_validated;
  scoring vs persistence baseline; checkpoint context windows enforced at request time
  (manifest clamps lookback).
- ResearchProposalEnvelope (P4A): typed + tested; no live producer yet (fixture only).

## Inventory
docs/plans/model-routing/01-current-model-inventory.md (per WS3; router NOT built — by mission
order, no router before the inventory is owner-visible, and P0 outranks WS3).

## Rules in force (v7 §37/§38)
- LLM output is never market truth; UI carries provenance for every model-derived result.
- Production gateway (AI Job Service) is queued behind P0/P1; no consumer-subscription tokens
  in the app, ever (Anthropic terms; recorded in memory and CLAUDE.md).
