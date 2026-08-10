# Gate 5 — Independent reality verification

## Static and unit

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx vitest run` | **97 files, 1,256 passed, 2 skipped, 0 failed** |
| triage suite | 10 passed |

## Against the owner's real database, read-only

```
Untriggered-signal blind spot in our own gauntlet
  → NOT_A_TRADING_RULE
    matched: our validation, our own gauntlet, false-negative mode, coverage of

Gap-and-RVOL screen transferred to NSE liquid mid-caps
  → EXPRESSIBLE   rvol gte 1, gap_pct gte 3
    compiles: true (features: gap_pct, rvol)

Model disagreement as a risk filter
  → NEEDS_FEATURE  model disagreement between analyses
```

Two of three refused, one expressed and compiling — matching the Gate 0 analysis exactly.

## Independent challenge — attempts to disprove it

| Attack | Result |
|---|---|
| meta-hypothesis containing a real threshold | still refused as meta; check order holds |
| feature named with no threshold | UNCLEAR, no condition invented |
| number in an adjacent sentence | not paired after the boundary fix |
| "relative volume" shadowed by "volume" | longest phrase wins, maps to `rvol` |
| can the table emit an unknown feature? | structurally impossible — asserted against `POINT_IN_TIME_FEATURES` |

## Not verified

- **No UI, so no Playwright journey.** The module is not yet wired to a screen or a route; the
  browser suite was not re-run because nothing it covers changed. Marked rather than claimed.
- **Slice 4 (authoring driver) not built**, so the end-to-end hypothesis→draft-spec path does not
  yet run in the application.
- **Robustness beyond three hypotheses is unmeasured.** Three is the entire population today.

## Verdict

**PARTIALLY_VERIFIED.** The classifier is correct on every real case and on five adversarial ones,
proven against live data. The authoring driver that would make the chain end-to-end is deliberately
not built.
