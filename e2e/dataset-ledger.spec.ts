import fs from "node:fs";
import Database from "better-sqlite3";
import { expect, test } from "@playwright/test";
import { ensureLocalSession } from "./lib/session";

/**
 * The historical-research data contract, proven through the running server (item 13).
 *
 * The defect this guards: the store held 30,832 bars and a stored replay said 73 trades, while
 * the inspection API consulted the live provider's sliding window and said 0. Same question, two
 * datasets, two answers. The contract: a first inspection builds a dataset snapshot from the
 * canonical store and persists an experiment + trade ledger; every later inspection serves that
 * ledger, byte for byte, with provenance — never a fresh provider window.
 *
 * These tests seed the server's own database file directly (the path playwright.config claims
 * only when it actually matches the server under test), author a strategy through the real door,
 * and watch the answer stay identical across calls, reloads, and an explicit rerun.
 */

const DB_PATH = process.env.MARKETPULSE_E2E_DB_PATH;

/** Unique per run AND per project: reruns against a kept database must never collide on 409. */
const RUN_STAMP = Date.now().toString(36);

/** 09:15 IST on Monday 2026-08-03, as unix seconds. 75 five-minute bars end 15:25 IST. */
const SESSION_OPEN_UTC = Date.UTC(2026, 7, 3, 3, 45, 0) / 1000;
const BARS_PER_SESSION = 75;
const SESSIONS = 4;
const TICKER = "IN:XNSE:RELIANCE";

function seedCanonicalStore(): void {
  const db = new Database(DB_PATH!);
  try {
    // Guard EACH resolution separately: on a shared acceptance database another spec may already
    // have supplied the DAILY history (ingestion sweep / journey seeding) while the 5-minute bars
    // are still missing — a single 5-minute guard then blind-inserted daily rows into a store that
    // already had them and died on the primary key.
    const already5 = db
      .prepare("SELECT COUNT(*) AS n FROM price_candles WHERE ticker = ? AND resolution = '5'")
      .get(TICKER) as { n: number };
    const alreadyDaily = db
      .prepare("SELECT COUNT(*) AS n FROM price_candles WHERE ticker = ? AND resolution = 'D'")
      .get(TICKER) as { n: number };
    const need5 = already5.n < BARS_PER_SESSION * SESSIONS;
    const needDaily = alreadyDaily.n < 120;
    if (!need5 && !needDaily) return; // second project run: store already seeded

    const insert = db.prepare(
      "INSERT INTO price_candles (ticker, resolution, time, open, high, low, close, volume) VALUES (?, '5', ?, ?, ?, ?, ?, 1000)",
    );
    const daily = db.prepare(
      "INSERT INTO price_candles (ticker, resolution, time, open, high, low, close, volume) VALUES (?, 'D', ?, ?, ?, ?, ?, 1000)",
    );
    const all = db.transaction(() => {
      if (need5) {
        let price = 100;
        for (let session = 0; session < SESSIONS; session += 1) {
          const open = SESSION_OPEN_UTC + session * 86_400;
          for (let bar = 0; bar < BARS_PER_SESSION; bar += 1) {
            price += 0.4;
            insert.run(TICKER, open + bar * 300, price - 0.2, price + 0.6, price - 0.6, price);
          }
        }
      }
      // Daily history as well: the gauntlet provenance test authors a daily strategy, and its
      // snapshot must come from the same canonical store.
      if (needDaily) {
        for (let day = 0; day < 120; day += 1) {
          daily.run(TICKER, SESSION_OPEN_UTC - 200 * 86_400 + day * 86_400, 100, 102, 98, 100 + (day % 7));
        }
      }
    });
    all();
  } finally {
    db.close();
  }
}

function headers(baseURL: string) {
  return { "content-type": "application/json", origin: baseURL, "x-marketpulse-mutation": "1" };
}

const DSL = {
  universe: { market: "NSE", maxPositions: 4, resolution: "5m" },
  entry: { all: [{ feature: "minutes_since_open", op: "gte", value: 15 }] },
  exit: { stopLossPct: 0.5, takeProfitPct: 1 },
  sizing: { maxPositionPct: 25 },
  costs: { commissionBps: 5, slippageBps: 7, assumedSpreadBps: 5 },
};

