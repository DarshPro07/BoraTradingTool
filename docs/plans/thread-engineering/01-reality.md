# Reality: Thread-Based Engineering Layer

## What exists (all terms labeled per epistemic ladder)

- REPRODUCED: Both engines share mirrored global agent catalogs: `~/.claude/agents/*.md` and `~/.config/opencode/agents/*.md` (browse of both dirs shows identical role names: 3d-scene-developer … agents-orchestrator, 200+).
- REPRODUCED: Both engines auto-load `~/.claude/skills/**` (skills appear in opencode's available_skills list AND Claude Code reads it natively). One install = both tools.
- STATICALLY_CONFIRMED: opencode has NO project-level `.opencode/` dir in E:\BoraTradingTool (Test-Path=False). Claude Code has `.claude/{agents,hooks,skills}` with hooks `guard-writes.mjs` (write protection) and `block-secrets.mjs`.
- STATICALLY_CONFIRMED: Global opencode.json permits edits under `E:\BoraTradingTool\**` and external_directory allows it too — the enforcer must NOT break these.
- OBSERVED: Global `~/.claude/CLAUDE.md` is OMC-managed (oh-my-claudecode) — has its own delegation rules (executor agents, model routing, `/team`, autopilot/ultrawork/ralph modes). The thread layer must coexist — it is an execution-pacing framework, not an OMC replacement.
- OBSERVED: This repo already has mandatory workflow rules in CLAUDE.md (project, software-factory) and AGENTS.md (project + global) — the thread command/skill must chain INTO the software-factory gate docs, not reinvent them.
- STATICALLY_CONFIRMED: Playwright dev experience: repo has playwright.config.ts and components — for F/C thread acceptance, verification should use Playwright journeys defined by software factory. (docs/plans exist? docs/plans/thread-engineering now created by this run.)

## What is missing
- No thread-patterning layer for either engine: no P-thread/C-thread/F-thread/B-thread/L-thread commands or skills.
- No run-state directory convention (e.g., `.threads/<mission>/STATE.md` …) for L-threads.
- No guidance that resolves F-threads with EVIDENCE (prove/disprove/diversify) instead of majority vote.

## Known failures / risks
- OMC's `ralph`/`ultrawork` already consume "autonomous" keywords — risk of loud conflicts. Mitigation: name thread commands `*thread*` distinctly.
- If a skill is placed project-level only in `.claude/skills`, opencode needs it under `.opencode/skills` or global `~/.claude/skills`. Robust: install GLOBAL `~/.claude/skills/thread-engineering/` → both load; project-level command files per engine for explicit invocation.
- Windows/Node: hook/script must run under node (mjs) like existing guards; no bash assumptions.
- MarketPulse no-broker boundary: C-threads for trading/see CLAUDE.md — must remain enforced (protected paths). The thread skill must CALL OUT that trading actions pass through `lib/governance`/adr review, not auto-run.

## Conclusion (Gate 0 internal check)
Reality is well enough understood to design the product: a shared SKILL + per-engine COMMAND/AGENT wiring for P/C/F/B/L threads, Z disabled, evidence-first fusion, integrating into software-factory gates and OMC coexistence.