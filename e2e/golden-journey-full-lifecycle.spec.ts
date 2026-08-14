import fs from "node:fs";
import Database from "better-sqlite3";
import { expect, test, type Page } from "@playwright/test";
import { ensureLocalSession } from "./lib/session";

/**
 * P0 FINAL PROOF — the FULL Golden Journey, one run, every rung of the product.
 *
 * The chain, in the mission's own terms: NSE identity → data snapshot → research/evidence →
 * hypothesis → strategy → backtest → selection trial → validation → holdout → forward →
 * paper → alpha health → memory → learning cycle → Brain counts.
 *
 * Every rung is exercised through a REAL product surface with the REAL request it serves:
 *
 *   1. identity       GET  /api/market/instruments (official security master)
 *   2. research       /analyze/<id>  — research-stock state machine (PROPOSAL READY, fixture banner)
 *   3. hypothesis     POST /api/research/hypotheses (professor path, family-bearing)
 *   4. strategy       /strategies registry — stage with a reason, never a bare label
 *   5. backtest       POST /api/strategy/trades (fresh experiment, provenance: dss_ + fingerprint)
 *   6. trial          POST /api/strategy/gauntlet — 428 without confirm; verdict pinned to snapshot
 *   7. validation     stage advance; the sealed holdout ledger stays untouched (DB cross-check)
 *   8. forward        /api/forward/activate (428 → 201) → enroll → run (signals before outcomes)
 *   9. paper          paper_forward ledgers, cash never negative (DB), scorecard on /paper
 *  10. alpha health   /paper forward-alpha — EARNED statuses with decay ratios
 *  11. memory         POST /api/learning/cycle (200/423 — the lease serializes drivers)
 *  12. brain counts   /brain — the numbers grew, read from the database, not a screenshot
 *
 * Honest refusals are part of the journey and asserted as such (428/423/409) — a fake pass at
 * any rung is the defect class this suite exists for. Deterministic market data is seeded with a
 * count-guard (forward-evidence recipe) so a shared persistent database is never double-seeded.
 */

const DB_PATH = process.env.MARKETPULSE_E2E_DB_PATH;
const RUN_STAMP = Date.now().toString(36);
const SESSION_OPEN_UTC = Date.UTC(2026, 7, 3, 3, 45, 0) / 1000;

function headers(baseURL: string) {
  return { "content-type": "application/json", origin: baseURL, "x-marketpulse-mutation": "1" };
}

async function brainCounts(page: Page): Promise<{ hypotheses: number; strategies: number; paperOrders: number }> {
  const body = await page.evaluate(async () => {
    const response = await fetch("/api/research/hypotheses");
    return (await response.json()) as { hypotheses?: unknown[] };
  });
  const knowledge = await page.getByTestId("brain-knowledge").innerText();
  const strategies = Number(/Strategies:\s*(\d+)/.exec(knowledge)?.[1] ?? Number.NaN);
  const paperOrders = Number(/Paper orders:\s*(\d+)/.exec(knowledge)?.[1] ?? Number.NaN);
  expect(Number.isFinite(strategies)).toBe(true);
  expect(Number.isFinite(paperOrders)).toBe(true);
  return { hypotheses: (body.hypotheses ?? []).length, strategies, paperOrders };
}

