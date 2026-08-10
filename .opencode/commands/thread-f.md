---
description: F-Thread — competing hypothesis branches (prove / disprove / alt root cause / reproduce / audit) resolved by evidence, never majority vote.
---

Load the `thread-engineering` skill via the skill tool first. Execute F-thread: $ARGUMENTS

Spawn 4-5 subagents with deliberately DIVERGENT instructions into `threads/<runId>/f-prove/ f-disprove/ f-altroot/ f-repro/ f-arch/`: prove the hypothesis; disprove it; find an alternate root cause; reproduce via Playwright/tests; architecture/security audit. Collate into `threads/<runId>/MATRIX.md` (hypothesis × evidence rows with evidence labels). Resolve by strength of evidence. If tied, ask for more evidence — do not vote. Present matrix and verdict to user.