# Hypothesis to strategy — status

**Feature slug:** `hypothesis-to-strategy`
**Opened & paused:** 2026-08-09
**Verdict:** PARTIALLY_VERIFIED — see `07-final.md`

## Gate progress

| Gate | Document | State |
|---|---|---|
| 0 · Reality | `01-reality.md` | complete — **inverted the objective** |
| 1 · Product | `02-product.md` | complete |
| 2 · Architecture | `03-architecture.md` | complete |
| 3 · Program design | `04-program-design.md` | complete |
| 4 · Vertical slices | `05-slices.md` | 1–3 complete; 4 deferred |
| 5 · Verification | `06-verification.md` | complete |
| — · Final | `07-final.md` | PARTIALLY_VERIFIED |

## The finding

Two of the three hypotheses this system has formed **must not become strategies**. One is about the
gauntlet; one needs a quantity no engine here derives. The product is therefore a triage that
refuses, and the refusal rate is its primary quality signal — a converter that converts everything
has learned nothing about which ideas this deployment can test.

## Exact next action

**Slice 4 — the authoring driver.** For an `EXPRESSIBLE` hypothesis:

1. declare a `strategy_family` whose `economicHypothesis` is the hypothesis `statement`
   (a hypothesis *is* a research family — one economic claim with variants);
2. author the spec with `recordStrategySpec({ hypothesisId })` — the first non-null `hypothesisId`
   the registry will have held;
3. `placeStrategy(..., confirmed: true)`, since the placement follows mechanically from the
   hypothesis rather than needing a judgement;
4. cost-gate it with `costStanding` and refuse rather than author below the owner's real cost;
5. record every refusal as an audit event, as the backfill does.

Then wire it into `runLearningCycle` at `learning` and above, and re-run the browser suite.

## Open question worth the owner's input, not blocking

The lexicon covers the phrasing of three hypotheses. As the research loop forms more, the honest
choices are: grow the table (auditable, tedious, and drifts toward bad NLP), enable the optional
API-key path in `lib/ai/` for the prose→DSL step (converts everything, which is the failure mode
Gate 1 identified), or queue UNCLEAR hypotheses for an agent over MCP (reintroduces an agent in a
loop the owner wants autonomous). Deferred until there are enough hypotheses to tell which limit
actually binds.
