# Gate 5 — Independent Reality Verification (Team OS)

## Method

An independent `verifier` subagent (fresh context, no authorship stake) read every changed file in
full, diffed each against HEAD to confirm additive-only changes, grepped for privileged calls and
fake-completion patterns, ran the targeted suites + full suite + production build itself, traced each
of the 17 acceptance assertions to the production line it depends on, and **independently mutation-
tested the dissent-preservation claim** (it broke `dissent` to `[]`, watched test [9] fail at the exact
assertion, restored the file md5-verified, and re-ran green).

## Verdict

**VERIFIED (PASS), high confidence, 0 blockers.**

All 17 owner acceptance cases proven with reproduced evidence. Key independent confirmations:
- `lib/agents/runtime.ts` (the single-agent path) has **zero diff** — unchanged, not merely
  "unchanged in behavior". `bridge.ts`, `gateway.ts`, `routing.ts`, `queue.ts`, `event-bus.ts`,
  `dependency-resolver.ts` all zero-diff — the team reuses them byte-for-byte.
- No privileged authority: `AgentPermission` is a closed 3-value union; grep of `lib/agents/` found
  zero references to trial/paper/governance-mutation functions.
- No bespoke retry: grep of `queue.ts` for "team" → zero; `CONTRACT_VIOLATION` / `AGENT_UNAVAILABLE` /
  `TEAM_BUDGET_EXCEEDED` all fall through to the existing generic RETRYABLE taxonomy.
- Anti-fake-completion audit clean across `lib/agents/` and `worker.ts`.

### Independent evidence (verifier-run)

| Check | Result |
|---|---|
| Targeted acceptance (team + single slice) | 2 files, 17 passed |
| tsc --noEmit | exit 0 |
| Full suite (fresh) | 150 files, 1769 passed / 2 skipped, 0 failed |
| Production build | ✓ compiled, exit 0, 86 routes |
| Independent mutation test (dissent) | bites correctly; restore md5-verified |
| Migration 0021 registered / schema | confirmed |
| Privileged-authority + fake-completion audits | clean |

## Three residual risks the verifier raised — disposition

- **Gap 1 (MEDIUM) — a stale FAILED member row could survive a retry-success** (because
  `recordAgentRun` used `onConflictDoNothing`). **CLOSED.** Changed to `onConflictDoUpdate` (latest
  attempt's outcome wins; still exactly one row, still idempotent). New regression test **[15b]**
  proves it: the critic FAILS on attempt 1, SUCCEEDS on the retry, and the row ends COMPLETED (not
  stale FAILED) with no duplication. Verified fresh: 18/18 agent tests, tsc 0.
- **Gap 3 (LOW) — `RunMember` "never throws" was a doc comment, not enforced** (a thrown gateway
  fault would orphan the TeamRun at RUNNING). **CLOSED.** The `runMember` call is now wrapped; a throw
  becomes a `MEMBER_THREW` coded failure, so the normal failure path fails the TeamRun cleanly and the
  Job OS classifies it.
- **Gap 2 (LOW) — "exactly once" is unproven across a whole-process crash between the team's internal
  emit+completeTeamRun and the Job OS's completeJob.** **DOCUMENTED, not fixed** — the verifier
  confirmed this is NOT a regression: the single-agent path (`bridge.ts:556`) has the identical
  unguarded emit-then-complete pattern. It is an inherited, systemic Job-OS-level characteristic
  (idempotent job completion), out of this slice's scope. Tracked as a follow-up in FINDINGS/07-final.

## Gate 5 outcome

Satisfied. All 17 cases verified; the two actionable residual risks were closed and re-verified; the
one inherited risk is documented at the correct (Job OS) level rather than papered over.
