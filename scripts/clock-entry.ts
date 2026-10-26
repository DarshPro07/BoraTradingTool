/**
 * The cloud clock (docs/plans/cloud-clock), run by `.github/workflows/clock.yml` on a GitHub runner.
 *
 * `run` restores the sealed ledger, then:
 * - in the session window, IN1 every minute and the slim cycle (square-off, fund pass, coverage)
 *   every 15, the same code the laptop's two tasks run, for at most 5 h 25 min;
 * - outside it, the slim cycle once.
 * It saves the sealed ledger whenever the ledger changed, at least every 10 minutes, and at exit.
 *
 * `watchdog` restores a read-only copy and fails when the clock is dead, blind or short of a decision.
 *
 * Public output is status lines only: the repository is public, and so are its Actions logs.
 * Decisions and fills go to the sealed logs. A data source that stops answering is a failure, not
 * a quiet day: the run ends red, which emails the owner, and `lastDataOkAt` stops advancing.
 */
import fs from "node:fs";
import path from "node:path";
import { closeDatabase, getDb } from "@/lib/db";
import { realFundDeps } from "@/lib/fund/deps";
import { fundOsHealth } from "@/lib/fund/health";
import { runFundPass } from "@/lib/fund/run";
import { recordSessionCoverage, runLog } from "@/lib/intraday/coverage";
import { INTRADAY_LEASE, intradayLeaseFile, realIntradayDeps } from "@/lib/intraday/deps";
import { ORB_CONTRACT, readOrb, runIntradayPass } from "@/lib/intraday/orb";
import { withCycleLease } from "@/lib/learning/lease";
import { openBundle, sealBundle, type LedgerMeta } from "@/lib/ledger/bundle";
import { DAYS_TAG, dispatchClock, downloadAsset, ensureStateRelease, getStateRelease, latestStateAsset, restoreSource, uploadDaySnapshot, uploadState, type GitHub, type Release } from "@/lib/ledger/release";
import { clockPlan, daySnapshotDue, inMarketHours, isSessionDay, istParts, MAX_HANDOVERS, nextChain, nextPassAt } from "@/lib/ledger/schedule";
import { parseInstrument } from "@/lib/market/instruments";
import { getNormalizedQuote } from "@/lib/market/service";
import { squareOffIntradayPaper } from "@/lib/paper/service";

const FILES = { db: "marketpulse.db", intraday: "intraday.log", cycle: "cycle.log" } as const;
const HEARTBEAT_MS = 10 * 60_000;

const say = (line: string) => console.log(`[clock] ${line}`);
const message = (caught: unknown) => (caught instanceof Error ? caught.message.split("\n")[0]! : String(caught));
const hhmm = (at: Date) => new Date(at.getTime() + 330 * 60_000).toISOString().slice(11, 16);
const need = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

interface State {
  gh: GitHub;
  key: string;
  dir: string;
  meta: LedgerMeta;
  release: Release | null;
  signature: string;
  savedAt: number;
}

/**
 * The hand-over record in git: a cutover commits `ledger/seed-<epoch>.bin`, a promote commits
 * `ledger/promoted-<epoch>`. Once the cloud has saved after a seed, the release is newer than it.
 */
function newest(kind: "seed" | "promoted"): { epoch: number; file: string } | null {
  const dir = path.resolve("ledger");
  const pattern = kind === "seed" ? /^seed-(\d+)\.bin$/ : /^promoted-(\d+)$/;
  let best: { epoch: number; file: string } | null = null;
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const match = pattern.exec(name);
    if (match && (!best || Number(match[1]) > best.epoch)) best = { epoch: Number(match[1]), file: path.join(dir, name) };
  }
  return best;
}

