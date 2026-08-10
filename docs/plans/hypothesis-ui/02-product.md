# Gate 1 - Product

## User problem
The owner has trading ideas in prose. Today the only doors are hand-writing DSL in the Studio
(which creates an unvalidatable orphan) or the MCP tool (not a product surface). The
hypothesis->family->strategy machinery exists and cannot be reached by its owner.

## Desired outcome
Type an idea in plain words. Get back, in one round trip, one of:
- a draft strategy in its own research family, with the broker-provenance warnings; or
- a refusal that names exactly why not (not a trading rule / needs data we lack / unclear).

## Success evidence
1. The gap+RVOL prose authors a strategy whose family IS the hypothesis, visible in the registry.
2. The gauntlet-blind-spot prose returns NOT_A_TRADING_RULE with the reason, creates no strategy.
3. The disagreement prose returns NEEDS_FEATURE naming the missing quantity.
4. Re-submitting the same idea does not duplicate anything (idempotent by content).
5. All of it through the running page, on a fresh database, desktop and mobile.

## Non-goals
No LLM call; the lexicon triage is the reader. No editing/deleting hypotheses. No new tables.
