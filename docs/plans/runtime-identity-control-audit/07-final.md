# Final — runtime identity gate

## Verdict: VERIFIED (for what was built), and it immediately found a P0 defect elsewhere

The scope delivered is item 1 of the six-item queue: runtime identity plus browser attestation, and
the mutation invariant that came free with it. Items 2–5 are untouched and remain open.

## Objective

Make every browser test state, and fail on, the exact server it is talking to — so that the control
audit that follows produces evidence rather than impressions.

## Files changed

| File | Change |
|---|---|
| `lib/system/identity.ts` | new — `systemIdentity()` |
| `lib/system/identity.test.ts` | new — 6 tests |
| `app/api/system/identity/route.ts` | new — `GET` |
| `next.config.ts` | pin `generateBuildId`, inline `MARKETPULSE_BUILD_ID` + app version |
| `e2e/identity.setup.ts` | new — attestation setup project |
| `playwright.config.ts` | `identity` project; both browser projects depend on it |
| `lib/client/mutation-fetch.test.ts` | + 3 tests: no component may mutate via bare `fetch` |
| `components/strategy/RunGauntletButton.tsx` | repair: duplicate import |
| `components/strategy/StrategyAuthor.tsx` | repair: duplicate import |
| `components/strategy/TradeInspector.tsx` | repair: duplicate import |
| `components/quant/QuantAnalyticsPanel.tsx` | repair: `import { reaction } from "react"` → the real import |
| `components/learning/RunCycleButton.tsx` | migrated to `mutationFetch` |
| `components/learning/AutonomyTicker.tsx` | migrated to `mutationFetch` |

## Results

- `tsc --noEmit` — clean. **It was six errors across four files when this session started**; the
  working tree did not compile.
- Unit suite — **127 files, 1563 passed, 2 skipped, 0 failed**; new file confirmed present via the
  JSON reporter rather than assumed from the summary.
- Identity endpoint on a real production server — returns
  `buildId c3a814f-dirty.9dec73f5`, pid, start, `schemaVersion 0017…`, `schemaCount 18`,
  fingerprint. No path disclosed.
- Gate proven in **four** states: correct → pass · wrong database → fail, **150 tests did not
  run** · foreign server → named diagnosis · stale server → names the pid to kill.
- Mutation invariant proven by reverting a control and watching it fail at
  `components/learning/RunCycleButton.tsx:24`.

## The defect this work found — and it is not this work's

`POST /api/research/hypotheses` takes **17–22 seconds per call and never warms up**. Measured three
consecutive times against the running server; calls 2 and 3 author nothing ("Nothing was
re-authored") and still cost 20s.

Root cause, `lib/research/hypothesis-author.ts:155`:

```ts
resolver: SyntaxAttachmentResolver = SpaCyDependencyResolver.fromEnv(),
```

A **default parameter expression re-evaluates on every call where the argument is omitted.** So each
request builds a new resolver, spawns Python and reloads `en_core_web_sm`. The worker is genuinely
persistent — it is the place it is constructed that makes persistence unreachable. The comment two
lines above even records that loading the model "costs seconds"; the injection point was designed
for tests and became production's hot path.

This is the repository's signature failure class, stated in `CLAUDE.md`: code that is individually
correct while the model of reality behind it is wrong.

**Product impact:** the primary "interpret my idea" control appears to do nothing for twenty
seconds, on every click, including clicks that change nothing. From the owner's chair that is
indistinguishable from a dead button — the exact complaint that motivated this whole task.

**Test impact:** it accounts for the e2e failures directly. `dataset-ledger:143` exceeded the 45s
timeout with the POST still in flight; `forward-evidence:71` took 55s; `golden-journey:71` took
5.2 minutes.

Also unset by default: `SYNTAX_PARSER_PYTHON`. Without it the route returns **500**, not a stated
refusal — against this product's own standard that refusals are named outcomes. Configuring it
(`C:/Users/marke/AppData/Local/Programs/Python/Python312/python.exe`, spaCy 3.8.15) cleared exactly
one failing test.

Not fixed here: it is engine-lane code, in-flight (`WORK_QUEUE` lists wiring the resolver as the
next task there), and changing where a process-spawning primitive is constructed deserves its own
gates rather than a drive-by edit at the end of a verification pass.

## E2E state, measured honestly

Against a fresh, correctly configured production server: **65 passed · 2 skipped · 9 failed**
(12.6m). The nine cluster into the semantic-compiler/syntax-parser path (timeouts and
`AMBIGUOUS_ATTACHMENT` verdicts where specs expect `EXPRESSIBLE`) and NSE search navigation.

None is attributable to this work: every change here is either a new file, a config addition, or an
import repair, and every failure is a server-side latency or compiler-verdict outcome on routes this
work does not touch.

**This claim is evidenced, not proven by bisection.** A build of `HEAD` without the working tree's
component repairs was not run, because that tree did not compile — there is no "before" build to
compare against. If stronger proof is wanted, the comparison to run is `c3a814f` clean.

## Unresolved

- Items 2–5: control inventory, root-cause fixes, `CapitalProfile` (₹1,000 vs ₹1,00,00,000, still
  honestly `DEGRADED`), cross-process singleton test.
- `mobile-chromium` has the dependency wired but was not run.
- Four `python.exe` processes were alive after testing. Whether any leaked from the resolver is
  **UNKNOWN** — this machine runs unrelated Python tooling, and I did not establish provenance.

## Rollback

Delete `lib/system/identity.*`, `app/api/system/identity/`, `e2e/identity.setup.ts`; revert the two
config edits. The component repairs should NOT be rolled back — without them nothing compiles.

## Reproducing the gate

```bash
LAUNCH=$(date -u +%Y-%m-%dT%H:%M:%SZ)
MARKETPULSE_DB_PATH=.tmp/e2e.sqlite MARKETPULSE_TEST_MODE=1 \
  SYNTAX_PARSER_PYTHON=C:/Users/marke/AppData/Local/Programs/Python/Python312/python.exe \
  npx next start --hostname 127.0.0.1 --port 3101

MARKETPULSE_E2E_BASE_URL=http://127.0.0.1:3101 \
  MARKETPULSE_E2E_DB_PATH=.tmp/e2e.sqlite \
  MARKETPULSE_E2E_EXPECT_STARTED_AFTER=$LAUNCH \
  npx playwright test --project=desktop-chromium
```
