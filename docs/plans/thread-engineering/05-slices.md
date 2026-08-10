# Slices: Thread-Based Engineering Layer

## Slice plan
- **Slice 1 (tracer bullet):** Global skill installed → both engines see it. Verify skill listed/loadable. + `threads/.gitignore`.
- **Slice 2:** Claude Code project commands `.claude/commands/thread-*.md` wired; test one (pthread) end-to-end.
- **Slice 3:** opencode commands `.opencode/commands/thread-*.md` wired; verify TUI command list picks them up (or falls back to global `~/.config/opencode/commands/`).
- **Slice 4:** L-thread run-state kit (templates) under `~/.claude/skills/thread-engineering/templates/`, L command stores/recover flow.
- **Slice 5:** F-thread evidence-matrix template embedded in skill; C-thread checkpoint template; Z disabled stub in skill.
- **Slice 6:** Independent verification (Gate 5, fresh context) — disprove claims, check both engines.

After each slice: run appropriate checks; record result in this doc's checklist (see 00-status.md).

## Definitions for each thread (canonicalize in SKILL.md)
See 04-program-design. Full text lives in the skill file.