---
description: P-Thread — run N parallel independent explorations/audits in isolated scratch dirs, join into one report.
---

Load the `thread-engineering` skill via the skill tool first. Then execute P-thread for: $ARGUMENTS

Create runId `threads/YYYYMMDD-HHMM-<slug>/`, spawn 3 parallel subagents (or up to 5 if the user asked), each in its own `p-A/ p-B/ p-C/` scratch dir, all isolation rules from the skill apply (no shared file writes). Wait for all. Write `JOIN.md` with per-agent summary + evidence labels. Present to user; recommend next step (single thread or C/F). Do not modify protected paths.