async function restore(gh: GitHub, key: string, dir: string, writable: boolean): Promise<{ meta: LedgerMeta; release: Release | null }> {
  const seed = newest("seed");
  const promoted = newest("promoted");
  // The laptop took the ledger back after the last cutover: resuming the cloud's copy would trade
  // on a stale fork of the record.
  if (promoted && (!seed || promoted.epoch > seed.epoch)) throw new Error("the laptop took the ledger back (ledger/promoted-*): run `node scripts/ledger.mjs cutover` again");
  const release = await getStateRelease(gh);
  const published = latestStateAsset(release);
  const fromSeed = restoreSource(seed?.epoch ?? null, published?.epoch ?? null, Date.now()) === "seed";
  const sealed = fromSeed ? fs.readFileSync(seed!.file) : await downloadAsset(gh, published!.asset);
  const source = fromSeed ? `seed ${seed!.epoch}` : `release ${published!.epoch}`;
  const bundle = openBundle(sealed, key);
  if (bundle.meta.writer !== "cloud") throw new Error("this ledger was not handed to the cloud");
  for (const name of Object.values(FILES)) fs.writeFileSync(path.join(dir, name), bundle.files[name] ?? Buffer.alloc(0));
  say(`restored the ledger from the ${source} (saved ${bundle.meta.writtenAt})`);
  return { meta: bundle.meta, release: writable ? (release ?? (await ensureStateRelease(gh))) : release };
}

/**
 * What changes when the ledger does: a decision, a fill, a coverage row. Not quote caching and not
 * the logs, which grow every minute: they ride along with the 10-minute heartbeat.
 */
function ledgerSignature(): string {
  const row = getDb()
    .$client.prepare(
      "SELECT (SELECT coalesce(max(id), 0) FROM audit_events) AS audit, (SELECT count(*) FROM paper_orders) AS orders, (SELECT count(*) FROM crypto_paper_orders) AS crypto",
    )
    .get() as { audit: number; orders: number; crypto: number };
  return [row.audit, row.orders, row.crypto].join(":");
}

/** The sealed bytes just uploaded, or null when a heartbeat had nothing to save. */
async function save(state: State, final: boolean): Promise<Buffer | null> {
  const signature = ledgerSignature();
  if (!final && signature === state.signature && Date.now() - state.savedAt < HEARTBEAT_MS) return null;
  const snapshot = path.join(state.dir, "snapshot.db");
  fs.rmSync(snapshot, { force: true });
  getDb().$client.prepare("VACUUM INTO ?").run(snapshot); // a consistent copy while the database stays open
  const epoch = Math.max(Date.now(), state.meta.epoch + 1);
  const meta: LedgerMeta = { ...state.meta, epoch, writtenAt: new Date().toISOString(), final, runId: process.env.GITHUB_RUN_ID ?? null };
  const files = {
    [FILES.db]: fs.readFileSync(snapshot),
    [FILES.intraday]: fs.readFileSync(path.join(state.dir, FILES.intraday)),
    [FILES.cycle]: fs.readFileSync(path.join(state.dir, FILES.cycle)),
  };
  const sealed = sealBundle({ meta, files }, state.key);
  await uploadState(state.gh, state.release!, epoch, sealed);
  state.meta = meta;
  state.signature = signature;
  state.savedAt = Date.now();
  return sealed;
}

/** IN1's minute, logged in the laptop task's format so the coverage step reads it unchanged. */
async function intradayMinute(state: State, now: Date): Promise<void> {
  const log = path.join(state.dir, FILES.intraday);
  try {
    const outcome = await withCycleLease("cloud-intraday", () => runIntradayPass(realIntradayDeps, now), intradayLeaseFile(), INTRADAY_LEASE);
    fs.appendFileSync(log, runLog("cloud-intraday", new Date(), outcome));
  } catch (caught) {
    fs.appendFileSync(log, `[cloud-intraday] ${new Date().toISOString()} error: ${message(caught)}\n`);
  }
}

