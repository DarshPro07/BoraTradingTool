/**
 * Synchronize the current official NSE main-board and SME security lists.
 *
 * Usage: npx tsx scripts/sync-nse-security-master.mts
 *
 * The service validates both complete documents before changing the current universe. A network,
 * parse, or row-count failure records a failed attempt and retains the last verified master.
 */
import { closeDatabase } from "@/lib/db";
import { syncOfficialNseSecurityMaster } from "@/lib/market/security-master-bootstrap";

try {
  const result = await syncOfficialNseSecurityMaster({
    actor: "nse-security-master-script",
  });
  if (!result.ok) {
    console.error(`${result.errorCode}: ${result.message}`);
    process.exitCode = 1;
  } else {
    console.log(
      `NSE security master ${result.syncId}: ${result.totalRows} verified listings ` +
        `(${result.mainRows} main, ${result.smeRows} SME, ${result.etfRows} ETF, ` +
          `${result.reitRows} REIT, ${result.invitRows} InvIT).`,
    );
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
} finally {
  closeDatabase();
}
