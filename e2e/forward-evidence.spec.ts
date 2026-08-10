import fs from "node:fs";
import Database from "better-sqlite3";
import { expect, test } from "@playwright/test";

/**
 * Forward evidence, end to end on DESKTOP (owner test 18; the mission's Playwright policy is
 * desktop-only — mobile runs only when a task is explicitly about mobile).
 *
 * The journey: family-bearing strategy → gauntlet baseline → challenger activated (frozen) →
 * shadow pass records signals before their outcomes → outcomes resolve from later bars →
 * scorecard on /paper → reload → identical evidence.
 */

const DB_PATH = process.env.MARKETPULSE_E2E_DB_PATH;
const RUN_STAMP = Date.now().toString(36);

const SESSION_OPEN_UTC = Date.UTC(2026, 7, 3, 3, 45, 0) / 1000;

function headers(baseURL: string) {
  return { "content-type": "application/json", origin: baseURL, "x-marketpulse-csrf": "1" };
}

test.describe("forward evidence — the shadow stage through the running app", () => {
  test.skip(!DB_PATH, "needs direct access to the server's database file");

  test.beforeAll(async () => {
    const base = process.env.MARKETPULSE_E2E_BASE_URL?.trim()
      || `http://127.0.0.1:${process.env.MARKETPULSE_E2E_PORT ?? 3100}`;
    await fetch(`${base}/api/research/hypotheses`).catch(() => undefined);
    for (let attempt = 0; attempt < 20 && !fs.existsSync(DB_PATH!); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!fs.existsSync(DB_PATH!)) throw new Error(`Server database never appeared at ${DB_PATH}.`);

    // Daily bars: the professor-authored gap strategy is daily, and the shadow evaluator will
    // observe it on the same canonical store the historical side reads.
    const db = new Database(DB_PATH!);
    try {
      // A dedicated instrument: other suites seed flat daily RELIANCE bars at these exact
      // timestamps, and a count-based guard once skipped this seeding entirely because of them.
      const existing = db
        .prepare("SELECT COUNT(*) AS n FROM price_candles WHERE ticker = 'IN:XNSE:TCS' AND resolution = 'D'")
        .get() as { n: number };
      if (existing.n < 120) {
        const insert = db.prepare(
          "INSERT INTO price_candles (ticker, resolution, time, open, high, low, close, volume) VALUES ('IN:XNSE:TCS', 'D', ?, ?, ?, ?, ?, ?)",
        );
        const all = db.transaction(() => {
          for (let day = 0; day < 120; day += 1) {
            // Every third day gaps up hard ON HEAVY VOLUME, so gap_pct AND rvol clauses fire.
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

  test("challenger → prospective signals → resolved outcomes → scorecard, surviving reload", async ({
    page,
    request,
    baseURL,
  }, testInfo) => {
    test.skip(testInfo.project.name.includes("mobile"), "mission policy: desktop-only Playwright");
    test.setTimeout(120_000);

    // A family-bearing strategy through the professor path, then its gauntlet baseline.
    const title = `Forward gap screen ${RUN_STAMP}`;
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

    const gauntlet = await request.post("/api/strategy/gauntlet", {
      headers: headers(baseURL!),
      data: { specId: authored!.specId, confirm: true },
    });
    expect(gauntlet.status()).toBe(200);

    // Activation demands explicit confirmation, then freezes the challenger.
    const unconfirmed = await request.post("/api/forward/activate", {
      headers: headers(baseURL!),
      data: { specId: authored!.specId },
    });
    expect(unconfirmed.status()).toBe(428);

    const activated = await request.post("/api/forward/activate", {
      headers: headers(baseURL!),
      data: { specId: authored!.specId, confirm: true },
    });
    expect(activated.status()).toBe(201);
    const { challengerId } = (await activated.json()) as { challengerId: string };
    expect(challengerId).toMatch(/^fch_/);

    // The activation watermark is "now" — rewind it to before the seeded history so the stored
    // bars count as newly-arrived market data for this challenger. (In production the clock does
    // this; a test cannot wait for tomorrow's session.)
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

    // Enroll in the paper stage at real validation capital BEFORE the pass, so one deterministic
    // run produces both ledgers.
    const enrolled = await request.post("/api/forward/enroll", {
      headers: headers(baseURL!),
      data: { challengerId, startingCash: 10_000 },
    });
    expect(enrolled.status()).toBe(201);

    // One pass: shadow signals recorded before outcomes, then paper intents/fills/closes on them.
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

    // The scorecard, on screen.
    await page.goto("/paper?market=NSE", { waitUntil: "domcontentloaded" });
    const rowPattern = new RegExp(`forward_gap_screen_${RUN_STAMP}`, "i");
    const row = page.getByTestId("forward-challenger-row").filter({ hasText: rowPattern });
    await expect(row).toBeVisible();
    await expect(row).toContainText(/signal\(s\)/);
    await expect(row).toContainText(/resolved/);
    await expect(row).toContainText(/INSUFFICIENT|ON_TRACK|DRIFTING/);
    // The paper ledger, on the same row, strictly labelled as its own ledger.
    await expect(row.getByTestId("forward-paper")).toContainText(/PAPER \(separate ledger\)/);
    await expect(row.getByTestId("forward-paper")).toContainText(/executed/);
    // Phase D: alpha health renders with an EARNED status, decay ratios, and the labelled
    // missed-trade ESTIMATE — never an unexplained verdict.
    const alpha = row.getByTestId("forward-alpha");
    await expect(alpha).toContainText(/ALPHA (HEALTHY|DECAYING|EXECUTION_LIMITED|INSUFFICIENT_EVIDENCE)/);
    await expect(alpha).toContainText(/decay shadow\/hist/);

    // Reload: forward evidence is durable, not a view-model.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("forward-challenger-row").filter({ hasText: rowPattern })).toBeVisible();

    // And the ledger agrees with the screen: signals precede their outcomes, always.
    const db = new Database(DB_PATH!);
    try {
      // Paper cross-checks: every fill follows its intent decision, funds never negative.
      const badFills = db
        .prepare(
          `SELECT COUNT(*) AS n FROM paper_forward_orders o
           JOIN execution_intents i ON i.id = o.intent_id
           WHERE o.status = 'FILLED' AND o.fill_time < i.decision_time`,
        )
        .get() as { n: number };
      expect(badFills.n).toBe(0);
      const account = db
        .prepare("SELECT cash FROM paper_forward_accounts WHERE challenger_id = ?")
        .get(challengerId) as { cash: number };
      expect(account.cash).toBeGreaterThanOrEqual(0);
      const wrongOrder = db
        .prepare(
          `SELECT COUNT(*) AS n FROM forward_signal_outcomes o
           JOIN forward_signals s ON s.id = o.signal_id
           WHERE o.exit_time <= s.event_time`,
        )
        .get() as { n: number };
      expect(wrongOrder.n).toBe(0);
    } finally {
      db.close();
    }
  });
});
