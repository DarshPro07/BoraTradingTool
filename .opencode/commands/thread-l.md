---
description: L-Thread — long-running autonomous mission with durable STATE on disk, resumable after compaction/restart.
---

Load the `thread-engineering` skill via the skill tool first. Execute L-thread: $ARGUMENTS

Create `threads/<mission>/` with STATE.md (PLANNED), PLAN.md, WORK_QUEUE.md (numbered), LOG.md, FINDINGS.md, DECISIONS.md, TEST_RESULTS.md, BLOCKERS.md. Set STATE ACTIVE. Loop: take first unstarted WORK_QUEUE item → work it (bounded by user's max_hours if provided) → append LOG (timestamp, step, outcome) → update FINDINGS -> mark item done → refresh STATE (current item, blockers). On context pressure, log compact-friendly state. On resume of any session with a STATE.md present, read it first and continue from the first unfinished item. Blockers requiring the human: STATE=PAUSED + BLOCKERS.md, then stop.