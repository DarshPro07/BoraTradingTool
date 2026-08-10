---
description: C-Thread — checkpointed execution of high-stakes work with explicit approval gates between phases.
---

Load the `thread-engineering` skill via the skill tool first. Execute C-thread: $ARGUMENTS

Segment the task into bounded phases (max 2-4). Create `threads/<runId>/STATE.md` + `CHECKS.md`. After each phase: summarize evidence, then STOP and ask the user to approve/steer via the question tool before the next phase. High-risk categories (trading, governance, migrations, broker rules, holdout, security, protected paths per CLAUDE.md) require a mandatory human checkpoint — NEVER silent auto-run. Record each checkpoint disposition in CHECKS.md. Never run trading/governance steps without an explicit human approval.