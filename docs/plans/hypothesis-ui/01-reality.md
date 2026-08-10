# Gate 0 - Reality

- **STATICALLY_CONFIRMED.** `recordHypothesis` (`lib/knowledge/repository.ts:145`, protected,
  read-only for agents) is idempotent: id = hash of title:statement, insert onConflictDoNothing.
  Callable from a route; not editable.
- **REPRODUCED (golden journey finding).** No UI or HTTP surface calls it - only `mcp/server.ts`.
  The autonomous loop forms hypotheses from papers, but the OWNER cannot contribute an idea.
- **STATICALLY_CONFIRMED.** `hypothesisTriage` (pure) and `authorFromHypotheses` (idempotent,
  refuses inexpressible ideas, declares a family per hypothesis, places the spec confirmed) are
  tested and live in the cycle.
- **STATICALLY_CONFIRMED.** `app/api/research/*` is NOT in the protected path list (jobs route
  edited previously). A new `app/api/research/hypotheses` route is permitted.
- **OBSERVED.** /strategies hosts StrategyAuthor with testids; the payoff of a hypothesis is a
  strategy, so the composer belongs beside it.
