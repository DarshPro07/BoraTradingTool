/**
 * One minute of the intraday trader (IN1). Driven by the Windows task "MarketPulse Intraday", every
 * minute on weekdays 09:14-15:39 IST, under its own lease so a slow minute never overlaps the next.
 */
import path from "node:path";
import { closeDatabase } from "@/lib/db";
import { realIntradayDeps } from "@/lib/intraday/deps";
import { runIntradayPass } from "@/lib/intraday/orb";
import { withCycleLease } from "@/lib/learning/lease";

export async function runIntradayOnce(holder: string): Promise<number> {
  try {
    const outcome = await withCycleLease(holder, () => runIntradayPass(realIntradayDeps), path.resolve(process.cwd(), "marketpulse.db.intraday-lease"));
    const lines = outcome.acquired ? outcome.result!.map((r) => `  ${r.instrumentId}: ${r.action}`) : [`  skipped: ${outcome.blockedBy?.holder} holds the intraday lease`];
    if (lines.length) process.stdout.write(`[${holder}] ${new Date().toISOString()}\n${lines.join("\n")}\n`);
    return 0;
  } catch (caught) {
    process.stderr.write(`[${holder}] failed: ${caught instanceof Error ? caught.message : String(caught)}\n`);
    return 1;
  } finally {
    closeDatabase();
  }
}
