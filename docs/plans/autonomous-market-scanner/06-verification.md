# Gate 5: Verification Plan

## Low-Level

- TypeScript and focused scanner tests pass.
- Critical tests are demonstrated red before implementation and green after.
- Full Vitest, MCP, production build, and production dependency audit pass.

## Persistence

- Fresh and upgrade migrations pass.
- Scanner evidence is append-only and idempotent.
- Displayed counts and hashes reconstruct from SQLite.
- Protected trial, holdout, forward, intent, and paper tables are unchanged.

## Browser

- Fresh isolated database and server.
- Desktop 1366x768 and 1440x900.
- Click every stage and at least one named exclusion.
- Open candidate evidence and then `/brain`.
- Verify identical run ID and payload hash.
- Verify no page errors, failed requests, or validation/paper/live mutations.

## Current Verdict

NOT_RUN. Implementation is blocked by the existing integration release gate.
