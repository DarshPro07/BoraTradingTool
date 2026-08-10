# Gate 2 — Architecture

## Fit
Three thin layers, all existing, each gaining one small honest piece:

1. **API echo (app/api/forward/run/route.ts)** — the response gains
   `mode: "LIVE" | "REPLAY"` and `evaluatedAsOf: ISO`. The mode is derived from whether the
   caller supplied asOf; the instant is the one actually passed to both engine passes. This makes
   the label EVIDENCE (server-attested) rather than client inference. No behavioural change.
2. **Surface (components/forward/ForwardEvidencePanel.tsx)** — a two-way mode control;
   REPLAY reveals a `datetime-local` input and disables the run button until an instant parses;
   the run posts `{ asOf }` only in REPLAY. The result note renders from the RESPONSE's
   mode/evaluatedAsOf (not from client state), prefixed `REPLAY — HISTORICAL EVIDENCE` or
   `LIVE (wall clock)`.
3. **Acceptance (e2e/replay-mode.spec.ts)** — desktop journey driving the control, asserting the
   label, the API echo, and the LIVE/REPLAY distinction; runs on a clean DB (no seeding rig).

## Data flow
UI mode+instant → POST /api/forward/run {asOf?} → runShadowPass(asOf)/runPaperPass(asOf)
(unchanged) → response {…report, mode, evaluatedAsOf} → note labelled from response →
ledgers already persist the pass's effects (trigger-immutable; watermark forbids retroactivity).

## Failure paths
- Unparseable instant: input-level disable (client) + existing BAD_AS_OF 400 (server) → note
  shows the refusal.
- Zero challengers: labelled 0-count report — honest empty, not an error.

## Security
No new mutation surface; same `requireMutationAccess` route; asOf already validated server-side.

## Alternatives considered
- Global replay mode in chrome — rejected: replay is per-pass; a global badge misstates app state.
- New /api/replay route — rejected: one door for one action; the mode is a parameter, not a
  different capability.

## Risks
- Timezone reading of `datetime-local` (local time → Date) — mitigated by echoing the
  server-parsed instant back and rendering THAT.
