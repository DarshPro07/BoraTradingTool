/**
 * Ingest NSE sector classification (owner directive 2026-08-16).
 *
 * Source: NSE index constituent files, which carry an `Industry` column beside the ISIN —
 * probed from this machine on 2026-08-16 and recorded in docs/external/nse-sector-classification.md.
 * Matching is by ISIN against the security master; an ISIN the master does not know is never
 * written, and sector is never inferred from a company name.
 *
 * Safe to re-run: an unchanged classification is left alone, a changed one supersedes by closing
 * the previous effective window rather than overwriting it.
 *
 * Usage:  npx tsx scripts/ingest-nse-sectors.mts
 *         (MARKETPULSE_DB_PATH selects the database; unset = the production marketpulse.db)
 */
import { ingestNseSectors } from "../lib/market/sector-classification";

const report = await ingestNseSectors({ actor: "owner:ingest-nse-sectors" });
console.log(`${report.code}: ${report.message}`);
if (!report.ok) process.exit(1);
