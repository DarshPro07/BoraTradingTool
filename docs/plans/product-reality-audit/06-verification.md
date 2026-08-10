# Gate 5: Verification Plan

## Current Status

PARTIALLY_VERIFIED. The clean-database bootstrap and owner-server desktop search paths pass; the uninterrupted isolated-server journey has not run.

## Required Evidence

- Focused tests prove red before green.
- Full TypeScript, Vitest, MCP integration, and production build pass.
- Desktop Chromium at 1366x768 and 1440x900 completes fresh-database search and open.
- Search, analysis, and quote requests have expected statuses and canonical identity.
- Browser console contains no warnings or errors introduced by the slice.
- Database contains successful sync metadata and expected current listing rows after the action.
- Failed-source injection produces an explicit unavailable state and durable failure record.
- An independent reviewer challenges the implementation and tests.

## Recorded Evidence

- `npm run typecheck` passed.
- Full Vitest: 119 files, 1,446 passed, 2 skipped.
- `npm run test:mcp` and `npm run audit:prod` exited successfully.
- Desktop instrument-search E2E: 7 passed.
- An isolated official-source database persisted 3,314 XNSE listings and resolved an ETF by canonical identity.
- Owner browser search and analysis produced no console warnings or errors.
- A second dev server was blocked by Next's same-workspace lock; this does not satisfy fresh-server browser proof.

## Existing Runtime Evidence

Owner-data SBIN and NIFTYBEES paths are OBSERVED working, but owner data cannot satisfy the isolated fresh-server gate.