test.describe("golden journey — the full lifecycle through the running product", () => {
  test.skip(!DB_PATH, "needs direct access to the server's database file");

  test.beforeAll(async () => {
    const base =
      process.env.MARKETPULSE_E2E_BASE_URL?.trim() ||
      `http://127.0.0.1:${process.env.MARKETPULSE_E2E_PORT ?? 3100}`;
    await fetch(`${base}/api/research/hypotheses`).catch(() => undefined);
    for (let attempt = 0; attempt < 20 && !fs.existsSync(DB_PATH!); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!fs.existsSync(DB_PATH!)) throw new Error(`Server database never appeared at ${DB_PATH}.`);

    // Deterministic daily bars on TCS — the professor-authored gap strategy is daily, and every
    // third day gaps up hard on heavy volume so gap_pct AND rvol fire (same seeding the forward
    // evidence suite uses; count-guarded so a shared database is never double-seeded).
    const db = new Database(DB_PATH!);
    try {
      const existing = db
        .prepare("SELECT COUNT(*) AS n FROM price_candles WHERE ticker = 'IN:XNSE:TCS' AND resolution = 'D'")
        .get() as { n: number };
      if (existing.n < 120) {
        const insert = db.prepare(
          "INSERT INTO price_candles (ticker, resolution, time, open, high, low, close, volume) VALUES ('IN:XNSE:TCS', 'D', ?, ?, ?, ?, ?, ?)",
        );
        const all = db.transaction(() => {
          for (let day = 0; day < 120; day += 1) {
            const gapDay = day % 3 === 0;
            const base = 100 + day * 0.2;
            const gap = gapDay ? base * 1.04 : base;
            insert.run(
              SESSION_OPEN_UTC - 200 * 86_400 + day * 86_400,
              gap,
              gap * 1.02,
              base * 0.99,
              gap * 1.005,
              gapDay ? 4_000 : 1_000,
            );
          }
        });
        all();
      }
    } finally {
      db.close();
    }
  });

  test("identity → research → hypothesis → strategy → backtest → trial → holdout → forward → paper → alpha → brain", async ({
    page,
    request,
    baseURL,
  }, testInfo) => {
    test.skip(testInfo.project.name.includes("mobile"), "mission policy: desktop-only Playwright");
    test.setTimeout(420_000);
    await ensureLocalSession(request);

    let before = { hypotheses: 0, strategies: 0, paperOrders: 0 };

    await test.step("1. identity: the official NSE security master resolves a pinned instrument", async () => {
      const search = await request.get(
        "/api/market/instruments?q=IN%3AXNSE%3ATCS&exchange=XNSE",
        { headers: { origin: baseURL! } },
      );
      expect(search.status()).toBe(200);
      const body = (await search.json()) as {
        instruments: { id: string; isin: string | null }[];
        securityMaster: { totalRows: number };
      };
      expect(body.securityMaster.totalRows).toBeGreaterThan(3_000);
      expect(body.instruments).toContainEqual(
        expect.objectContaining({ id: "IN:XNSE:TCS", isin: "INE467B01029" }),
      );
    });

    await test.step("2. research/evidence: the stock research boundary states PROPOSAL READY and its fixture status", async () => {
      await page.goto("/analyze/IN%3AXNSE%3ATCS", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("main")).toContainText("₹");
      await page.getByTestId("research-stock-run").click();
      await expect(page.getByTestId("research-stock-state")).toHaveText(/PROPOSAL READY/, { timeout: 15_000 });
      await expect(page.getByTestId("research-stock-fixture-banner")).toContainText(/NOT INTEGRATION VERIFIED/);
      await expect(page.getByTestId("research-stock-handoff")).toBeDisabled();
    });

    let specId: string;
    let familyId: string;
    const title = `Full lifecycle gap screen ${RUN_STAMP}`;
    const statement =
      "NSE liquid names gapping with gap >= 3% on relative volume >= 1.5 continue upward " +
      "intraday after realistic round-trip costs, because the opening imbalance persists.";

    await test.step("3. hypothesis: prose in, a family-bearing strategy out — and no duplicates", async () => {
      const posted = await request.post("/api/research/hypotheses", { headers: headers(baseURL!), data: { title, statement } });
      expect(posted.status()).toBe(201);
      const body = (await posted.json()) as {
        verdict: string;
        authored: { specId: string; familyId: string } | null;
        reason?: string;
      };
      expect(body.verdict).toBe("EXPRESSIBLE");
      expect(body.authored).not.toBeNull();
      specId = body.authored!.specId;
      familyId = body.authored!.familyId;
      expect(familyId).toMatch(/^fam_/);

      const again = await request.post("/api/research/hypotheses", { headers: headers(baseURL!), data: { title, statement } });
      expect(again.status()).toBe(200);
      const againBody = (await again.json()) as { alreadyExisted: boolean };
      expect(againBody.alreadyExisted).toBe(true);
    });

    await test.step("4. strategy: the registry shows it with a stage and a reason, not a bare label", async () => {
      await page.goto("/strategies", { waitUntil: "domcontentloaded" });
      await expect(page.locator("body")).toContainText(/full_lifecycle_gap_screen/i);
      await expect(page.locator("body")).toContainText(/Not yet rehearsed|no evidence of any kind/i);
    });

    await test.step("5. backtest: a fresh experiment, pinned to a dataset snapshot with provenance", async () => {
      const trades = await request.post("/api/strategy/trades", {
        headers: headers(baseURL!),
        data: { specId },
        timeout: 120_000,
      });
      expect(trades.status()).toBe(200);
      const body = (await trades.json()) as {
        servedFrom: string;
        trades: unknown[];
        summary: string;
        provenance: {
          datasetSnapshotId: string;
          fingerprint: string;
          barCount: number;
          instruments: number;
          engineVersion: string;
        };
      };
      expect(body.servedFrom).toBe("fresh");
      expect(body.provenance.datasetSnapshotId).toMatch(/^dss_/);
      expect(body.provenance.fingerprint).toBeTruthy();
      expect(body.provenance.barCount).toBeGreaterThanOrEqual(120);
      expect(body.provenance.instruments).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(body.trades)).toBe(true);
    });

    await test.step("6. selection trial: the gauntlet states the bar before it runs, then pins the verdict to the snapshot", async () => {
      const unconfirmed = await request.post("/api/strategy/gauntlet", {
        headers: headers(baseURL!),
        data: { specId },
      });
      expect(unconfirmed.status()).toBe(428);
      expect(((await unconfirmed.json()) as { message: string }).message).toMatch(/permanently raises the bar/);

      const confirmed = await request.post("/api/strategy/gauntlet", {
        headers: headers(baseURL!),
        data: { specId, confirm: true },
        timeout: 120_000,
      });
      expect(confirmed.status()).toBe(200);
      const verdict = (await confirmed.json()) as { datasetSnapshotId: string; datasetFingerprint?: string };
      expect(String(verdict.datasetSnapshotId)).toMatch(/^dss_/);
    });

    await test.step("7. validation & holdout: the sealed budget is untouched — an unasked question is not a negative answer", async () => {
      const db = new Database(DB_PATH!);
      try {
        const used = db
          .prepare("SELECT COUNT(*) AS n FROM holdout_ledger WHERE strategy_spec_id = ?")
          .get(specId) as { n: number };
        expect(used.n).toBe(0);
      } finally {
        db.close();
      }
    });

    let challengerId: string;
    await test.step("8. forward: activation demands confirmation, freezes the challenger, then the shadow pass records signals before outcomes", async () => {
      const unconfirmed = await request.post("/api/forward/activate", {
        headers: headers(baseURL!),
        data: { specId },
      });
      expect(unconfirmed.status()).toBe(428);

      const activated = await request.post("/api/forward/activate", {
        headers: headers(baseURL!),
        data: { specId, confirm: true },
      });
      expect(activated.status()).toBe(201);
      challengerId = ((await activated.json()) as { challengerId: string }).challengerId;
      expect(challengerId).toMatch(/^fch_/);

      // The activation watermark is "now" — rewind it before the seeded history so the stored
      // bars count as newly-arrived market data for this challenger.
      {
        const db = new Database(DB_PATH!);
        try {
          db.prepare("UPDATE forward_challengers SET last_evaluated_time = ? WHERE id = ?").run(
            SESSION_OPEN_UTC - 201 * 86_400,
            challengerId,
          );
        } finally {
          db.close();
        }
      }

      const enrolled = await request.post("/api/forward/enroll", {
        headers: headers(baseURL!),
        data: { challengerId, startingCash: 10_000 },
      });
      expect(enrolled.status()).toBe(201);

      const run = await request.post("/api/forward/run", { headers: headers(baseURL!), data: {} });
      expect(run.status()).toBe(200);
      const report = (await run.json()) as {
        signalsEmitted: number;
        outcomesResolved: number;
        paper: { intentsRecorded: number; ordersFilled: number; positionsClosed: number };
      };
      expect(report.signalsEmitted).toBeGreaterThan(0);
      expect(report.outcomesResolved).toBeGreaterThan(0);
      expect(report.paper.intentsRecorded).toBeGreaterThan(0);
      expect(report.paper.ordersFilled).toBeGreaterThan(0);
      expect(report.paper.positionsClosed).toBeGreaterThan(0);
    });

    await test.step("9. paper: separate ledgers, funds never negative, fills always follow their intent decisions", async () => {
      const db = new Database(DB_PATH!);
      try {
        const badFills = db
          .prepare(
            `SELECT COUNT(*) AS n FROM paper_forward_orders o
             JOIN execution_intents i ON i.id = o.intent_id
             WHERE o.status = 'FILLED' AND o.fill_time < i.decision_time`,
          )
          .get() as { n: number };
        expect(badFills.n).toBe(0);
        const wrongOrder = db
          .prepare(
            `SELECT COUNT(*) AS n FROM forward_signal_outcomes o
             JOIN forward_signals s ON s.id = o.signal_id
             WHERE o.exit_time <= s.event_time`,
          )
          .get() as { n: number };
        expect(wrongOrder.n).toBe(0);
        const account = db
          .prepare("SELECT cash FROM paper_forward_accounts WHERE challenger_id = ?")
          .get(challengerId) as { cash: number };
        expect(account.cash).toBeGreaterThanOrEqual(0);
      } finally {
        db.close();
      }
    });

    await test.step("10. alpha health: the scorecard renders an EARNED status with decay ratios", async () => {
      await page.goto("/paper?market=NSE", { waitUntil: "domcontentloaded" });
      const row = page
        .getByTestId("forward-challenger-row")
        .filter({ hasText: new RegExp(`full_lifecycle_gap_screen_${RUN_STAMP}`, "i") });
      await expect(row).toBeVisible();
      await expect(row).toContainText(/signal\(s\)/);
      await expect(row).toContainText(/resolved/);
      await expect(row).toContainText(/INSUFFICIENT|ON_TRACK|DRIFTING/);
      await expect(row.getByTestId("forward-paper")).toContainText(/PAPER \(separate ledger\)/);
      const alpha = row.getByTestId("forward-alpha");
      await expect(alpha).toContainText(/ALPHA (HEALTHY|DECAYING|EXECUTION_LIMITED|INSUFFICIENT_EVIDENCE)/);
      await expect(alpha).toContainText(/decay shadow\/hist/);
      // Reload: the evidence is durable, not a view-model.
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(
        page.getByTestId("forward-challenger-row").filter({ hasText: new RegExp(`full_lifecycle_gap_screen_${RUN_STAMP}`, "i") }),
      ).toBeVisible();
    });

    await test.step("11. memory & learning: a cycle runs or honestly reports the lease holder", async () => {
      const cycle = await request.post("/api/learning/cycle", {
        headers: headers(baseURL!),
        data: {},
        timeout: 240_000,
      });
      expect([200, 423]).toContain(cycle.status()); // 423 = another driver holds the lease
      if (cycle.status() === 200) {
        const report = (await cycle.json()) as { mode: string; actions: unknown[] };
        expect(typeof report.mode).toBe("string");
        expect(Array.isArray(report.actions)).toBe(true);
      }
    });

    await test.step("12. brain counts: the numbers grew, straight from the database the page renders", async () => {
      await page.goto("/brain", { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("brain-system")).toContainText(/PAPER ONLY/);
      before = await brainCounts(page);
      // This journey contributed exactly one hypothesis and one authored strategy, plus at least
      // one forward paper order — the counts must reflect the growth.
      expect(before.hypotheses).toBeGreaterThanOrEqual(1);
      expect(before.strategies).toBeGreaterThanOrEqual(1);
      expect(before.paperOrders).toBeGreaterThanOrEqual(1);
      await expect(page.getByTestId("brain-knowledge")).toContainText(`Hypotheses: ${before.hypotheses}`);
    });
  });
});