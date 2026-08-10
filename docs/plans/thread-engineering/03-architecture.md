# Architecture: Thread-Based Engineering Layer

## Current architecture (full
- Engines: Claude Code (reads `~/.claude/`, project `.claude/`, auto-loads `~/.claude/skills`), opencode (reads `~/.config/opencode/` + project `.opencode/` + ALSO auto-loads `~/.claude/skills/**`).
- Existing guard hooks in project `.claude/hooks/`: `guard-writes.mjs` (write-protect paths), `block-secrets.mjs` — node-based, Windows-friendly. Reuse the same mechanism for a `thread-snap.mjs` optional hook.
- Existing mandatory workflows (CLAUDE.md / AGENTS.md) require software-factory gates for substantial work — thread layer must flush INTO that: a P exploration feeds 01-Reality; C checkpoints sit inside slices; F-thread resolution = independent verification.
- Playwright + vitest tooling in repo; MCP servers present (ruflo, ruv-swarm, headroom, context optimizer, chrome-devtools, playwright, puppeteer per skill catalog).

## Proposed fit
Introduce a **GLOBAL skill in `~/.claude/skills/thread-engineering/SKILL.md`** (auto-loads in both engines) + **per-engine command files**:
- `claude.code: .claude/commands/thread-*.md` (project)
- `opencode: .opencode/commands/thread-*.md` (project) → single project with both command namespaces so both engines get identical UX.
- Plus global command shadow copies under `~/.config/opencode/commands/` and `~/.claude/commands/`? (optional; commands per engine at project level is enough and simpler.)

### Data flow
User types `pthread find bench candidates` (either engine) → engine loads skill → skill directive defines:
scatch dir convention: `threads/<run-id>/p-*/` `threads/<run-id>/l-state/STATE.md` etc.
`threads/` is `.gitignored` unless user decides; but L-thread STATE must be durable — put L state in `threads/<mission>/STATE.md` (git-tracked not required).
→ engine spawns N subagents (task tool) each with own scratch sub-folder → results written to `threads/<run-id>/` → operator reviews.

Commands:
- `pthread <task>` — parallel — up to N (default 3) subagents, isolated scratch dirs `threads/<ts>/p1..pN`, joined summary.
- `cthread <task>` — checkpointed — single agent, pauses at checkpoints with question tool, state in `threads/<ts>/STATE.md`.
- `fthread <task>` — competition — 3+ subagents with DIFFERENT instructions (prove/disprove/alternate root-cause/playwright-repro/arch), results into `threads/<ts>/f1..fN`, then evidence matrix; orchestrator resolves by evidence; NO majority-vote.
- `bthread <task>` — delegation — master agent assigns to specialist subagents from existing catalog, coordinates merge.
- `lthread <mission>` — long-running — create mission dir, write STATE/PLAN/WORK_QUEUE/FINDINGS/DECISIONS/TEST_RESULTS/BLOCKERS, run loop in bounded context windows, auto-resume from STATE on sync; designed to run unattended bounded by `MAX_RUN_MINUTES`.
- `zthread` — stub → returns "DISABLED: earned trust not yet available".

### Interfaces
Skill is one SKILL.md (markdown); commands are small markdown prompt templates calling subagent `task` tool (primary agents have that in both engines); scratch dirs created via tried Tasks; no plugin code needed for v1. Optional hooks: `thread-state` mjs mirrors STATE on each Stop hook — defer to v2 (keep v1 zero-fragility).

## Data / persistence
- `threads/<run>/` — scratch artifacts (gitignored)
- L-thread STATE.md — durable, refreshed every operation; a fresh session reads STATE.md and resumes (mirrors `00-status.md` discipline).

## Security
- Trading boundary: skill text states that any direction touching trading/governance/pb must route through C-thread + human approval + protected-path test; never auto-run.
- F-thread agents operate read-only or in scratch only.

## Compatibility
- No changes to OMC catalog; only new `*thread` commands; skill editable via existing skill loader. Global skill file added at `~/.claude/skills/thread-engineering/SKILL.md` = both engines load.

## Alternatives considered
- A node-based orchestrator bin (`npx thread-cli`): overkill; subagent `task` is built-in both engines; command+skill = 2 files. Chosen.
- Symlink skill into `.opencode/skills` symlink: Windows symlink pain; global `~/.claude/skills` already serves both — chosen.

## Architecture risks
- opencode in-proj might not read `.claude/commands/` → therefore also place command files under `.opencode/commands/` identical; and engines' per-engine natives are the docs path. Validate at Slice 2/verification.
- Subagent → Task tool availability in both engines (opencode has `task` with build agents; claude code has task tool for subagents) — confirm.
- Long-lived runs across timeouts in Windows; mitigate with STATE.md durable design.
- Not breaking `guard-writes/secret` — new files only outside protected paths.

## Internal gate
Root cause = no execution-pacing vocabulary usable on both engines — solved with least complexity (2 files + scratch convention). Proceed.