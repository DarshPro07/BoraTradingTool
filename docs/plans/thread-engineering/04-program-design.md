# Program Design: Thread-Based Engineering Layer

## Files (create)
1. `C:\Users\marke\.claude\skills\thread-engineering\SKILL.md` — **the single source of truth**, loaded by both engines. Defines the six commands, scratch conventions, evidence-fusion rules, safety boundaries, resume discipline.
2. `E:\BoraTradingTool\.claude\commands\thread-*.md` (7 files: pthread, cthread, fthread, bthread, lthread, zthread, threads) — **prompt templates** that answer to `$ARGUMENTS` and instruct engine to execute per-skill. (Claude-Code project commands dir; engine specific.)
3. `E:\BoraTradingTool\.opencode\commands\thread-*.md` — same seven, opencode flavor (use `task` subagent; `agent: build`).
4. `.env`-style durable location: L-thread STATE under `threads/<mission>/` (workspace root).
5. (Optional, if Slice 5 shows need) `~/.config/opencode/commands/thread-*.md` global copies.
6. Plan docs (this folder) — gate docs per software-factory discipline.
7. `.gitignore` entry `threads/` (runtime scratch).

## Types/contracts (no bodies / no implementations)
```
ThreadRunId = ISO timestamp slug (e.g. 20260809-1530-orderbook)
MissionDir  = threads/<runId>/   (or threads/<missionName> for L)
LState enum: PLANNED | ACTIVE | PAUSED | RESUME | COMPLETE | ABORTED
L-thread files: STATE.md PLAN.md WORK_QUEUE.md FINDINGS.md DECISIONS.md TEST_RESULTS.md BLOCKERS.md
FEnvelope: { hypothesis, instructions, scratchDir, outputs[] }
EvidenceEntry { sourceFile?, command?, observation, outcome, verdict: CONFIRMED|REFUTED|INCONCLUSIVE }
```

## Call flows
- `pthread <task>` → load skill → create runDir → dispatch N=3 subagents (each a supervisor instruct with different angle) via Task tool, scratch pubs SPLIT: pA/pB/pC — join into summary file.
- `cthread <task>` → create runDir + STATE.md → run step, at EACH step call user (AskUserQuestion / `question`) → proceed/pause → mark checkpoint → continue.
- `fthread <topic>` → runDir, 3–5 subagents with adversarial scripts: prove / disprove / alternate / reproduce(playwright) / audit → dump outputs to f* dirs → build evidence matrix in FINAL report → orchestrator (main agent) resolves; NO vote.
- `bthread <task>` → decompose → dispatch per-subagent via Task tool → merge/verify.
- `lthread <mission>` → mission dir + all state files seeded → loop: `while active: execute next item from WORK_QUEUE; append LOG; update STATE; if compaction/session end: STATE is current; on resume: read STATE, continue first unfinished`.

## State transitions
ACTIVE → (queue drained | confirmed) → COMPLETED
ACTIVE → (blocker) → PAUSED → (resolve) → ACTIVE
Any → ABORTED only with user command (except time limit).

## Error model
- Subagent failure → mark findings INCONCLUSIVE, log, continue others (L-thread non-stop rule with bounded MAX_RUN).
- Output loss → records in files synced; never only in chat.
- Tool timeout on C-thread → checkpoint unresolved → user notified; continue next.

## Test design (must exist)
1. P: paralllel run over a trivial target (e.g., "list three files under lib/" by 3 named subagents) → verify 3 distinct scratch dirs + joined output; no shared-only race.
2. C: checkpoints trigger `question` tool → choose proceed → verify checkpoints recorded in STATE.
3. F: 2 competing hypotheses on a seeded "bug" (fixture does NOT exist so use real — e.g., a variance temp file in threads/) — assert matrix has ≥2 sources, verdict labels present.
4. L: Runs on a short mission (3 WORK_QUEUE items) — crash simulation: after 1 item, re-open fresh engine (me, new session) read STATE → first-unfinished item resumed. (Will verify via doc state, since live crash at this layer is bounded.)
5. Z: assert responds "DISABLED" and does nothing.

## Least confident decisions
- opencode project commands dir: does `.opencode/commands/*.md` become command in TUI? (Per opencode docs — commands named `*.md` under directories; but skill warns project commands live in `.opencode/command/`.) — verification step will confirm via config docs. fallback `.config/opencode/commands/`(global) both engines-true.
- Next.js engine differences: subagent spawning syntax same? (both have Task; `agent` tool name may vary → keep traction on `task`).
- Whether `threads/` should be committed (unlikely; keep gitignored).

## Rollback
- Delete scratch dirs; commands/skill removal one-file delete; no state outside threads/ nor engine-conf changes; existing engine config untouched.

## Least missing
- Does Claude Code load global `~/.claude/skills` as skill? (already proven: find-skills reports skills from ~/.claude/skills in-process.