# Gate 1 — Product

**Problem**: rehearsal, gauntlet and learning evaluation could judge strategies on data that
cannot be named afterwards — a provider window, or a store state nobody recorded. Any such
number can influence validation and promotion while being irreproducible, which is the exact
class of silent damage this system exists to prevent.

**Outcome (the owner's invariant, verbatim)**: *every quantitative decision must be reproducible
from an explicit immutable experiment manifest* — strategy version, dataset snapshot, engine,
broker profile, fee model, calendar version, seed, code fingerprint, timestamp.

**Success evidence**: the 14 owner tests, mapped in `04-program-design.md`; a real gauntlet run
through the running server whose HTTP response, selection-trial row and experiment manifest all
name the same `dss_` id.

**Failure conditions**: any evaluation path that accepts bars without snapshot identity; a
provider fetch inside a running evaluation; promotion proceeding when economics cannot be priced.

**Non-goals**: migrating the quant-core generation pass or live views off providers (they are
live workflows, explicitly permitted); backfilling identity onto legacy rows (they stay NULL,
visibly pre-manifest).
