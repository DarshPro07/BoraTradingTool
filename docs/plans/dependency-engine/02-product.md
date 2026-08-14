# Gate 1 — Product

## User problem

The owner starts AUTO and walks away. When work cannot proceed, the machine must either resolve
the prerequisite itself, know exactly what will wake it, or state a truthful permanent/external
blocker — never print the same warning forever, never retry a doomed action forever, and never
call a healthy waiting state DEGRADED (or a real impairment healthy).

## Desired outcomes (from the owner's 2026-08-13 feedback, verbatim priorities)

1. Generalize the resolver: `ingest_history` becomes the first case of a generic
   prerequisite/wake model — not bespoke code repeated per blocker.
2. Forecasts: `new bars → mature predictions → resolve → wake validation`, no owner action.
3. Warm-up/waiting: an eligibility clock (`resumeAt`), not blind re-polling.
4. Terminal failure: `retryable outage → RETRY_AFTER · permanent → BLOCKED_PERMANENT ·
   auth → WAITING_EXTERNAL` — a dead dependency must not doom its dependents silently, and a
   doomed job must not be re-enqueued every tick.
5. Health: typed reason codes with category+severity, so wording changes cannot change health
   semantics, and non-throwing impairments (structured "unavailable", empty-but-200) can degrade.

## Success evidence

- The self-resolution loop test passes: empty store → blocked → remediation auto-created →
  worker runs → bars persisted → re-check reports SATISFIED — no owner action anywhere.
- A permanently-failed remediation yields BLOCKED_PERMANENT on re-resolve with no new job; a
  retryable one yields COOLING_DOWN then revives after the cooldown.
- A report whose only notes are waiting states keeps the run RUNNING; a report carrying a
  configured-but-unreachable quant core degrades it (proven to fail against the old rule).
- A matured forecast resolves on bar arrival without a learning cycle running.

## Failure conditions

- Forcing activity: warm-up or "no eligible candidates" treated as something to eliminate.
- Softening refusals: NO_STORED_DATA research floor, unfit-for-validation declarations.
- A revival policy that turns BLOCKED_PERMANENT back into an infinite retry loop.

## Non-goals (explicitly deferred, next rungs in the chain)

Agents/Teams as workers · multi-model routing · DataRequirement timeframe/session dimensions
(no intraday consumer of the resolver yet) · event-driven wake beyond the existing 5s research
lane · per-strategy feature-warm-up bar arithmetic.
