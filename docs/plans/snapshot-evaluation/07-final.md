# Final — slice 13b: evaluation on recorded snapshots with experiment manifests

## Verdict: **VERIFIED**

## Objective
Eliminate provider fallback from rehearsal, gauntlet and learning evaluation; make every
quantitative decision reproducible from an explicit immutable manifest; fail closed on missing
data and unpriceable economics.

## What changed (summary — full list in 04-program-design.md)
Migration 0010 (manifest + dataset ids, additive) · `lib/research-data/manifest.ts` ·
`ResearchDatasetSource` as the only evaluation data contract · `DatasetIdentityMissing` at the
gauntlet choke point · identity threaded into trials, holdout grants, rehearsal outcomes,
experiments, HTTP responses and two UI surfaces · `costVerdictOrBlocked` promotion gate ·
provider-import pin test · trial-id collision fix · `FEE_MODEL_ID` / `MARKET_CALENDAR_VERSION`
constants.

## Evidence
1324/0 unit (14 owner tests mapped and passing) · two live mutation checks · production build
clean · **82/0 e2e on a clean server with the true exit code captured**, including the
through-the-server proof that response, trial row and manifest name the same snapshot, and the
provider-blocked reopen. Details: `06-verification.md`.

## Rollback
Additive schema stays harmlessly; code reverts cleanly per module. No applied migration was
modified.

## Next
Per the owner's standing order: continue automatically to the next unblocked build item.
MASTER Part 5 items 1–15 and 13b are now all done; the next unblocked work is item 4's
remainder (Kite adapter implementation — blocked on local-env credentials + owner policy edit,
genuinely human-gated) and the forward-evidence pipeline (paper → forward observations), which
has no open defect attached. No higher-severity issue is open.
