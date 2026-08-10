# Product: Thread-Based Engineering Layer

## User problem
The operator runs long, parallel, high-stakes dev work across two tools (Claude Code in terminal, opencode TUI) but has no structured way to (a) run several agents in parallel without collisions, (b) insert human checkpoints on high-risk work, (c) decide between competing solutions with evidence, (d) run hour/day-long missions with durable state, and (e) know when they've earned zero-touch trust. Patterns exist (P/F/C/B/L/Z threads) but live only as article text — not as useable tools.

## User
The operator of MarketPulse OS — an experienced agentic engineer; runs both engines; reviews outputs.

## Current behavior
Work happens ad-hoc: one long context, manual start/stop, no run-state, no diversity discipline (agents can all share the same misconception), risky migrations progressed without checkpoints.

## Desired outcome
From either engine, the operator can invoke:
- P-thread (parallel independent exploration, no shared-file mutations)
- C-thread (checkpointed high-stakes work with explicit gates)
- F-thread (competing evidence-based solutions; ORCHESTRATOR resolves with evidence, not vote)
- B-thread (supervisor delegation to specialist subagents)
- L-thread (long-running mission with durable STATE/PLAN/WORK_QUEUE files; resume after compaction/restart)
- Z-thread = explicitly DISABLED (earned-trust not yet achieved; returns NOT_AVAILABLE with reason)

And the system for MarketPulse keeps its irreug boundaries: trading actions always gated, software-factory gates supersede design decisions.

## Success evidence
- `opencode --agent ...` or Claude `/thread:*` lists the six thread patterns; Z returns a disabled notice.
- A P-thread of 3 independent research agents is spawnable and non-colliding (distinct scratch files).
- An L-thread mission can be interrupted/crash and resumed from `threads/<mission>/STATE.md` by a fresh engine session.
- F-thread output includes an evidence matrix (claims vs evidence-candidates), not vote counts.
- No conflicts with OMC: commands named `thread:*`; OMC keywords untouched.

## Failure conditions
- Thread command errors in one engine but not the other (asymmetry).
- P-threads writing to the same file (undetected race).
- Z-thread is reachable.
- Run-state files not honored after compaction — resumed from wrong state.

## User journeys
1. Operator: "run pthread on recent token-security claims" → three scouts, joined, report with file refs.
2. Operator: "cthread migration" → checkpoint gate before/after, human sign off each.
3. Operator: "fthread on the orderbook bug" → three hypotheses in isolated dirs, orchestrator picks by evidence.
4. Operator: L-thread marathon script overnight; wakes to STATE/work photos.

## Non-goals
- Not a full ecosystem runner (as OMC) — an execution-pacing framework.
- Z-thread not implemented.
- Trading autonomy: no orders.
- No duplication of software-factory design gates.