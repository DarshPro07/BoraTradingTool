# Protected-path provenance — Status

**RESOLVED 2026-08-14 00:42.** See 01-reality.md for the full investigation, preserved diff and
decision rationale.

- `drizzle/0014_autonomy_default.sql` restored to canonical (`git checkout`), after proving the
  edit was dead three ways (runner uses a TS twin; applied migrations never re-run; runtime
  coerces the stored mode). Migration + governance suites green after restore: 4 files / 76
  passed / 0 failed.
- No new data migration required — the intended "always-RUN" default is implemented in code
  (`lib/governance/runtime.ts` coercion + `lib/brain/auto-mode.ts`) and covers every database
  uniformly. Optional one-line 0019 recorded in 01-reality.md, deliberately not taken.
- The wider single-RUN/ownerless-auth refactor stays in the tree as inherited, test-green,
  owner-directed work-in-progress. NOT committed by this session.

## Auth boundary — adversarially verified 2026-08-14 01:35

The owner's gate before autonomy expansion. `requireMutationAccess` (lib/security/request.ts) is
a pure 5-layer boundary: loopback binding · exact same origin (protocol+host+port) · Fetch
Metadata · HMAC SameSite=Strict session cookie · custom mutation header. New adversarial suite
`app/api/session/local-session-security.test.ts` (16 tests, outside the protected dir) proves
every case the owner enumerated: cross-site POST rejection (origin + explicit Sec-Fetch-Site) ·
missing/wrong custom header · origin mismatch on DIFFERENT PORT and DIFFERENT PROTOCOL · session
tampering (flipped byte, foreign-secret forge, structural junk) · simple cross-site form POST ·
expired token · **pre-restart cookie rejected** (the in-memory secret rotates per process, so
mutations fail closed until /api/session re-issues) · non-loopback + spoofed X-Forwarded-Host.
The legitimate path returns null (allowed).

**Why forged requests, not a browser:** the attacks a browser physically cannot send — that
refusal IS the defense — so the server-side rejection is the real thing to prove, and forged
`Request` objects prove it decisively. The legitimate happy path (cookie issuance, mutationFetch,
same-origin mutation success) is already exercised by the existing green e2e mutation flows.
**Residual (named):** no dedicated Playwright spec isolates /api/session issuance; the enforcement
function itself is fully proven. The refactor still needs the OWNER'S commit decision.
- `drizzle/0018_job_dependencies.sql` is untracked (new migration, permitted) — commits with the
  rest whenever the owner commits.
