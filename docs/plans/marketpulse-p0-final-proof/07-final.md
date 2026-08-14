# P0 Final Proof — session 2 (2026-08-13, later)

Continuation of the same mission. `00-status.md` and `06-verification.md` cover session 1
(items 1-5). This records what session 2 added, under the expanded spec (§32/§55/§65/§66/§82).

## Landed and proven

### §66 — build script portability — **FIXED**

`"build": "next build && npm run build:mcp"` exited **1** on this machine: npm is not on PATH in
the shell npm itself spawns. This was a PROJECT bug, not an environment quirk — `test:full`
already worked around the identical problem by calling `node esbuild.mcp.mjs` directly.

Changed `build` to do the same. **`npm run build` now exits 0**, so the documented command works
and `npm run check` (which ends in `build`) is no longer permanently broken here.

### §7.9 / §82 — test-truth guard — **BUILT AND PROVEN TO FIRE**

`scripts/verify-test-run.mts` reads vitest's JSON report and refuses to call a run green unless it
can account for it. Wired as `npm run test:verified`.

Fails on: 0 tests collected · file count below a floor · any failure · a report whose `success`
flag disagrees with its own counts · counts that do not reconcile · a missing or unparseable
report.

Proven against a crafted zero-test report claiming `"success": true` — the exact artifact that
fooled the tooling in session 1:

```
FAIL:
  - 0 tests were collected. A suite that runs nothing cannot pass — this is the
    `--reporter=basic` / `no test files found` false green.
```

Proven on a real run: `135 files / 597 suites / 1644 collected / 1642 passed / 0 failed / 2 skipped`.

One self-correction: the first version printed `files 597`, which is vitest's
`numTotalTestSuites` — describe BLOCKS, not files. Mislabelling that is the same species of
imprecision the script exists to catch, so it now reports both, from `testResults.length`.

### §32 / §65 — in-product historical ingestion — **BUILT, UNLOCK PROVEN THROUGH THE UI**

The highest-value item, because one gap blocked two separate acceptance requirements.

`researchInstrument` correctly refuses below 60 stored bars with `NO_STORED_DATA`. That refusal is
not softened. The defect was that it was a **dead end**: the only route to history was two CLI
steps run outside the application, so a fresh database could never become researchable through the
product. That blocked *both* 30-stock research breadth (§55 Stage 2) *and* the UI-first Golden
Journey (§56), whose research→strategy handoff only enables on a verified run.

Built:
- `lib/market/ingest.ts` — resolve → master check → readiness → fetch → revalidate OHLC at the
  boundary → `persistCandles` → `recordDatasetImport` → report real readiness. Idempotent.
- `app/api/market/ingest/route.ts` — POST behind `requireMutationAccess`, GET for side-effect-free
  readiness. Refusals are 200 + code, never transport errors.
- `ResearchThisStock` — the `NO_STORED_DATA` refusal now carries an ingest control and renders the
  outcome verbatim.
- `MIN_BARS_FOR_RESEARCH` exported from `bridge.ts` so ingestion, readiness and the UI share ONE
  definition of "enough history" instead of a second copy that can drift.

Measured, through the real UI with no API shortcut and no SQL candle injection:

```
before: FAILED :: NO_STORED_DATA — 0 daily bars for IN:XNSE:RELIANCE; 60 required
ingest: INGESTED — 260 daily bar(s) from TEST_FIXTURE; store now holds 260.
        Declared unfit for validation — unadjusted prices, currently-listed symbols only.
after:  PROPOSAL READY :: (no refusal)
```

**The honest declaration is preserved.** Ingested bars carry `adjustment: "raw"` and
`includesDelisted: false`, so the dataset stays UNFIT_FOR_VALIDATION. The declaration, not the
bars, is the point of the import — ingesting through the product must not launder a
survivorship-biased sample into something promotable. The e2e asserts the phrase is on screen.

**A real defect found while building it.** `resolveInstrument` parses SYNTAX and falls back to the
parsed id when the master has no match (`findNseInstrument(id) ?? parsed`), so a well-formed but
never-listed symbol like `IN:XNSE:NOT-A-REAL-ZZZ` resolves happily. Ingesting it would have
written candle rows for a phantom instrument, and canonical identity is supposed to come from the
exchange's master (§34). Ingestion now refuses it, and readiness reports a `known` flag so a caller
can tell "no bars yet" from "no such security".

Unit coverage: `lib/market/ingest.test.ts`, 5 tests — unlock, unfit-declaration, idempotency,
unknown-instrument refusal, readiness on an unresolvable id.

## Audit of the three previously-unaudited suites (§6.10, §58-60)

### `crash-recovery.spec.ts` — **REAL, but PARTIAL**

Genuinely good: real `taskkill /PID /T /F`, its own port 3299, its own temp DB and dist dir, real
respawn against the same database, asserts the SAME run id resumes as DEGRADED and that the
`autonomous_run_recover` audit row exists with `interrupted_jobs=`.

Findings:
1. **Line 116-121 is a false-green vector.** If port 3299 is occupied the test SKIPS. A survivor
   from an earlier run makes it skip silently and permanently. Per §7.1 a required test that
   silently skips is a hole.
2. Heartbeat staleness is compressed by a direct DB `UPDATE` (documented, and waiting 5 minutes is
   impractical) — legitimate, but it means the natural staleness path is not exercised.
3. §58 asks for crash during research / model call / backtest / paper / self-repair. Only the
   general run case is covered.
4. No duplicate-effect assertion. It proves the same run resumed, not that no job ran twice.

### `paper-lifecycle.spec.ts` — **API/ENGINE ONLY, mislabelled by its name**

Measured: **0 UI actions**, 6 API calls, 1 direct DB write. It is an engine test wearing a
lifecycle name. Per §59 the honest classification is `PAPER_ENGINE_API = covered`,
`PAPER_UI_WORKFLOW = NOT COVERED`. The suite itself already states cancel and partial-fill routes
do not exist.

### `golden-journey-full-lifecycle.spec.ts` — **FIXTURE-VERIFIED INTEGRATION, not UI-first**

Measured: 9 UI actions, 11 API calls, 3 direct DB writes. Its own header is honest — it lists
which rungs are `POST /api/...` and which are pages, and never claims UI-first. It explicitly
asserts the fixture banner reads `NOT INTEGRATION VERIFIED`.

Against §56 (UI-first, no API bypass of required handoffs) it does not qualify: rungs 3, 5, 6 and 8
are API POSTs where a user-facing control should drive. **The root cause was the same missing
ingestion** — the research→strategy handoff enables only on `SOURCE_VERIFIED`, unreachable without
bars. That blocker is now removed, so a UI-first journey is buildable; it is not yet built.

## Verdict

**PARTIALLY_VERIFIED.**

Closed with runtime evidence: items 1, 2, 3, 5 (session 1) plus §66, §7.9/§82, and §32/§65.

Open: §56 UI-first Golden Journey (now unblocked, not yet built) · §55 Stage 2 30-stock breadth
with data (now unblocked, not yet run) · paper UI lifecycle · crash-recovery skip-guard and scope ·
Brain ↔ quant-core wiring · two consecutive clean full runs (§86).
