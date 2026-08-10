# ADR 0008: Deterministic Scanner Before Multi-Agent Orchestration

## Status

Accepted on 2026-08-10.

## Context

MarketPulse needs an autonomous NSE scanner, observable orchestration, and a daily decision brief. The repository already has a serialized learning cycle, research queue, governance policy, strategy validation, forward evidence, and paper ledgers. It does not have full-universe scan evidence, a deterministic candidate score, or enough independent model work to justify a permanent agent organization.

## Decision

Build one deterministic scanner manager as a leg of the existing learning cycle.

- The first slice is read-only except for append-only scanner evidence.
- Every security ends in one named funnel state.
- Missing inputs remain unavailable; they are never scored as zero.
- Risk and feasibility are hard gates, not weighted score bonuses.
- Research confidence never changes numerical market strength.
- Validation, forward, and paper state are read-only in the first slice.
- A high score cannot spend a trial, access a holdout, activate a challenger, or create an order.
- The existing learning cycle acts as the temporary Chief of Staff.
- A generic agent framework and permanent specialist agents are deferred.

## Consequences

The first honest production result may be `EVIDENCE_WAIT` with most NSE securities excluded for missing history. This is a successful truthful outcome. Dynamic workers, AgentBudgetPolicy, and a generic AgentRun graph are added only after real research workload and cost evidence exist.

## Rejected Alternatives

- 133 permanent agents: high cost and coordination complexity without measured need.
- Peer-to-peer handoffs: unclear ownership and weaker auditability.
- LLM-generated candidate scores: non-reproducible and unsafe for ranking market evidence.
- Reusing `/api/top-picks`: it is a separate US/Yahoo in-memory scanner with no NSE evidence ledger.
