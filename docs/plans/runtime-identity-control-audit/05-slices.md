# Gate 4 — Slices

## Slice 0 — repair the working tree (unplanned, blocking)

The uncommitted migration pass from the previous session did not compile. `tsc` found six errors
across four files that reading one file had not revealed:

| File | Damage |
|---|---|
| `components/strategy/RunGauntletButton.tsx` | `mutationFetch` imported twice |
| `components/strategy/StrategyAuthor.tsx` | `mutationFetch` imported twice |
| `components/strategy/TradeInspector.tsx` | `mutationFetch` imported twice |
| `components/quant/QuantAnalyticsPanel.tsx` | import replaced with `import { reaction } from "react"` — a symbol that does not exist, in a module that does not export it |
| `components/learning/AutonomyTicker.tsx` | call site converted, import never added (mine) |

Status: **done**, `tsc --noEmit` clean.

The `reaction` line is the interesting one. It is not a typo a person makes; it is what a mechanical
edit produces when it rewrites a line it did not parse. Four of the five defects would have reached
a browser as a blank screen, and the unit suite was green throughout — it never imports these
components. This is the same lesson as the `AutonomousControl` dead button, arriving from the other
direction: **the suite's silence about the UI is not evidence about the UI.**

## Slice 1 — identity, end to end

`lib/system/identity.ts` · `app/api/system/identity/route.ts` · `next.config.ts` build pinning ·
`lib/system/identity.test.ts`.

Verification: 6 unit tests green. Browser attestation below.

Status: **done**.

## Slice 2 — the invariant that outlives the audit

`lib/client/mutation-fetch.test.ts` gains a scan of `components/**/*.tsx` that fails when a mutating
`fetch` bypasses `mutationFetch`.

**Proven by making it fail.** `RunCycleButton` was reverted to its raw-fetch form and the test
failed naming `components/learning/RunCycleButton.tsx:24`; the fix was restored and it passed. A
guard nobody has watched fail is not a guard.

It also asserts it read more than 20 component files, because a scan that silently reads nothing
passes for the wrong reason — the exact failure mode that lets a "green" suite mean nothing.

Status: **done**, 7 tests green.

## Slice 3 — attestation in the browser

`e2e/identity.setup.ts` as a setup project; `desktop-chromium` and `mobile-chromium` declare it as a
dependency.

Chosen over `globalSetup` because a setup project is guaranteed to run after the web server is up,
has the `request` fixture, and reports a failure as a named failing test rather than a connection
error at an ambiguous point in the lifecycle.

Status: in progress — see 06-verification.md.

## Not in these slices

Items 2–5 of the queue (control inventory, root-cause fixes, `CapitalProfile`, cross-process
singleton). They depend on this gate existing, which is the whole argument for its order.
