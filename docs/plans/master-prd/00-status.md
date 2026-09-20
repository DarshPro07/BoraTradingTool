# Master PRD — status (read this first)

**The PRD is [`MASTER_PRD.md`](./MASTER_PRD.md).** It is the A-to-Z: every capability with its
state and the evidence behind it, every gap with its acceptance condition, and the build order.

## Where things stand, 2026-09-20 17:00 IST

| layer | running? | the honest summary |
|---|---|---|
| L0 data | yes | 2,123/2,123 NSE instruments current; calendar 0 days behind; intraday 5m depth thin |
| L1 research | yes | 186 sources; free models do the reading; no news or filings intake |
| L2 strategies | yes, and unblocked today | 62 specs; the intraday lane was dead and is now alive; nothing validated yet |
| L3 execution | paper only | fund FN1/FC1/FC2 live 1-3 days; **intraday IN1 has never run a decision** |
| L4 meta | yes | router + watchdog work; Antigravity blocked on owner login; no alerting |

**0 of 12 trust gates pass.** That is correct and expected — T1 needs 30 days. There is no edge
on record yet, and the PRD does not pretend otherwise.

## Today's audit, in one line each

- Playwright over 21 screens, plus direct queries against the live 855 MB database.
- Seven defects found; all seven fixed (see PRD §3). Three of them had killed the intraday lane
  outright: the cost repair was destroying the specs, the authoring script could not author, and
  the factory had stopped breeding them.
- A 5h12m cycle outage was found with no record behind it. Task limits and logging are fixed.
- Full suite: 210 files, 2,282 passing.

## Next action

Monday 2026-09-21, 09:14 IST: watch IN1's first live session end to end (PRD §4.2). If no
`intraday_decision` row appears by 09:30, that is the only work until it does.

Then, in order: owner runs `! agy`; alerting on watchdog FAIL; profile `/brain` and
`/data-quality`.

## Commits

| commit | what |
|---|---|
| `1fe2b66` | capital split: train at ₹25,000, keep the owner's real ₹5,000 beside it |
| `8081317` | stop telling the owner to destroy the training book |
| `f648767` | the repair was killing the intraday specs, and the factory had stopped breeding them |
| `65f7f7b` | count candles in SQL instead of loading 3.5 million rows |
