# Slice 1 — the Quant Scoreboard (architecture & program design, combined for a read-model slice)

## Fit

A READ MODEL over ledgers Gate 0 verified, plus ONE /brain panel. No new tables, no writers
touched, no subsystem — the freeze-compatible shape (the owner sketched this surface
explicitly). Everything the panel says must be recomputable from the tables it names.

## Module

`lib/dashboard/quant-scoreboard.ts` — `quantScoreboard(deps?)` returning:

- `question` — the program's scoreboard question, verbatim.
- `campaigns {total, open}`, `families`, `trialsSpent` (selection_trials rows — the DSR
  denominator, stated as such).
- `funnel[]` — the owner's 12 stages, each `{key, label, count, basis}` where `basis` is the
  honest counting source ("securities in the NSE master", "standings at validated or beyond",
  …). Ladder rungs (rehearsal→owner_review) count from `standings()` — the evidence-derived
  stage authority — never from a stored status.
- `gauntletRejections[]` — `trials` GROUP BY `kind` WHERE verdict='fail', sorted desc; plus
  `graveyardCount` (from `listGraveyard`).
- `survivors[]` — specs whose latest validation passed: name, deflatedSharpe, pbo,
  oosProfitFactor, costMultiplePf.
- `holdout {generations, evaluations, passed}` from holdout_definitions/results.
- `forward {challengers, signals, resolved}` from the WS1 tables.
- `paper {closedPositions, grossPnl, fees, netPnl, netExpectancyPerTrade, costShareOfGross}` —
  from paper_position_outcomes' persisted grossPnl/fees/netPnl; expectancy and cost-share are
  null (not 0) when no positions exist.

`deps.standings` is injectable (the `costVerdictOrBlocked` precedent) so unit tests pin the
rung arithmetic without seeding a full authored strategy; the real wiring is covered live.

## Surface

`/brain` gains the top panel `QUANT SCOREBOARD — THE PRIMARY QUESTION`
(`data-testid="brain-quant-scoreboard"`): the funnel with counts and bases, the typed
rejection table (honest empty state: zeros, not absence), the paper NET line, survivors with
their DSR/PBO. Server component, direct lib call — the existing /brain pattern.

## Failure/empty honesty

A fresh database renders ZEROS with bases stated, never fabricated placeholders; expectancy
and cost-share render "—" (null), not 0. An error in one source must not silently zero the
panel (no try/catch-to-zero).

## Tests

- Unit (`quant-scoreboard.test.ts`): empty DB → zeros/nulls/order; seeded (through the real
  writers/tables) → rejection grouping by kind, survivor row with DSR/PBO, paper math
  (expectancy = netPnl/positions; costShare = fees/gross), funnel rung counts from injected
  standings.
- e2e (`quant-scoreboard.spec.ts`, desktop-only per mission policy): /brain renders the panel
  on a fresh DB with honest zeros, funnel rows present, no console errors — the spec watches
  console/pageerror/requestfailed like its siblings.

## Rollback

Revert the commit: one module, one test file, one spec, one panel block in page.tsx.
