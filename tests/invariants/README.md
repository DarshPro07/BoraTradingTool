# The System Invariant Suite

A deliberately small set of claims that must **never** be false, each exercised through the real
production composition rather than against mocked collaborators.

## Why this exists separately

On 2026-08-17 three P0-class defects were found in a single session, and they were the same
architectural failure:

```
recordBarIngestion       inside the try  → a failed fetch was recorded nowhere
evaluateTrialActivation  imported only by a display page → the registered gate governed nothing
!researchReady           in the planner  → freshness was never reconsidered
```

Every component was individually correct. Every component passed its own tests. The **wire between
them was never run**, and unit tests could not see it because the gap was *between* units.

The remedy is not more unit tests. It is a handful of tests phrased as system claims, run against
the real call path, and reported separately — so that

```
UNIT                2035 passed
SYSTEM INVARIANTS     12 passed
```

can never collapse into a single green number that lets the first stand in for the second.

## The rules for this directory

1. **Phrase each test as something the system claims can never happen**, not as "function X returns
   Y". The name should read as a guarantee.
2. **Drive the real production entry point.** If a test mocks the collaborator whose composition is
   the point, it belongs in the unit suite instead.
3. **Stay small.** Ten to twenty tests total. This suite earns its authority by being short enough
   that a failure is read rather than skimmed.
4. **Each test names the incident that motivated it.** An invariant with no history behind it is a
   guess about what matters.

## Running it

```bash
npm run test:invariants
```

`npm run check` runs it as a separate line after the unit suite.
