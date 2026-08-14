import fs from "node:fs";
import Database from "better-sqlite3";
import { expect, test } from "@playwright/test";
import { ensureLocalSession } from "./lib/session";

/**
 * Q1b desktop journey: the quant surface must EXPLAIN its numbers — estimator names, policy
 * versions, pinned assumptions, and honest unavailable-reasons. A 73-trade sample sits below the
 * tail policy's 100-observation floor, which makes this journey the living proof that an
 * unavailable metric renders its reason and never a zero.
 */

const DB_PATH = process.env.MARKETPULSE_E2E_DB_PATH;
const RUN_STAMP = Date.now().toString(36);
const SESSION_OPEN_UTC = Date.UTC(2026, 7, 3, 3, 45, 0) / 1000;

function headers(baseURL: string) {
  return { "content-type": "application/json", origin: baseURL, "x-marketpulse-mutation": "1" };
}

test.describe("quant analytics — metrics that explain themselves", () => {
  test.skip(!DB_PATH, "needs direct access to the server's database file");

  test.beforeAll(async () => {
    const base = process.env.MARKETPULSE_E2E_BASE_URL?.trim()
      || `http://127.0.0.1:${process.env.MARKETPULSE_E2E_PORT ?? 3100}`;
    await fetch(`${base}/api/research/hypotheses`).catch(() => undefined);
    for (let attempt = 0; attempt < 20 && !fs.existsSync(DB_PATH!); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    // 5m bars for the analytics fixture strategy (dedicated instrument, run-stamp-independent).
    const db = new Database(DB_PATH!);
    try {
      const existing = db
        .prepare("SELECT COUNT(*) AS n FROM price_candles WHERE ticker = 'IN:XNSE:HDFCBANK' AND resolution = '5'")
        .get() as { n: number };
      if (existing.n < 300) {
        const insert = db.prepare(
          "INSERT INTO price_candles (ticker, resolution, time, open, high, low, close, volume) VALUES ('IN:XNSE:HDFCBANK', '5', ?, ?, ?, ?, ?, 1000)",
        );
        const all = db.transaction(() => {
          let price = 100;
          for (let session = 0; session < 4; session += 1) {
            for (let bar = 0; bar < 75; bar += 1) {
              price += 0.3;
              insert.run(SESSION_OPEN_UTC + session * 86_400 + bar * 300, price - 0.1, price + 0.5, price - 0.5, price);
            }
          }
        });
        all();
      }
    } finally {
      db.close();
    }
  });

  test("registry, side-by-side Sharpe with estimator, policy-versioned tail refusal, pinned assumptions", async ({
    page,
    request,
    baseURL,
  }, testInfo) => {
    test.skip(testInfo.project.name.includes("mobile"), "mission policy: desktop-only Playwright");
    test.setTimeout(120_000);

    await ensureLocalSession(request);

    // A strategy whose inspection experiment provides the recorded returns.
    const name = `e2e_quant_${RUN_STAMP}`;
    const authored = await request.post("/api/strategy/author", {
      headers: headers(baseURL!),
      data: {
        dsl: {
          name,
          universe: { market: "NSE", maxPositions: 4, resolution: "5m" },
          entry: { feature: "minutes_since_open", op: "gte", value: 15 },
          exit: { stopLossPct: 0.5, takeProfitPct: 1 },
          sizing: { maxPositionPct: 25 },
          costs: { commissionBps: 5, slippageBps: 7, assumedSpreadBps: 5 },
        },
        createdBy: "e2e",
      },
    });
    expect(authored.status()).toBe(201);
    const specId = (await authored.json()).id as string;
    const inspected = await request.post("/api/strategy/trades", {
      headers: headers(baseURL!),
      data: { specId },
    });
    expect(inspected.status()).toBe(200);

    await page.goto("/strategies?market=NSE", { waitUntil: "domcontentloaded" });

    // The registry, with conventions visible — EWMA's λ convention is stated, not implied.
    const registry = page.getByTestId("quant-indicators");
    await expect(registry).toBeVisible();
    await expect(registry).toContainText(/ewma/);
    await expect(registry).toContainText(/warmup/);
    await expect(registry.getByTestId("quant-indicator-row").filter({ hasText: "vwap" })).toContainText(/requires sessionStarts/);

    // Analyze the recorded experiment.
    await page.getByTestId("quant-spec").selectOption({ label: name });
    await page.getByTestId("quant-run").click();
    const metrics = page.getByTestId("quant-metrics");
    await expect(metrics).toBeVisible();

    // Both Sharpes side by side, the adjusted one naming its estimator and lags.
    const sharpe = page.getByTestId("quant-sharpe");
    await expect(sharpe).toContainText(/naive √t/);
    await expect(sharpe).toContainText(/serial-adjusted/);
    // Two honest outcomes, both first-class: the estimator computed (and names itself), or it
    // REFUSED because the aggregation variance went non-positive — with the reason on screen.
    const sharpeText = await sharpe.innerText();
    if (/serial-adjusted: unavailable/.test(sharpeText)) {
      await expect(page.getByTestId("quant-unavailable")).toContainText(/non-positive|fabricated ratio/);
    } else {
      await expect(sharpe).toContainText(/lo2002_empirical_autocovariance/);
    }

    // Dataset identity travels with the numbers.
    await expect(metrics).toContainText(/dataset dss_/);

    // Tails carry the POLICY VERSION either way; below the floor they refuse with the stated
    // reason, above it they compute — and an unavailable metric NEVER renders as a zero.
    const tails = page.getByTestId("quant-tails");
    await expect(tails).toContainText(/rmp-2026-08-10.1/);
    const tailsText = await tails.innerText();
    if (/VaR95 historical: unavailable/.test(tailsText)) {
      await expect(page.getByTestId("quant-unavailable")).toContainText(/stated policy/);
    } else {
      expect(tailsText).toMatch(/VaR95 historical: -?\d/);
      expect(tailsText).not.toMatch(/VaR95 historical: 0.0000/);
    }

    // Pinned assumptions: id@version#hash, including the honestly-renamed estimator.
    const assumptions = page.getByTestId("quant-assumptions");
    await expect(assumptions).toContainText(/serial_adjusted_sharpe@1.1#/);
    await expect(assumptions).toContainText(/normal_var@/);
  });
});
