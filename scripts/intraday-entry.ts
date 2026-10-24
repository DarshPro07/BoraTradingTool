/**
 * One minute of the intraday trader (IN1). Driven by the Windows task "MarketPulse Intraday", every
 * minute on weekdays 09:14-15:39 IST, under its own lease so a slow minute never overlaps the next.
 */
import { closeDatabase, databasePath } from "@/lib/db";
import { runLog } from "@/lib/intraday/coverage";
import { INTRADAY_LEASE, intradayLeaseFile, realIntradayDeps } from "@/lib/intraday/deps";
import { runIntradayPass } from "@/lib/intraday/orb";
import { withCycleLease } from "@/lib/learning/lease";
import { ledgerOwnedByCloud } from "@/lib/ledger/writer";

export async function runIntradayOnce(holder: string): Promise<number> {
  // docs/plans/cloud-clock: while the cloud clock runs IN1, this machine must not decide or trade.
  if (ledgerOwnedByCloud(databasePath())) {
    // "idle", never "ran" or "skipped": those are heartbeats (lib/intraday/coverage.ts), and this
    // minute did no clock work here. After a promote it must not count as coverage.
    process.stdout.write(`[${holder}] ${new Date().toISOString()} idle: the cloud clock owns the ledger\n`);
    return 0;
  }
  try {
    const outcome = await withCycleLease(holder, () => runIntradayPass(realIntradayDeps), intradayLeaseFile(), INTRADAY_LEASE);
    // EC-2: a line on every run, so a quiet minute and a dead clock no longer look the same.
    process.stdout.write(runLog(holder, new Date(), outcome));
    // EC-9: an instrument that failed is in the lines above; Task Scheduler still records the run as failed.
    return outcome.result?.some((r) => r.action.startsWith("failed:")) ? 1 : 0;
  } catch (caught) {
    process.stderr.write(`[${holder}] ${new Date().toISOString()} error: ${caught instanceof Error ? caught.message : String(caught)}\n`);
    return 1;
  } finally {
    closeDatabase();
  }
}
