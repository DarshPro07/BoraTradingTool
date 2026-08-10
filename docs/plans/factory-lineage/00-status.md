# Factory lineage — status

**Feature slug:** `factory-lineage`
**Opened & completed:** 2026-08-09
**Verdict:** VERIFIED

## What this was meant to be, and what Gate 0 found instead

The plan was "autonomous research intake — the professor", on the strength of
`docs/OWNER_BRIEF_AND_PLAN_2026-08-08.md` §3.2: *"`enqueue()` is called from exactly three places…
the system drains a queue that only a human fills."*

**That is stale.** `lib/research/producer.ts` calls `enqueue`, `runLearningCycle` calls
`produceResearchJobs`, and the pipeline is demonstrably working:

```
research_jobs      81   (all succeeded, last 2026-08-09 06:05)
knowledge_sources  91
knowledge_claims   18
research_hypotheses 3
```

Autonomous intake exists. Building it again would have produced a duplicate of a working system —
the exact outcome Gate 0 is for.

## The real break, one step further along

```
papers → sources → claims → hypotheses → ✗ → strategy specs
                              (3)              (0 derived)
```

Three hypotheses have been formed autonomously. **None has ever become a strategy.** And
`lib/factory/generation.ts` wrote `hypothesisId: null, parentId: null` for every bred survivor —
discarding lineage the breeder had already computed.

That hardcoded null is *why* the research-identity defect was invisible: the factory manufactured
orphans by construction, so no strategy ever had a family, so the multiple-testing denominator was
always 1.

It also became urgent the moment identity was made mandatory: a bred candidate with no family
cannot be validated, so the factory would have bred strategies that were unusable by construction.

## Delivered

| Change | Where |
|---|---|
| `Candidate` carries `parentSpecId` and `lineage` | `lib/factory/screen.ts` |
| Breeder records which parent a mutation/crossover descends from | `lib/factory/breed.ts` |
| `BreedInput.parents` carries `specId` | `lib/factory/breed.ts`, `generation.ts` |
| Survivors placed in the parent's family, confirmed | `lib/factory/generation.ts` |
| Orphans left unplaced — rehearsable, not validatable | `lib/factory/generation.ts` |
| 4 lineage tests | `lib/factory/lineage.test.ts` |

**1,246 unit tests, 96 files, 0 failed. Typecheck clean.**

## Decisions taken automatically, with reasons

**Crossover records the first parent.** When two lineages meet the rule is inherit-rather-than-
invent: a new family resets contamination history, and "when in doubt, same family" costs only a
little statistical power. Conservative in the direction that cannot silently destroy validity.

**Inherited placement is `confirmed: true`.** Inheritance is a mechanical consequence of parentage,
not a judgement. The judgement was made when the parent's family was declared by a human.

**A `gen` candidate stays an orphan.** A freshly generated entry descends from nothing; claiming a
parent would attach it to a statistical history that has nothing to do with it. It can be
rehearsed — that costs nothing — and cannot be validated until a human states its hypothesis.

## Exact next action

**Hypothesis → strategy spec.** The chain's remaining break. Three hypotheses sit at `proposed`
with no path to a testable specification, and `propose_strategy_spec` is permitted by policy at
`learning` but implemented by nothing.

Note before building: converting a paper's claim into a DSL specification is a *reasoning* step.
This application deliberately does not call Claude (`CLAUDE.md`: "the app does not call Claude —
**you** call the app"), so the options are a deterministic template mapping from structured
hypothesis fields, the optional API-key path in `lib/ai/`, or a queued job an agent picks up
through MCP. That choice is architectural and belongs in that feature's Gate 2, not this one.
