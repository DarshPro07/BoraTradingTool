# Brain execution observability — status

**Owner directive (2026-08-15):** the LAST infrastructure rung. A read-model/observability
integration — never an orchestration rewrite: `/brain` proves what the Team OS, Agent OS and
ModelRouter actually did, from the ledgers they already write. After this rung, infrastructure
freezes and the work shifts to strategy-family discovery and forward/paper evidence.

## Gate 0 — reality (verified in source)

Every causal identifier the execution tree needs ALREADY EXISTS — no second tracing store:

- `team_runs` (0021): jobId, plan JSON persisted BEFORE members run (incl. rung-4
  `modelAssignments` per role with binding REQUESTED|PROVIDER_DEFAULT and the router's reason),
  result JSON (TeamResult with FIRST-CLASS dissent/unresolved), chiefAgentRunId,
  memberAgentRunIds[], artifactIds[], tokens/cost/currency, started/completed, error.
- `agent_runs`: team_run_id link; agentId+agentVersion (definition provenance); provider/model/
  status/tokens/cost/timestamps; envelope JSON whose researchRun now carries `modelBinding`
  (RESPONSE_REPORTED | USAGE_REPORTED | REQUEST_BOUND_ONLY — the provider-transports leg).
- `agent_artifacts`: team_run_id, role, kind, agent_run_id (producer), content, created_at.
- ID-EXACT correlation, no timestamp guessing: member run ids are DETERMINISTIC —
  `agr_sha(teamRunId|role|instrumentId)` (team-runtime.ts:331), chief
  `agr_sha(teamRunId|chiefAgentId)` (:452), artifacts `art_sha(teamRunId|role)` (:376) — so
  role attribution is recomputable, and a Job-OS retry re-records the SAME logical id
  (latest-outcome-wins), which is exactly acceptance #13.
- Job state above team state: research_jobs rows are queried by team_runs.jobId — never
  inferred from team status.
- Missing, stated honestly: artifact CONSUMER edges are not recorded (production is; consumption
  is implicit in member inputs) — surfaced as "consumers: unrecorded", queued for the knowledge
  graph, not fabricated. Solo (non-team) runs remain on the existing Researching lane.

## Design

- **`lib/brain/execution-trace.ts`** — the ONE read model: `executionTrace(teamRunId)` →
  { job, teamRun (status/timing/error), plan summary, members[] (role via id-exact mapping;
  agentId@version; ASSIGNED provider/model/binding from the plan vs EXECUTED provider/model from
  the run; modelVerification from the envelope else UNRECORDED; status incl. FAILED members;
  timing; tokens/cost; artifacts with kind/size/createdAt), result (dissent/unresolved verbatim),
  totals { tokens, cost or COST UNAVAILABLE, artifactCount, dissentCount, failed }, reconciled
  (totals vs sum of children) } — plus `listExecutions(limit)` for the panel.
- **API**: GET `/api/brain/executions` (list) + `/api/brain/executions/[id]` (tree). The UI
  consumes one coherent truth; no 20-query pages.
- **/brain**: RECENT WORK panel (cards: instrument, status, duration, member count, artifact/
  dissent counts, tokens) linking to **/brain/executions/[id]**: the execution tree, a pure-CSS
  timeline (bars from real timestamps — parallelism visible), assigned-vs-executed-vs-
  verification NEVER collapsed, dissent block verbatim, navigable artifacts (producer, kind,
  createdAt, content — artifacts are the system's own structured products; raw model prompts are
  NOT dumped, per the sensitive-data rule).
- **Acceptance**: the owner's 20 assertions — read-model completeness in vitest with seeded
  ledger rows (retry latest-wins, failed member visible, binding classes, totals reconcile);
  live surface truth by Playwright driving ONE real team research job end-to-end and drilling
  into an artifact; #20 = a FULL Master Golden rerun, which doubles as the consolidation gate
  for all five post-baseline legs.

## Slices

- [x] Gate 0
- [x] S1 `lib/brain/execution-trace.ts` + tests (2/2): seeded through the runtime's OWN writers;
      pinned — id-exact role attribution, assigned-vs-executed-vs-verification uncollapsed,
      binding classes (USAGE_REPORTED from the envelope; UNRECORDED honestly for older rows),
      failed member visible with its refusal, retry latest-wins as ONE truthful row (#13),
      totals reconcile (#11), TOKENS MEASURED / COST UNAVAILABLE, job state from the job row.
- [x] S2 GET /api/brain/executions (+/:id) + /brain RECENT WORK panel +
      /brain/executions/[id] drill-in (tree, real-timestamp CSS timeline, three binding facts as
      three lines, dissent verbatim or stated absence, artifacts by identity with
      consumers:unrecorded stated, totals with the reconciliation note).
- [x] S3 e2e (`brain-executions.spec.ts`) — **THE FIRST LIVE TEAM EXECUTION in the product's
      history** (all prior Team OS proof ran injected deterministic cores): 4 real model calls,
      ~37s team wall, all four members COMPLETED, 4 artifacts, totals reconciled (6,281 tokens,
      $0.58 USD reported by the provider). And the run produced a REMARKABLE live validation of
      the dissent architecture: the source verifier and critic INDEPENDENTLY identified the
      TEST_MODE fixture data as synthetic ("RSI pinned at 100… perfectly linear +0.77 daily
      increment… fixture identity") and dissented; the chief preserved both dissents verbatim
      and downgraded the recommendation to NEEDS_MORE_EVIDENCE. The team caught the fixture
      being fake — exactly the honesty the architecture exists to produce (and acceptance #18's
      fixture-labeling, asserted by the system itself). Two clean e2e runs (1.2m / 1.0m), each
      with its own fresh live team execution; one found-assertion fix (@v1 rendering) and one
      identity-gate refusal of a stale pin (the gate working).
- [~] S4 full Master Golden — acceptance #20 and the consolidation gate for all five
      post-baseline legs. Run 4 → 11 failures in three families, all root-caused and fixed
      (5m gap seeding, MEETS_POLICY enum, forward-shadow blinded by the dev exclusion, mobile
      wraps). Run 5 → 5 failures, stopped at 170/221 once the fixes for them changed source it
      could not see: one real defect of the spec's (it booted a second `next dev` inside the
      master run and blew the readiness budget), one real defect of the product's (`/command`
      mobile overflow from a 55-char strategy id in the activity feed), three environmental
      (`ERR_NETWORK_IO_SUSPENDED` — the machine dozing at 03:30; run 6 holds it awake).
      A pre-commit adversarial review then found seven more, including a CRITICAL holdout
      contamination path this leg introduced (fail-open actor allowlist let `gauntlet` replay
      across the sealed window — proven at 94 sealed bars, now fail-closed). All fixed and pinned;
      units 160 files / 1829 passed / 0 failed, tsc clean.
      **Run 8 (fresh build + virgin DB + keep-awake): FULLY GREEN — 210 passed / 2 skipped /
      0 failed (54.4m), mobile INCLUDED and passing** (the run-7 overflow fixes held).
      **Run 9** (second attempt, mobile excluded by owner instruction → 210 collected): 206
      passed / 2 failed (57.0m). Both failures are ONE root cause, ledger-proven: HCLTECH's
      research COMPLETED/SOURCE_VERIFIED in 208s (`agr_68c76e0185d546c9`, 3,910 tokens, real
      claude-sonnet-5) while the stage2 spec polled 150s — the "budget, not bug" class run 7
      already met at 104s (TITAN); the second failure is the stage2 completeness gate correctly
      cascading on the missing outcome. Fix: the four specs sharing the 150s research wait
      (stage2, matrix, meeting-journey, golden-journey) resized to a 300s wait (~1.4× the
      measured 208s tail) with remainder-preserving test ceilings (330s / golden-journey 570s);
      assertions untouched; measurement recorded in-spec. Spec-only change → no rebuild, but the
      two-clean-run count RESET.
      **Run 10 (six launch attempts)**: five attempts died to LAUNCHER environment defects —
      session teardown ×2, Task Scheduler BelowNormal priority (ECONNRESET), PowerShell stdout
      pump (same), pid-reuse teardown kill, scheduler battery policy — all recorded in 07-final,
      none touching the tree. Attempt 6 (interactive shape): **207 passed / 1 failed / 2 skipped
      (1.2h)** — the one failure is the SECOND budget-class instance: the replay-mode UI note
      waits on a forward pass MEASURED at 7.2–8.0s server-side at master-run data volume (three
      timed passes on the exact end-state server+DB) against the 10s toContainText default; the
      API sibling passed seconds later, no machine leaked (8/8 runs STOPPED), no error element —
      the button still [disabled] at failure = pass in flight. Fixed: explicit 30s budgets on the
      two note waits (~3.5× the measured tail), measurement recorded in-spec; the sibling
      meeting-journey step already survives by awaiting the response first.
      **Run 11 (diagnostic)**: failed ONLY test 38 — the concurrency spec's status poll read
      ECONNRESET again, this time on the INTERACTIVE launch, killing the launcher-context theory:
      3 of the day's 4 executions failed this way (both contexts) after 0-of-6 across runs 4–9,
      always this spec, always a polling GET, server alive and serving the same URL within
      seconds each time; TIME_WAIT pressure ruled out (44 sockets). Fix: `getJson()` in the spec
      retries ONCE on ECONNRESET for its idempotent polling reads (status ×2 sites, cycles,
      research/jobs) — a real outage fails the retry too; every assertion unchanged.
      **Run 12**: 207 passed / 1 failed (1.1h) — provider-transports' child `next dev` sat in a
      full Turbopack recompile (mid-run tsconfig auto-append by the crash specs invalidated the
      cache) past its 240s readiness budget; no honest budget exists for an unbounded compile, so
      the spec now boots `next start` on the prebuilt acceptance dist when present (proven
      standalone 38.4s/11.8s, in-run 32.5s/31.3s). Run 13's first attempt was killed
      environmentally at test 68 (launcher saga defect 6 — harness task cleanup); both verdict
      runs then rode the hardened detached launcher.
- [x] S4 **COMPLETE — the clean pair landed**: **run 13: 208 passed / 2 skipped / 0 failed
      (57.1m)** and **run 14: 208 passed / 2 skipped / 0 failed (58.3m)**, same build
      `973852a-dirty.4920d47e`, virgin identity-gated DBs, `EXIT=0` markers, tree unchanged
      between the runs. Mobile excluded by owner instruction (run 8 remains the one
      mobile-inclusive green). Verdict in 07-final.md: **VERIFIED_FOR_DEFINED_SCOPE**.
      Committed with the corrected message; infrastructure now FROZEN per the standing owner
      order — next work is quant quality (strategy families through gauntlet → sealed holdout →
      forward → paper), not new subsystems.
