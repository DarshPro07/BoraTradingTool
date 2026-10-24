/**
 * The owner's side of the cloud clock (docs/plans/cloud-clock), run on the laptop:
 *
 *   node scripts/ledger.mjs status    who writes the ledger, and the cloud's last save
 *   node scripts/ledger.mjs cutover   hand the ledger to the cloud: this machine stops writing it,
 *                                     and a sealed seed is written under ledger/ to commit and push
 *   node scripts/ledger.mjs pull      import the cloud's newest ledger now (each cycle does this too)
 *   node scripts/ledger.mjs promote --cloud-is-off
 *                                     take the ledger back, after CLOUD_WRITER is false on GitHub
 *
 * Paper only: nothing here reaches a broker.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDatabase, databasePath } from "@/lib/db";
import { ledgerKey, openBundle, sealBundle, type LedgerMeta } from "@/lib/ledger/bundle";
import { pullCloudLedger } from "@/lib/ledger/pull";
import { DEFAULT_REPO, downloadAsset, getStateRelease, latestStateAsset } from "@/lib/ledger/release";
import { buildSlimLedger } from "@/lib/ledger/seed";
import { ledgerOwnedByCloud, setLedgerWriter } from "@/lib/ledger/writer";

const gh = { repo: process.env.LEDGER_REPO ?? DEFAULT_REPO };
const say = (line: string) => process.stdout.write(`${line}\n`);

async function cloudMeta(key: string): Promise<LedgerMeta | null> {
  const latest = latestStateAsset(await getStateRelease(gh));
  return latest ? openBundle(await downloadAsset(gh, latest.asset), key).meta : null;
}

async function cutover(main: string, key: string): Promise<number> {
  if (ledgerOwnedByCloud(main)) {
    say("The cloud already owns the ledger. `promote` first to take it back.");
    return 1;
  }
  // First, so nothing here can write a decision after the seed is taken.
  setLedgerWriter(main, "cloud");
  const slim = path.join(os.tmpdir(), `marketpulse-seed-${Date.now()}.db`);
  try {
    const { counts, maxAuditId } = buildSlimLedger(main, slim);
    const epoch = Date.now();
    const now = new Date().toISOString();
    const log = path.resolve("logs", "intraday.log");
    const sealed = sealBundle(
      {
        meta: { epoch, writtenAt: now, writer: "cloud", seedMaxAuditId: maxAuditId, seededAt: now, lastDataOkAt: null, final: true, runId: null },
        // The laptop's minute log too: a session it ran but has not yet written coverage for stays COVERED.
        files: { "marketpulse.db": fs.readFileSync(slim), "intraday.log": fs.existsSync(log) ? fs.readFileSync(log) : Buffer.alloc(0), "cycle.log": Buffer.alloc(0) },
      },
      key,
    );
    fs.mkdirSync("ledger", { recursive: true });
    const seed = path.join("ledger", `seed-${epoch}.bin`);
    fs.writeFileSync(seed, sealed);
    say(`Sealed ${seed} (${Math.round(sealed.length / 1024)} KB): ${Object.entries(counts).map(([t, n]) => `${t} ${n}`).join(", ")}.`);
    say("This machine no longer writes the paper ledger. Next: commit and push the seed, then set the repository");
    say("variable CLOUD_WRITER to true on GitHub. Until both are done, nobody records the clock.");
    return 0;
  } catch (caught) {
    setLedgerWriter(main, "local"); // nothing was handed over
    throw caught;
  } finally {
    fs.rmSync(slim, { force: true });
  }
}

async function promote(main: string, key: string, acknowledged: boolean): Promise<number> {
  if (!ledgerOwnedByCloud(main)) {
    say("This machine already writes the ledger.");
    return 1;
  }
  if (!acknowledged) {
    say("First set CLOUD_WRITER to false on GitHub (Settings > Secrets and variables > Actions > Variables), so no");
    say("new cloud run starts. Then: node scripts/ledger.mjs promote --cloud-is-off");
    return 1;
  }
  const latest = latestStateAsset(await getStateRelease(gh));
  const bundle = latest ? openBundle(await downloadAsset(gh, latest.asset), key) : null;
  const minutes = bundle ? Math.round((Date.now() - Date.parse(bundle.meta.writtenAt)) / 60_000) : null;
  if (bundle && !bundle.meta.final && minutes !== null && minutes < 15) {
    say(`A cloud run is still writing (last save ${minutes} min ago). Wait for the Clock run on GitHub to finish.`);
    return 1;
  }
  say(await pullCloudLedger(gh, main));
  // The cloud's minute log since the cutover, so a session it ran but had not yet written coverage
  // for is judged from its heartbeats, not from this machine's idle lines.
  if (bundle) {
    const since = Date.parse(bundle.meta.seededAt);
    let keep = false;
    const lines = bundle.files["intraday.log"]!.toString("utf8").split("\n").filter((line) => {
      const header = /^\[[^\]]+\] (\S+Z) /.exec(line);
      if (header) keep = Date.parse(header[1]!) > since;
      return keep && line.length > 0;
    });
    if (lines.length) fs.appendFileSync(path.resolve("logs", "intraday.log"), `${lines.join("\n")}\n`);
  }
  // The hand-over record: once this is pushed, a cloud run refuses to resume its stale copy.
  fs.mkdirSync("ledger", { recursive: true });
  fs.writeFileSync(path.join("ledger", `promoted-${Date.now()}`), "");
  setLedgerWriter(main, "local");
  say("This machine writes the paper ledger again. Commit and push ledger/promoted-*, so no cloud run resumes.");
  return 0;
}

export async function runLedger(command: string, flags: readonly string[]): Promise<number> {
  const main = databasePath();
  const key = ledgerKey();
  if (!key && command !== "status") {
    say("LEDGER_KEY is not in .env.local. Run: powershell -ExecutionPolicy Bypass -File scripts\\new-ledger-key.ps1");
    return 1;
  }
  try {
    switch (command) {
      case "status": {
        say(`The paper ledger is written by: ${ledgerOwnedByCloud(main) ? "the cloud clock" : "this machine"}.`);
        const meta = key ? await cloudMeta(key) : null;
        say(meta ? `Cloud ledger: saved ${meta.writtenAt}${meta.final ? " (run finished)" : " (run active)"}; last live quote ${meta.lastDataOkAt ?? "never"}.` : "No cloud ledger readable (none published, or no LEDGER_KEY).");
        return 0;
      }
      case "cutover":
        return await cutover(main, key!);
      case "pull":
        say(await pullCloudLedger(gh, main));
        return 0;
      case "promote":
        return await promote(main, key!, flags.includes("--cloud-is-off"));
      default:
        say("usage: node scripts/ledger.mjs status|cutover|pull|promote --cloud-is-off");
        return 2;
    }
  } catch (caught) {
    say(`${command} failed: ${caught instanceof Error ? caught.message : String(caught)}`);
    return 1;
  } finally {
    closeDatabase();
  }
}
