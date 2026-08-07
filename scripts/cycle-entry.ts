import { runLearningCycle } from "@/lib/learning/cycle";
import { closeDatabase } from "@/lib/db";

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
