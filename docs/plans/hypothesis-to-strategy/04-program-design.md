# Gate 3 — Program design

## Files

| File | Why |
|---|---|
| `lib/research/hypothesis-triage.ts` | pure classifier + threshold extractor. No database, no network, no model call. |
| `lib/research/hypothesis-triage.test.ts` | the three real hypotheses as fixtures, plus abstention cases |

## Contracts

```
hypothesisTriage({title, statement, rationale?})
  → { verdict, reason, conditions[], missingQuantities[] }

verdict ∈ EXPRESSIBLE | NEEDS_FEATURE | NOT_A_TRADING_RULE | UNCLEAR
condition = { feature, op, value, evidence }   // evidence = the exact words it was read from

entryConditionFrom(conditions) → Condition      // DSL-shaped, compiler-checkable
```

`reason` is always populated, in every branch. A refusal with no reason is indistinguishable from a
crash and teaches the reader nothing.

## Order of checks — this *is* the design

1. **Is it about a trade at all?** before anything else. A meta-hypothesis will happily contain a
   threshold, and reaching the extractor first would produce a strategy from a statement about
   test coverage.
2. **Does it need a quantity we cannot derive?** before extraction. Otherwise the extractable
   fragment is kept and the part carrying the whole idea is dropped silently.
3. **Only then** read features and thresholds.

## Error model

Nothing throws. Every path returns a verdict with a reason, because this runs inside an autonomous
loop and an exception there becomes a skipped hypothesis nobody sees.

## Test design, with the failure mode each guards

| Test | Failure it detects |
|---|---|
| gauntlet blind-spot → NOT_A_TRADING_RULE | inventing a trading rule from a statement about the system |
| model disagreement → NEEDS_FEATURE, named | dropping the part of an idea that carries it |
| gap/RVOL → gap_pct gte 3, rvol gte 1 | defaulting thresholds instead of reading them |
| evidence substring check | a reader unable to verify the reading |
| compiles | emitting a spec the compiler rejects |
| "gaps deserve attention" → UNCLEAR | fabricating a threshold from prose that states none |
| unrelated-clause number | pairing a feature with a number from another sentence |
| meta-with-threshold → NOT_A_TRADING_RULE | check order silently reversed |
| lexicon ⊆ vocabulary | the table emitting a feature the compiler does not know |

## Least-confident decisions

1. **The meta-marker list is phrase matching.** A meta-hypothesis phrased differently is not caught,
   and would fall through to UNCLEAR — a safe direction, but not a guaranteed one.
2. **The 40-character window, clipped at a sentence boundary.** Tuned against three real
   hypotheses; long prose with a parenthetical could still mis-pair.
3. **Only `all` conjunctions are produced.** A hypothesis meaning "or" gets "and". Conservative —
   fewer signals, never more — but it is a real loss of meaning and is not detected.

## Rollback

One module and one test file. Nothing imports it yet; deleting both restores the prior state exactly.