/** The part of the laptop's cycle the paper evidence needs; the research stays on the laptop. */
async function slimCycle(state: State, now: Date): Promise<number> {
  const lines: string[] = [];
  let failed = 0;
  const step = async (name: string, run: () => Promise<void> | void) => {
    try {
      await run();
    } catch (caught) {
      failed += 1;
      lines.push(`${name} failed: ${message(caught)}`);
    }
  };
  await step("square-off", async () => {
    const squared = await squareOffIntradayPaper(now);
    if (squared.closed > 0) lines.push(`square-off closed ${squared.closed}`);
    for (const carried of squared.carried) lines.push(`square-off could not close ${carried.instrumentId} (${carried.reason})`);
  });
  await step("fund", async () => {
    for (const pass of await runFundPass(realFundDeps, now)) {
      const parts = [
        pass.decided && `decided ${pass.decided.date} ${pass.decided.hold ? "HOLD" : "OUT"}`,
        pass.executed && `${pass.executed.side} ${pass.executed.status}${pass.executed.reason ? ` (${pass.executed.reason})` : ""}`,
        pass.marked > 0 && `marked ${pass.marked}`,
        pass.killed && "KILLED",
      ].filter(Boolean);
      if (parts.length > 0) lines.push(`fund ${pass.mandate}: ${parts.join(", ")}`);
      if (pass.note) lines.push(`fund ${pass.mandate}: ${pass.note}`);
    }
  });
  await step("coverage", () => {
    for (const row of recordSessionCoverage(fs.readFileSync(path.join(state.dir, FILES.intraday), "utf8"), now)) lines.push(`coverage ${row}`);
  });
  // The cycle and agent checks read laptop work the cloud never does; only IN1's apply here.
  await step("health", () => {
    for (const check of fundOsHealth(now)) if (!check.ok && check.name.startsWith("intraday")) lines.push(`health ${check.name}: ${check.detail}`);
  });
  fs.appendFileSync(path.join(state.dir, FILES.cycle), `[cloud-cycle] ${now.toISOString()}\n${lines.map((line) => `  ${line}\n`).join("")}`);
  return failed;
}

/** A live quote for IN1's first name: in market hours, STALE or UNAVAILABLE means the source stopped answering. */
async function dataOk(): Promise<boolean> {
  try {
    const quality = (await getNormalizedQuote(parseInstrument(ORB_CONTRACT.universe[0]))).provenance.quality;
    return !["STALE", "UNAVAILABLE", "CONFLICTED"].includes(quality);
  } catch {
    return false;
  }
}

/** GitHub sends SIGINT, then SIGTERM, on a cancel or a timeout: stop the work and let the final save run. */
let stopping = false;

async function runSession(state: State, deadline: Date): Promise<number> {
  let blind = 0;
  let alarmed = false;
  let lastCycle = 0;
  let lastCheck = 0;
  let first = true;
  while (!stopping && Date.now() < deadline.getTime()) {
    // The first pass runs at once and the last hands over at once (nextPassAt), so a hand-over
    // between two runs leaves the shortest gap; the others wait for the next minute.
    if (!first) {
      const next = nextPassAt(Date.now(), deadline.getTime());
      if (next === null) break;
      while (!stopping && Date.now() < next) await new Promise((resolve) => setTimeout(resolve, Math.min(1_000, next - Date.now())));
      if (stopping) break;
    }
    first = false;
    const now = new Date();
    await intradayMinute(state, now);
    if (now.getTime() - lastCycle >= 15 * 60_000 - 5_000) {
      const failed = await slimCycle(state, now);
      lastCycle = now.getTime();
      say(`${hhmm(now)} IST: minute pass and slim cycle${failed ? `, ${failed} step(s) failed (in the sealed log)` : ""}`);
    }
    if (inMarketHours(now) && now.getTime() - lastCheck >= 5 * 60_000 - 5_000) {
      lastCheck = now.getTime();
      if (await dataOk()) {
        blind = 0;
        state.meta.lastDataOkAt = now.toISOString();
      } else if (++blind === 5) {
        alarmed = true;
        say("DATA FAILING: 5 checks in a row without a live quote");
      }
    }
    try {
      await save(state, false);
    } catch (caught) {
      say(`save failed: ${message(caught)}`);
    }
  }
  return alarmed ? 1 : 0;
}

function watchdog(meta: LedgerMeta, now: Date): number {
  const { day, minute } = istParts(now);
  const ago = (iso: string | null) => (iso ? Math.round((now.getTime() - Date.parse(iso)) / 60_000) : null);
  const failures: string[] = [];
  const session = isSessionDay(day);
  if (session && minute >= 9 * 60 + 30 && minute <= 15 * 60 + 42) {
    const saved = ago(meta.writtenAt);
    const data = ago(meta.lastDataOkAt);
    if (saved === null || saved > 15) failures.push(`the ledger was last saved ${saved ?? "never"} min ago`);
    if (data === null || data > 20) failures.push(`no usable live quote for ${data ?? "ever"} min`);
  }
  if (session && minute >= 9 * 60 + 30) {
    const decided = readOrb("decision").filter((d) => d.day === day).length;
    if (decided < ORB_CONTRACT.universe.length) failures.push(`${decided}/${ORB_CONTRACT.universe.length} IN1 decisions today`);
  }
  if (session && minute >= 15 * 60 + 50) {
    const row = getDb().$client.prepare("SELECT detail FROM audit_events WHERE decision IN ('allowed') AND action = 'session_coverage' AND subject = ?").get(`coverage:${day}`) as
      | { detail: string }
      | undefined;
    if (!row) failures.push(`no coverage row for ${day}`);
    else say(`coverage ${day}: ${(JSON.parse(row.detail) as { coverage: string }).coverage}`);
  }
  say(failures.length ? `WATCHDOG FAILED: ${failures.join("; ")}` : `watchdog ok (${day} ${hhmm(now)} IST, saved ${meta.writtenAt})`);
  return failures.length ? 1 : 0;
}