test.describe("the experiment ledger — same question, same answer, forever", () => {
  test.skip(!DB_PATH, "needs direct access to the server's database file");

  test.beforeAll(async () => {
    // A brand-new server has not necessarily created its database yet — the readiness endpoint
    // does not touch it. Force a DB-backed request, then wait for the file, then seed. Skipping
    // on a missing file here silently hollowed out this whole suite once; never again.
    const base = process.env.MARKETPULSE_E2E_BASE_URL?.trim()
      || `http://127.0.0.1:${process.env.MARKETPULSE_E2E_PORT ?? 3100}`;
    await fetch(`${base}/api/research/hypotheses`).catch(() => undefined);
    for (let attempt = 0; attempt < 20 && !fs.existsSync(DB_PATH!); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!fs.existsSync(DB_PATH!)) {
      throw new Error(`Server database never appeared at ${DB_PATH} — refusing to run against nothing.`);
    }
    seedCanonicalStore();
  });

  test("a completed experiment reopens from its ledger, identically", async ({ request, baseURL }, testInfo) => {
    await ensureLocalSession(request);
    const name = `e2e_ledger_api_${RUN_STAMP}_${testInfo.project.name.replace(/[^a-z0-9]/gi, "_")}`;
    const authored = await request.post("/api/strategy/author", {
      headers: headers(baseURL!),
      data: { dsl: { ...DSL, name }, createdBy: "e2e" },
    });
    expect(authored.status()).toBe(201);
    const specId = (await authored.json()).id as string;

    // First call: a fresh experiment, built from the canonical store — and it says so.
    const fresh = await request.post("/api/strategy/trades", {
      headers: headers(baseURL!),
      data: { specId },
    });
    expect(fresh.status()).toBe(200);
    const freshBody = await fresh.json();
    expect(freshBody.servedFrom).toBe("fresh");
    expect(freshBody.trades.length).toBeGreaterThan(0);
    expect(freshBody.provenance.fingerprint).toBeTruthy();
    expect(freshBody.provenance.note).toMatch(/live provider was not consulted/i);

    // Second call: the ledger answers. Same experiment id, byte-identical trades, and provenance
    // that names the snapshot the evidence rests on.
    const reopened = await request.post("/api/strategy/trades", {
      headers: headers(baseURL!),
      data: { specId },
    });
    expect(reopened.status()).toBe(200);
    const reopenedBody = await reopened.json();
    expect(reopenedBody.servedFrom).toBe("ledger");
    expect(reopenedBody.experimentId).toBe(freshBody.experimentId);
    expect(reopenedBody.trades).toEqual(freshBody.trades);
    expect(reopenedBody.provenance.datasetSnapshotId).toBe(freshBody.provenance.datasetSnapshotId);
    expect(reopenedBody.provenance.note).toMatch(/cannot drift/i);

    // An explicit rerun against the unchanged store reproduces the same result — determinism is
    // the contract, and the idempotent experiment id proves nothing new was minted.
    const rerun = await request.post("/api/strategy/trades", {
      headers: headers(baseURL!),
      data: { specId, rerun: true },
    });
    expect(rerun.status()).toBe(200);
    const rerunBody = await rerun.json();
    expect(rerunBody.experimentId).toBe(freshBody.experimentId);
    expect(rerunBody.trades.length).toBe(freshBody.trades.length);
  });

  test("a gauntlet verdict is pinned to its snapshot, in the response AND the trial ledger", async ({ request, baseURL }, testInfo) => {
    await ensureLocalSession(request);
    // The professor path mints the family; the gauntlet then runs on a recorded snapshot and the
    // response, the selection trial and the experiment manifest must all name the same dataset.
    const title = `Ledger gap screen ${RUN_STAMP} ${testInfo.project.name}`;
    const posted = await request.post("/api/research/hypotheses", {
      headers: headers(baseURL!),
      data: {
        title,
        statement:
          "NSE liquid names gapping with gap >= 3% on relative volume >= 1.5 continue upward " +
          "intraday after realistic round-trip costs, because the opening imbalance persists.",
        market: "NSE",
      },
    });
    expect(posted.status()).toBe(201);
    const authored = (await posted.json()).authored as { specId: string } | null;
    expect(authored).not.toBeNull();

    const run = await request.post("/api/strategy/gauntlet", {
      headers: headers(baseURL!),
      data: { specId: authored!.specId, confirm: true },
    });
    expect(run.status()).toBe(200);
    const verdict = await run.json();
    expect(String(verdict.datasetSnapshotId)).toMatch(/^dss_/);
    expect(verdict.datasetFingerprint).toBeTruthy();

    // The same identity, persisted: trial rows and the experiment manifest agree with the response.
    const db = new Database(DB_PATH!);
    try {
      const trial = db
        .prepare("SELECT dataset_snapshot_id AS id FROM selection_trials WHERE strategy_spec_id = ?")
        .get(authored!.specId) as { id: string } | undefined;
      expect(trial?.id).toBe(verdict.datasetSnapshotId);
      const experiment = db
        .prepare("SELECT manifest FROM experiments WHERE strategy_spec_id = ? AND kind = 'gauntlet'")
        .get(authored!.specId) as { manifest: string } | undefined;
      expect(experiment).toBeDefined();
      const manifest = JSON.parse(experiment!.manifest);
      expect(manifest.datasetSnapshotId).toBe(verdict.datasetSnapshotId);
      expect(manifest.feeModelId).toBeTruthy();
      expect(manifest.marketCalendarVersion).toBeTruthy();
    } finally {
      db.close();
    }
  });

  test("the rehearsal ledger shows each verdict with the dataset it was judged on", async ({ page, baseURL }, testInfo) => {
    test.skip(testInfo.project.name.includes("mobile"), "one browser is proof");
    await ensureLocalSession(page.request);
    // The cycle writes these rows in production; seeding one directly tests the display contract.
    const specName = `e2e_rehearsal_row_${RUN_STAMP}`;
    const authored = await page.request.post("/api/strategy/author", {
      headers: headers(baseURL!),
      data: { dsl: { ...DSL, name: specName }, createdBy: "e2e" },
    });
    expect(authored.status()).toBe(201);
    const specId = (await authored.json()).id as string;
    const db = new Database(DB_PATH!);
    try {
      db.prepare(
        "INSERT OR REPLACE INTO rehearsal_outcomes (strategy_spec_id, verdict, reason, trades, instruments_evaluated, rehearsed_at, dataset_snapshot_id) VALUES (?, 'would_pass', 'e2e seeded', 40, 1, ?, 'dss_e2e_provenance')",
      ).run(specId, Math.floor(Date.now() / 1000));
    } finally {
      db.close();
    }

    await page.goto("/strategies?market=NSE", { waitUntil: "domcontentloaded" });
    const row = page.getByTestId("rehearsal-ledger-row").filter({ hasText: specName });
    await expect(row).toBeVisible();
    await expect(row).toContainText("dss_e2e_provenance");
  });

  test("the inspector UI serves ledger evidence without any live candle request", async ({ page, baseURL }, testInfo) => {
    test.skip(testInfo.project.name.includes("mobile"), "one browser is proof; the mobile layout is covered elsewhere");
    await ensureLocalSession(page.request);

    const name = `e2e_ledger_ui_${RUN_STAMP}_${testInfo.project.name.replace(/[^a-z0-9]/gi, "_")}`;
    const authored = await page.request.post("/api/strategy/author", {
      headers: headers(baseURL!),
      data: { dsl: { ...DSL, name }, createdBy: "e2e" },
    });
    expect(authored.status()).toBe(201);

    await page.goto("/strategies?market=NSE", { waitUntil: "domcontentloaded" });
    const select = page.getByTestId("inspect-spec");
    await expect(select).toBeVisible();
    await select.selectOption({ label: name });

    // First click builds the experiment from the store and says so.
    await page.getByTestId("inspect-run").click();
    const provenance = page.getByTestId("inspect-provenance");
    await expect(provenance).toBeVisible();
    await expect(provenance).toContainText(/FRESH EXPERIMENT/i);
    // The summary line alone: the fresh view also renders an execution-assumptions line that the
    // ledger view deliberately omits (assumptions were recorded at run time, not re-resolved).
    const summaryLine = page.getByTestId("inspect-result").locator("p").first();
    const freshSummary = await summaryLine.innerText();

    // Second click: the ledger. Capture the browser's network the whole time — displaying
    // completed evidence must need exactly one API call, and no candle/quote fetch of any kind.
    const requests: string[] = [];
    page.on("request", (req) => requests.push(req.url()));
    await page.getByTestId("inspect-run").click();
    await expect(provenance).toContainText(/stored ledger/i);

    const candleish = requests.filter((url) => /candle|quote|history|provider/i.test(url));
    expect(candleish).toEqual([]);

    // Item 14: clicking a trade opens its evidence with entry/exit drawn on store bars — the
    // chart names its source, and its bars must come from the canonical store, not a provider.
    await page.getByTestId("trade-row-0").click();
    await expect(page.getByTestId("trade-detail")).toBeVisible();
    await expect(page.getByTestId("trade-chart")).toBeVisible();
    await expect(page.getByTestId("trade-chart")).toContainText(/canonical candle store/i);
    await expect(page.getByTestId("trade-chart").locator("canvas").first()).toBeVisible();
    const chartish = requests.filter((url) => /candle|quote|history|provider/i.test(url) && !url.includes("/api/research-data/bars"));
    expect(chartish).toEqual([]);

    // Reload with provider-shaped requests BLOCKED (owner test 14): completed evidence must stay
    // fully usable when nothing resembling a candle/quote endpoint is reachable.
    await page.route(/candle|quote|history|provider/i, (route) => route.abort());
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("inspect-spec").selectOption({ label: name });
    await page.getByTestId("inspect-run").click();
    await expect(page.getByTestId("inspect-provenance")).toContainText(/stored ledger/i);
    const ledgerSummary = await page.getByTestId("inspect-result").locator("p").first().innerText();
    expect(ledgerSummary).toBe(freshSummary);
  });
});
