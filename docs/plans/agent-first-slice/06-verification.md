# Gate 5 — Independent Reality Verification

## Method

An independent `verifier` subagent (fresh context, no authorship stake, Write disabled) read every
changed file in full, re-ran every command with fresh output, ran the full regression suite itself,
and traced each test assertion back to the production line it depends on to rule out tautologies.
It was explicitly tasked to try to DISPROVE the slice and to audit for fake-completion patterns.

## Verdict

**VERIFIED (PASS), high confidence, 0 blockers.**

All five owner §15 acceptance items independently confirmed with fresh evidence; the core invariant
(AgentDefinition ≠ AgentRun, no double recording, no privileged capability) confirmed by full code
reading rather than by trusting the tests' own framing; zero `.skip`/`.only`/`todo`/`TODO`/`FIXME`/
stub patterns anywhere in `lib/`.

### Independent evidence (verifier-run)

| Check | Result |
|---|---|
| Focused acceptance tests | 6/6 pass (names map 1:1 to owner §15 items) |
| `tsc --noEmit` | exit 0, zero diagnostics |
| Related regression (bridge, dependency-resolver) | 31 passed |
| Related regression (queue/worker/chain) | 28 passed |
| Full suite (fresh) | 149 files, 1758 passed / 2 skipped, exit 0 |
| Anti-fake-completion grep over `lib/` | 0 matches |
| Migration 0020 registered / schema columns | confirmed |
| No double `recordAgentRun` (bridge record:false + handler) | confirmed by grep of all call sites |

### §15 acceptance — verifier findings

1. Job → definition resolved → gateway once → provider/model recorded → AgentRun COMPLETED
   (agentId+version+jobId) → job succeeded → RESEARCH_COMPLETED → dependent wakes — VERIFIED.
2. Provider down → AgentRun FAILED → coded throw → Job OS retry taxonomy — VERIFIED.
3. Invalid output → FAILED (CONTRACT_VIOLATION) — VERIFIED.
4. INSTRUMENT_UNKNOWN → REFUSED, killed — VERIFIED.
5. NO_STORED_DATA → ingest + dependent research (waiting_dependency), deferred not looped — VERIFIED.

## Two non-blocking gaps the verifier raised — BOTH CLOSED

- **(a) Success-path provider/model not asserted by name.** The failure path asserted `provider`
  but the success path's provider/model come from a *different* line (`result.envelope.researchRun.*`)
  and were unchecked. **Closed:** the success handler test now asserts `provider: "fixture",
  model: "contract-fixture"`; the full-path test asserts `provider: "claude-code", model: "test-model"`.
- **(b) "Job OS retry semantics" for this kind proven only by composition.** No single test drove an
  `instrument_research` job through `runWorker` into a real failure. **Closed:** added an integration
  test — seed bars → mock the gateway to RETURN an `AGENT_UNAVAILABLE` refusal → enqueue the durable
  job with `maxAttempts:1` → `runWorker` → assert the gateway was reached (calls===1), the job
  settles `dead` with `lastError` containing `AGENT_UNAVAILABLE`, and a FAILED AgentRun is linked to
  the job id with the failing provider preserved.
- **(c)** A pre-existing `lib/learning/golden-journey.ts` double-write observation — confirmed OUT OF
  SCOPE (two distinct logical runs, unrelated to this slice, unchanged by it).

## Re-verification after closing the gaps

- Focused suite: **7/7 pass** (`--reporter=verbose`), the new worker-failure integration included;
  the `[research] … model-call=0ms` log line confirms the real bridge reached the mocked gateway.
- `tsc --noEmit`: exit 0.
- Full suite including the two additions: see 07-final.md.

## Independent challenge outcome

The verifier's adversarial pass found no defect and no fake completion; the two coverage-hardening
suggestions it raised were closed and re-verified. Gate 5 is satisfied.
