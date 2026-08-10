# Final — hypothesis to strategy

**Verdict: PARTIALLY_VERIFIED**

## Objective

Close the last break in the research chain: `papers → sources → claims → hypotheses → ✗ → specs`.

## What Gate 0 changed about the objective

The task looked like "build a converter". Reading the three hypotheses the system has actually
formed showed that **two of them must not become strategies at all** — one is a claim about the
validation machinery, one needs a quantity no engine here derives.

So the product is a **triage that refuses**, not a converter. A converter would have been wrong
twice, plausibly, and silently — which is this repository's entire failure history in one sentence.

## Implementation

`lib/research/hypothesis-triage.ts` — pure, no database, no network, no model call. A stated
lexicon maps phrases to DSL features; it can only emit names already in `POINT_IN_TIME_FEATURES`,
so hallucinating a feature is structurally impossible rather than merely unlikely.

Checks run in a deliberate order: *is this about a trade at all* → *does it need data we lack* →
*only then read thresholds*. Reversing the first two would produce a strategy from a statement
about test coverage, and would keep the readable fragment of an idea whose essence was dropped.

## Results

- typecheck clean; **1,256 unit tests across 97 files**, 0 failed
- all three real hypotheses classified correctly against the live database
- the one expressible hypothesis yields `rvol gte 1, gap_pct gte 3` — thresholds read from its own
  words — and `compileStrategy` accepts the result

## Failures encountered

Two defects, both caught because the fixtures are the real hypotheses rather than invented ones:

1. **Meta markers matched against the rationale.** A rationale explains why *this system* should
   care, so it matched almost anything. The model-disagreement hypothesis was refused for the wrong
   reason, hiding a legitimate "we lack this data" finding. Fixed by scanning title and statement
   only.
2. **The lookahead window crossed a sentence boundary**, pairing `rvol` with a `4` from the next
   sentence — the exact fabrication the module exists to prevent. Fixed by clipping at `". "`.

## Unresolved limitations

- **Slice 4, the authoring driver, is not built.** Nothing imports this module yet, so the chain
  does not yet run end-to-end in the application.
- **No UI, so no Playwright journey.** Stated rather than glossed.
- **The lexicon reads phrasing, not meaning.** A hypothesis expressing a mapped idea in unmapped
  words is refused as UNCLEAR. Deliberate: a false refusal costs an untested hypothesis, a false
  conversion costs a permanent trial and a strategy nobody proposed.
- **`or` becomes `and`.** Only conjunctions are produced. Conservative, but a real loss of meaning
  that is not detected.
- **Three hypotheses is the entire population.** Robustness beyond them is unmeasured.

## Rollback

One module, one test file, nothing importing them. Deleting both restores the prior state exactly.

## Readiness

The half that had to be right is right and is proven against live data. The authoring half is
deliberately deferred so it can be built on a proven classifier rather than blind.
