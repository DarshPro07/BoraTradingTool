# Gates 1-3 — Product, architecture, program design (merged: the item is composition)

## Product
One panel at the top of /strategies: **STRATEGY FACTORY** with two entrances (owner directive):
- **A. BUILD MY IDEA** (default): a five-step rail — 1 IDEA → 2 INTERPRETATION → 3 BACKTEST →
  4 VALIDATE → 5 FORWARD & PAPER — where each step unlocks from the previous step's real
  outcome, refusals are terminal-but-stated rail states, and irreversible steps keep their
  existing two-click confirmations.
- **B. FIND A STRATEGY FOR ME**: the autonomous-discovery view — what the cycle triaged, bred,
  rehearsed and buried (from /api/cycles + /api/research/hypotheses), with RunCycleButton to
  trigger one now and honest framing ("most candidates die; that is the point").

Success: a person who cannot code walks A end to end (or reads why their idea was held), and B
makes the autonomy visible. Failure: any step that silently dead-ends, or a backtest empty state
that reads as "never trades" instead of "no stored bars".

## Architecture
Pure composition, zero engine change, zero new API:
- `HypothesisComposer` gains optional `onOutcome(result)` (non-breaking; testids untouched).
- New `components/factory/GuidedStrategyFlow.tsx` (client): owns entrance tabs + step rail;
  embeds HypothesisComposer (step 1-2), calls POST /api/strategy/trades (step 3), renders
  RunGauntletButton inside `factory-validate` (step 4), links /paper with the REPLAY pitch
  (step 5). DISCOVER tab fetches GET /api/cycles?limit=5 + GET /api/research/hypotheses.
- `app/strategies/page.tsx`: flow panel replaces the composer's slot; StrategyAuthor stays as
  "DSL power path"; every other panel untouched.

## Test design
`e2e/strategy-factory.spec.ts` (desktop): entrance A default with composer visible (protects the
professor path's precondition); submit an expressible idea; rail advances; backtest click waits
on the real /api/strategy/trades response and asserts EITHER trades OR the stated refusal
(fresh-DB honest branch); validate step shows the scoped gauntlet button; DISCOVER tab shows
run-cycle + counts including the just-created candidate; zero pageerrors. Real-test rule: the
`factory-flow` testid does not exist before this change — structurally failing spec.

## Least confident
- Two RunGauntletButton instances (flow + registry row) — scoped queries only.
- router.refresh() inside the embedded composer refreshes server components; flow state is
  client-side and survives it (React state persists across RSC refresh).

## Rollback
Revert page wiring + delete the two new files + drop the optional prop. No data change.