export async function runCloudClock(command: string): Promise<number> {
  if (command !== "run" && command !== "watchdog") {
    say("usage: node scripts/clock.mjs run|watchdog");
    return 2;
  }
  const gh: GitHub = { repo: need("GITHUB_REPOSITORY"), token: need("GITHUB_TOKEN") };
  if (command === "watchdog" && process.env.CLOUD_WRITER !== "true") {
    // Off can be on purpose (a promote). Not after a cutover: the laptop has stopped writing, and
    // a seed no run has consumed means nobody records the clock.
    const seed = newest("seed");
    const promoted = newest("promoted");
    const published = latestStateAsset(await getStateRelease(gh));
    const waiting = seed && (!promoted || seed.epoch > promoted.epoch) && (!published || seed.epoch > published.epoch);
    say(waiting ? "WATCHDOG FAILED: a cutover seed is waiting, but CLOUD_WRITER is not true: nobody records the clock" : "the cloud clock is off (CLOUD_WRITER is not true)");
    return waiting ? 1 : 0;
  }
  const key = need("LEDGER_KEY");
  const dir = path.join(need("RUNNER_TEMP"), "ledger");
  fs.mkdirSync(dir, { recursive: true });
  process.env.MARKETPULSE_DB_PATH = path.join(dir, FILES.db); // before the first getDb()
  const stop = () => {
    stopping = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  // Nothing was restored, so there is nothing to save: the run fails loudly instead.
  const { meta, release } = await restore(gh, key, dir, command === "run");
  if (command === "watchdog") {
    try {
      return watchdog(meta, new Date());
    } finally {
      closeDatabase();
    }
  }
  const state: State = { gh, key, dir, meta, release, signature: "", savedAt: 0 };
  const plan = clockPlan(new Date());
  let code = 0;
  try {
    if (plan.mode === "session") {
      say(`session run until ${hhmm(plan.deadline)} IST${process.env.CLOCK_FROM_RUN ? ` (hand-over ${process.env.CLOCK_CHAIN} from run ${process.env.CLOCK_FROM_RUN})` : ""}`);
      code = await runSession(state, plan.deadline);
      // Queued now, it starts the moment this job ends: no wait on a cron GitHub runs hours late.
      // Not after a cancel or timeout (stopping): a cancel means stop.
      if (plan.handOver && !stopping) {
        const chain = nextChain(Number(process.env.CLOCK_CHAIN) || 0);
        try {
          if (chain === null) say(`hand-over cap (${MAX_HANDOVERS}) reached: no run queued, the crons are the fallback`);
          else {
            await dispatchClock(gh, chain, process.env.GITHUB_RUN_ID ?? "");
            say(`handed the session on: hand-over ${chain} queued`);
          }
        } catch (caught) {
          say(`hand-over failed, the crons are the fallback: ${message(caught)}`);
        }
      }
    } else {
      say("outside the session window: the slim cycle once");
      if ((await slimCycle(state, new Date())) > 0) say("a slim-cycle step failed (in the sealed log)");
    }
  } finally {
    try {
      const sealed = await save(state, true);
      say("saved the ledger");
      const now = new Date();
      if (sealed && daySnapshotDue(now)) {
        try {
          const day = istParts(now).day;
          const days = await ensureStateRelease(gh, DAYS_TAG);
          say((await uploadDaySnapshot(gh, days, day, sealed)) ? `uploaded the ${day} day snapshot` : `the ${day} day snapshot is already there`);
        } catch (caught) {
          say(`day snapshot failed (the save stands): ${message(caught)}`);
        }
      }
    } catch (caught) {
      say(`FINAL SAVE FAILED: ${message(caught)}`);
      code = 1;
    }
    closeDatabase();
  }
  return code;
}
