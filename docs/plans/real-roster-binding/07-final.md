# 07 — Final Verdict (Real Roster + Execution Binding, masterclass A6)

## Verdict: VERIFIED

Both named production gaps from the model-routing leg are closed and independently verified.

- **A6.1** — the production team path builds its roster from what `detectProviders()` actually
  found. Discovered models → entries (no authored quality/latency values beyond the catalog's own);
  READY-but-non-enumerating providers → one truthful `<provider>:default` sentinel; non-LLM and
  non-READY excluded. Explicit `[]` stays an honest "nothing available".
- **A6.2** — the router's assignment is genuinely REQUESTED from the adapter (`--model`), the
  executed model is still discovered from telemetry (so assigned==executed==recorded is verified,
  not assumed), and where the provider serves its own default the plan says so
  (`binding: PROVIDER_DEFAULT`) instead of pretending. The MODEL_SELECTED event now reports the
  bound model too (closed post-verification, re-verified).

## Tests — exact results

roster 5/5 · team 14/14 (incl. `[A6.2]` assigned==executed proof + production-default assertions) ·
single slice 7/7 (file zero-diff) · router 11/11 → 37/37 targeted. Full suite (verifier's fresh
run) **152 files / 1789 passed / 2 skipped, 0 failures**. tsc 0. Binding thread-through
**mutation-proven** (severing it fails `[A6.2]`; reverted green). Post-fix re-run 26/26.

## Independent verification

Verifier subagent → **VERIFIED / 0 blockers** (see 06). Its one actionable residual (event
misreport) was closed and re-verified; the rest are stated coverage-shape facts, not defects.

## Files changed

New: `lib/runtime/roster.ts`, `lib/runtime/roster.test.ts`, `docs/plans/real-roster-binding/`.
Edited: `lib/runtime/gateway.ts` (3 small additions), `lib/agents/team-runtime.ts`,
`lib/agents/team-runs.ts`, `lib/agents/team.test.ts`.

## Known limitations (stated)

- Only claude-code has a real adapter today, so the live production roster is the one-provider
  sentinel shape; multi-provider enumeration is proven at unit/fixture level and activates as
  adapters land. The owner-facing 1-5 ACTIVE-model selection surface is the natural next consumer
  of `buildDetectedRoster` (owner-steered).
- Per-model capability discovery (vs per-provider-kind) awaits providers that report it.

## Rollback

Delete `roster.ts`/`roster.test.ts`; revert the 3 gateway additions, the team-runtime default-roster
block + threading, and the `binding` field. No schema, no migration.

## Readiness

**VERIFIED.** Owner wording: **Model routing — production-wired (real roster + stated binding).**
