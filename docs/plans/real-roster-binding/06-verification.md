# Gate 5 — Independent Reality Verification (Real Roster + Execution Binding, A6)

## Verdict

**VERIFIED (PASS), high confidence, 0 blockers** — independent `verifier` subagent (fresh context,
no authorship stake). It read all files in full, diffed claimed-untouched files against HEAD, traced
the binding chain link-by-link, ran everything itself.

## Independent evidence (verifier-run)

| Check | Result |
|---|---|
| Targeted suites (roster+team+single+router) | 4 files, **37 passed** |
| Single-agent slice isolated | 7/7 (file zero-diff vs HEAD) |
| `tsc --noEmit` | exit 0 |
| `routing.ts` / `agents/runtime.ts` diff vs HEAD | **empty — untouched** |
| `gateway.ts` diff shape | exactly the 2 claimed hunks (`model?` field + `--model` use) |
| Full suite (fresh) | **152 files / 1789 passed / 2 skipped, 0 failures** |
| Vendor-literal grep in roster.ts | none |
| Anti-fake-completion grep (6 files) | clean |

## Per-claim findings

1. **No fabrication** — entries verbatim from discovered CatalogModels; capabilities from the
   registry descriptor's declared support; `contextWindow 0` = unreported; sentinel clearly labeled.
2. **Production default is real detection** — verifier confirmed the actual production call site
   (`worker.ts:85`) passes no deps, so `deps.roster === undefined` genuinely triggers
   `buildDetectedRoster(await detectProviders())` in production, asserted by the full-path test
   (sentinel + PROVIDER_DEFAULT + `model: null` to the gateway).
3. **Binding chain load-bearing** — traced assignment → assignmentByRole → runMember → concreteModel
   filter → runAgent → mock echo → recorded AgentRun; severing any link fails the `[A6.2]`
   assertions (author's executed mutation + verifier's static trace agree).
4. **Sentinel can never leak into `--model`** — exactly one call site converts an assignment to the
   gateway `model` field, and it filters `isProviderDefaultModel` to null there.
5/6. **Single path + route() untouched** — zero-diff, suites green.

## Residual notes — disposition

- **MODEL_SELECTED event emitted the static alias even for bound runs** (pre-existing line; made
  relevant by this leg). **CLOSED post-verification:** the event now reports
  `request.model ?? CLAUDE_MODEL_ALIAS`; tsc 0, affected suites 26/26 re-run green. (The persisted
  `AgentRun.model` was always correct — from CLI telemetry — this fixes the event only.)
- **One-provider coverage shape** — accurate reflection of today's reality (only claude-code has an
  adapter): the multi-provider enumerating path is proven at unit level + fixtures; a live
  multi-provider end-to-end run awaits real second adapters. Stated, not hidden.
- **`capabilitiesFor` grants reasoning/research/coding per LLM-kind, not per-model** — documented,
  registry-derived, revisit when per-model capability discovery exists.
- 2 skipped tests: pre-existing, environment-gated, unrelated file.
