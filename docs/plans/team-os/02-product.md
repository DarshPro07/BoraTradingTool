# Gate 1 — Product

## User problem

The verified single-agent slice can research an instrument with one model call. But some research is
too important, or too conflicted, to trust to a single unchallenged pass. There was no way for the
autonomous system to convene a small team — a proposer, an independent evidence check, and a skeptic —
run them, keep their outputs as durable evidence, and reconcile them while PRESERVING disagreement,
all under the Job OS and with no agent able to take a consequential action.

## User

The owner, operating an autonomous quant-research system. Secondary: the future model-router (rung 4),
which needs meaningful roles/tasks/team contracts to route models against — building routing first
would route models to arbitrary functions again.

## Current behavior

`instrument_research` runs exactly one agent (`runInstrumentResearch`). No team, no artifacts, no
dissent, no plan.

## Desired outcome

A durable `instrument_research` job marked `depth:"deep"` (or `team:true`) is coordinated by a
Chief-of-Staff that, with no human present:

1. builds one shared evidence packet;
2. persists a plan BEFORE any member runs;
3. runs a Researcher, a Source Verifier, and a Critic in parallel over the shared packet — same model
   for each — each producing a PERSISTED structured artifact (not chat);
4. synthesizes the artifacts (by id) into a TeamResult that PRESERVES the verifier's and critic's
   dissent as first-class fields;
5. records the team run and every member run with provenance, emits RESEARCH_COMPLETED once, and lets
   the durable job complete so dependents wake;
6. on any failure, returns the work to the existing Job OS grammar (no bespoke team retry);
7. never lets any member or the chief take a privileged action.

## Success evidence

- One deep job drives job → team → members (parallel) → artifacts → synthesis (dissent preserved) →
  event → dependent wake, proven through `runWorker` with only the gateway mocked.
- Exactly one TeamRun, pinning the versioned TeamDefinition; the plan persisted before members ran;
  member + chief AgentRuns linked by teamRunId; member outputs persisted as artifacts consumed by id.
- Forced failures behave per the Job OS taxonomy (provider-down → retry/dead; invalid → CONTRACT_VIOLATION).
- Budget cannot be exceeded; a crash-retry cannot duplicate member work; the single-agent path is unchanged.

## Failure conditions (feature still wrong if any hold)

- The Chief-of-Staff becomes a second Brain (enqueues privileged work / decides that work exists).
- Dissent is discarded into a consensus. (Prevented: dissent is a required TeamResult field; a
  mutation emptying it fails the test.)
- Members exchange chat transcripts instead of persisted artifacts. (Prevented: outputs are rows in
  `agent_artifacts`, consumed by id.)
- A prompt/role change makes a historical team run irreproducible. (Prevented: TeamRun pins version.)
- The single-agent path changes. (Prevented: a non-deep job runs `runInstrumentResearch` byte-identically.)

## User journeys

1. **Deep research**: a deep job → dissent-preserving TeamResult + recommendation → dependent work wakes.
2. **Thin evidence**: members run; the verifier flags weakness; synthesis recommends NEEDS_MORE_EVIDENCE.
3. **Provider outage mid-team**: a member fails → TeamRun FAILED → job retried/dead per Job OS.

## Screens / interaction

None new. The TeamRun/artifact ledgers are queryable and ready for a later /brain surface.

## Non-goals

1-5 model routing (rung 4); a second team; model-based synthesis (the chief synthesizes
deterministically in this slice); checkpoint-resume that skips already-completed members on retry;
any new privileged capability; any UI.
