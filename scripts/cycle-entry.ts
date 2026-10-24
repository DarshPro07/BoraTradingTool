import fs from "node:fs";
import { runLearningCycle } from "@/lib/learning/cycle";
import { closeDatabase, databasePath } from "@/lib/db";
import { recordSessionCoverage } from "@/lib/intraday/coverage";
import { INTRADAY_LEASE, intradayLeaseFile, realIntradayDeps } from "@/lib/intraday/deps";
import { runIntradayPass } from "@/lib/intraday/orb";
import { withCycleLease } from "@/lib/learning/lease";
import { pullCloudLedger } from "@/lib/ledger/pull";
import { ledgerOwnedByCloud } from "@/lib/ledger/writer";

/**
 * One learning cycle, with no Next.js server and no browser.
 *
 * This is the driver that makes "it worked while I was away" literally true. `SystemPulse` only
 * runs while a tab is open, so closing the laptop stopped autonomy entirely — the badge said
 * LEARNING and nothing learned.
 *
 * Bundled by `scripts/cycle.mjs` because this file imports through the `@/` alias, which only
 * esbuild and Next resolve. Kept as TypeScript so it shares the exact code path the browser
 * driver uses rather than a parallel re-implementation that could drift.
 */
export async function runOneCycle(holder: string): Promise<number> {
  const startedAt = Date.now();
  if (ledgerOwnedByCloud(databasePath())) {
    // docs/plans/cloud-clock: the cloud clock runs IN1, the fund and coverage; this machine mirrors
    // its ledger so the reports, the MCP server and a later promote see the current record.
    try {
      process.stdout.write(`  cloud ledger: ${await pullCloudLedger()}\n`);
    } catch (caught) {
      process.stderr.write(`[${holder}] cloud ledger pull failed: ${caught instanceof Error ? caught.message : String(caught)}\n`);
    }
  } else {
    // EC-4: if the minute task is down, IN1's decisions are still recorded, at most one cycle late.
    // Decisions only, under the minute task's own lease. Its own try/catch: it never stops the cycle.
    try {
      const intraday = await withCycleLease(holder, () => runIntradayPass(realIntradayDeps, new Date(), { decideOnly: true }), intradayLeaseFile(), INTRADAY_LEASE);
      for (const r of intraday.result ?? []) process.stdout.write(`  intraday backstop: ${r.instrumentId}: ${r.action}\n`);
    } catch (caught) {
      process.stderr.write(`[${holder}] intraday backstop failed: ${caught instanceof Error ? caught.message : String(caught)}\n`);
    }
    // EC-1: after the close, one coverage row per session from logs/intraday.log.
    try {
      const log = fs.existsSync("logs/intraday.log") ? fs.readFileSync("logs/intraday.log", "utf8") : "";
      for (const row of recordSessionCoverage(log)) process.stdout.write(`  coverage: ${row}\n`);
    } catch (caught) {
      process.stderr.write(`[${holder}] coverage failed: ${caught instanceof Error ? caught.message : String(caught)}\n`);
    }
  }
  try {
    const report = await runLearningCycle(holder);

    if (report.blockedBy) {
      // Not an error. Another driver is doing the work, which is the lease behaving correctly.
      process.stdout.write(`[${holder}] skipped — ${report.blockedBy.holder} holds the lease\n`);
      return 0;
    }

    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    process.stdout.write(
      `[${holder}] ${report.mode} · ${report.actions.length} action(s) · ${seconds}s\n`,
    );
    for (const action of report.actions) process.stdout.write(`  · ${action}\n`);
    for (const skipped of report.skipped) process.stdout.write(`  ~ ${skipped}\n`);
    return 0;
  } catch (caught) {
    // A scheduled task that fails silently is worse than one that never ran, because the run log
    // will show a gap with no reason in it. Exit non-zero so Task Scheduler records the failure.
    process.stderr.write(`[${holder}] failed: ${caught instanceof Error ? caught.message : String(caught)}\n`);
    return 1;
  } finally {
    // Releases the SQLite handle and its WAL. A scheduled process that exits without closing
    // leaves the -shm and -wal files behind every fifteen minutes.
    closeDatabase();
  }
}
