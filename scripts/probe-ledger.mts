import fs from "node:fs";
import path from "node:path";

/**
 * One-shot verification probe for item 13, run on a COPY of the owner's database.
 *
 * Proves the production scenario end to end: orb_nse_5m over the canonical store yields its
 * trades from a fingerprinted snapshot, the experiment persists, and the ledger reopens with
 * byte-identical trades. The real marketpulse.db is never opened for writing.
 */

const source = path.join(process.cwd(), "marketpulse.db");
const copy = path.join(process.cwd(), ".backups", "probe-ledger-copy.db");
fs.mkdirSync(path.dirname(copy), { recursive: true });
fs.copyFileSync(source, copy);
for (const suffix of ["-wal", "-shm"]) {
  if (fs.existsSync(source + suffix)) fs.copyFileSync(source + suffix, copy + suffix);
  else if (fs.existsSync(copy + suffix)) fs.rmSync(copy + suffix);
}
process.env.MARKETPULSE_DB_PATH = copy;

const { getDb, schema } = await import("@/lib/db");
const { inspectTrades } = await import("@/lib/backtest/inspect");
const { latestExperiment, recordExperiment, snapshotFromStore } = await import("@/lib/research-data/snapshot");
const { COMPILER_VERSION, StrategyDslSchema } = await import("@/lib/strategy/dsl");

const spec = getDb().select().from(schema.strategySpecs).all().find((row) => row.name === "orb_nse_5m");
if (!spec) throw new Error("orb_nse_5m not found");
const dsl = StrategyDslSchema.parse(JSON.parse(spec.dsl));

const snapshot = snapshotFromStore(dsl.universe.market, dsl.universe.resolution, "probe");
if (!snapshot.ok) throw new Error(`snapshot refused: ${snapshot.message}`);
console.log(`snapshot ${snapshot.snapshotId} fp=${snapshot.fingerprint} bars=${snapshot.barCount} instruments=${snapshot.instruments.length}`);

const report = inspectTrades(spec.name, dsl, snapshot.dataset);
if (!report.ok) throw new Error(`inspect refused: ${report.message}`);
console.log(`fresh: ${report.trades.length} trades — ${report.summary}`);

recordExperiment({
  specId: spec.id,
  snapshotId: snapshot.snapshotId,
  kind: "inspection",
  engineVersion: COMPILER_VERSION,
  executionProfileId: report.execution?.profileId ?? null,
  summary: report.summary,
  trades: report.trades,
  actor: "probe",
});

const reopened = latestExperiment(spec.id);
if (!reopened) throw new Error("ledger empty after record");
const identical = JSON.stringify(reopened.trades) === JSON.stringify(report.trades);
console.log(`ledger: ${reopened.trades.length} trades, experiment ${reopened.experiment.id}, identical=${identical}`);
if (!identical || reopened.trades.length !== report.trades.length) throw new Error("LEDGER DRIFT");
console.log("PROBE OK");
