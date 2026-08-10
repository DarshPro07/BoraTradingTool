# Flake log

Discipline: a flaky test is a defect. "Passed on rerun" is capture, never closure — every
occurrence is recorded here with conditions, and a repeat of the same signature becomes a root-fix
work item. `npm run test:full` writes `.tmp/vitest-run.json`; runs made without that capture must
say so.

## 2026-08-10 14:13 IST — one file failed at suite level under concurrent load, name not captured
- Run: plain `node ./node_modules/vitest/vitest.mjs run` (NOT test:full — no JSON capture, so the
  failing FILE name was lost; summary only: `1 failed | 115 passed` files, `1425 passed | 6
  skipped` tests, zero individually-failed tests → file-level error with in-file skips).
- Conditions: the production e2e server (:3100) was still serving the full desktop Playwright
  suite's artifacts on the same machine; import phase took 559s vs ~330s on clean runs — heavy
  CPU contention, consistent with the previously hardened timeout class (forks pool + 30s
  ceilings; see WORK_QUEUE "Foundation-hardening closures").
- Immediately after (server killed): two consecutive full runs green — 116/116 files,
  1429 passed / 2 skipped, twice.
- Action if repeated: run via test:full for the JSON capture, name the file here, and root-fix.
  Lesson applied now: verification unit runs happen AFTER the e2e server is stopped, not beside it.
