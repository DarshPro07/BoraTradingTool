import fs from "node:fs";
import Database from "better-sqlite3";
import { expect, test, type Page } from "@playwright/test";
import { ensureLocalSession } from "./lib/session";

/**
 * MASTER GOLDEN JOURNEY (masterclass A76/C34-36) — the FULL lifecycle, per stock, across a
 * DIVERSE 8-security universe. Not only famous names: 2 large, 2 mid, 4 smaller/less-followed.
 *
 * The chain per stock, every rung through a REAL product surface:
 *
 *   identity → research (REAL model run, citation-verified) → hypothesis (professor path)
 *   → strategy registry → backtest (snapshot-pinned) → selection trial (double-gated gauntlet)
 *   → holdout untouched (DB cross-check) → forward activation (confirm-gated, signals before
 *   outcomes) → paper (separate ledgers, invariants) → alpha health → memory/learning → brain.
 *
 * ## What changed from the single-stock ancestor, and why
 *
 *   - RESEARCH IS REAL NOW. The ancestor asserted the fixture banner ("NOT INTEGRATION VERIFIED")
 *     and a DISABLED handoff — true when research was fixture-served, FALSE since the M5 bridge
 *     went live (30/30 stocks reached SOURCE_VERIFIED in the breadth acceptance). The journey now
 *     asserts the CURRENT truth: a real terminal state, NO fixture banner, and — on SOURCE_VERIFIED
 *     — an ENABLED handoff, which is clicked once (TCS) to prove the user-facing control produces a
 *     stated verdict (A76: if a handoff exists, Playwright uses it).
 *   - The master-size assertion (totalRows > 3000) assumed the live NSE bootstrap. Under TEST_MODE
 *     the disposable fixture master carries the 30-security acceptance universe; the honest
 *     invariant in BOTH environments is >= 30 rows and the instrument resolving canonically.
 *   - The chain is parameterized over 8 stocks; hypothesis titles/slug names carry the symbol so
 *     families never collide, and per-stock deterministic gap-shaped bars make the gap strategy
 *     genuinely fire in forward/paper (a chain that emits zero signals proves nothing).
 *
 * Direct DB access here is SEEDING (deterministic bars, count-guarded) and CROSS-CHECKS (holdout
 * untouched, paper invariants, watermark rewind for time-travel) — never a bypass of a product
 * control that exists.
 */

const DB_PATH = process.env.MARKETPULSE_E2E_DB_PATH;
const RUN_STAMP = Date.now().toString(36);
const SESSION_OPEN_UTC = Date.UTC(2026, 7, 3, 3, 45, 0) / 1000;

/** 8 diverse canonical NSE equities: 2 large, 2 mid, 4 smaller/less-followed. */
const JOURNEY_STOCKS = [
  { symbol: "TCS", tier: "large" },
  { symbol: "ICICIBANK", tier: "large" },
  { symbol: "TATAMOTORS", tier: "mid" },
  { symbol: "TITAN", tier: "mid" },
  { symbol: "GAIL", tier: "small" },
  { symbol: "BECTORFOOD", tier: "small" },
  { symbol: "CHAMBLFERT", tier: "small" },
  { symbol: "JYOTHYLAB", tier: "small" },
] as const;

function headers(baseURL: string) {
  return { "content-type": "application/json", origin: baseURL, "x-marketpulse-mutation": "1" };
}

const slugFor = (symbol: string) => `deep_journey_gap_${symbol.toLowerCase()}_${RUN_STAMP}`;

async function brainCounts(page: Page): Promise<{ hypotheses: number; strategies: number; paperOrders: number }> {
  const body = await page.evaluate(async () => {
    const response = await fetch("/api/research/hypotheses");
    return (await response.json()) as { hypotheses?: unknown[] };
  });
  const knowledge = await page.getByTestId("brain-knowledge").innerText();
  const strategies = Number(/Strategies:\s*(\d+)/.exec(knowledge)?.[1] ?? Number.NaN);
  // The journey's orders live in the FORWARD paper ledger — the cockpit counts each ledger
  // separately (manual "Paper orders" vs "Forward paper orders"), and so does this reader.
  const paperOrders = Number(/Forward paper orders:\s*(\d+)/.exec(knowledge)?.[1] ?? Number.NaN);
  expect(Number.isFinite(strategies)).toBe(true);
  expect(Number.isFinite(paperOrders)).toBe(true);
  return { hypotheses: (body.hypotheses ?? []).length, strategies, paperOrders };
}

test.describe("master golden journey — full lifecycle across 8 diverse NSE equities", () => {
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

    // Deterministic daily bars per journey stock — every third day gaps up hard on heavy volume so
    // gap_pct AND rvol genuinely fire (forward-evidence recipe; count-guarded per instrument so a
    // shared database is never double-seeded).
    const db = new Database(DB_PATH!);
    try {
      for (const stock of JOURNEY_STOCKS) {
        const ticker = `IN:XNSE:${stock.symbol}`;
        const existing = db
          .prepare("SELECT COUNT(*) AS n FROM price_candles WHERE ticker = ? AND resolution = 'D'")
          .get(ticker) as { n: number };
        if (existing.n >= 120) continue;
        const insert = db.prepare(
          "INSERT INTO price_candles (ticker, resolution, time, open, high, low, close, volume) VALUES (?, 'D', ?, ?, ?, ?, ?, ?)",
        );
        db.transaction(() => {
          for (let day = 0; day < 120; day += 1) {
            const gapDay = day % 3 === 0;
            const base = 100 + day * 0.2;
            const gap = gapDay ? base * 1.04 : base;
            insert.run(
              ticker,
              SESSION_OPEN_UTC - 200 * 86_400 + day * 86_400,
              gap,
              gap * 1.02,
              base * 0.99,
              gap * 1.005,
              gapDay ? 4_000 : 1_000,
            );
          }
        })();
      }
    } finally {
      db.close();
    }
  });

  for (const stock of JOURNEY_STOCKS) {
    const instrument = `IN:XNSE:${stock.symbol}`;
    const encoded = encodeURIComponent(instrument);

    test(`${stock.symbol} (${stock.tier}) — identity → research → hypothesis → strategy → backtest → trial → holdout → forward → paper → alpha`, async ({
      page,
      request,
      baseURL,
    }, testInfo) => {
      test.skip(testInfo.project.name.includes("mobile"), "mission policy: desktop-only Playwright");
      test.setTimeout(420_000);
      await ensureLocalSession(request);

      await test.step("identity: the security master resolves the instrument canonically", async () => {
        const search = await request.get(`/api/market/instruments?q=${encoded}&exchange=XNSE`, {
          headers: { origin: baseURL! },
        });
        expect(search.status()).toBe(200);
        const body = (await search.json()) as {
          instruments: { id: string; isin: string | null }[];
          securityMaster: { totalRows: number };
        };
        // >= 30 holds for BOTH the TEST_MODE acceptance-universe fixture and a live bootstrap.
        expect(body.securityMaster.totalRows).toBeGreaterThanOrEqual(30);
        expect(body.instruments.map((i) => i.id)).toContain(instrument);
        if (stock.symbol === "TCS") {
          // The fixture keeps TCS's REAL ISIN — canonical identity survives environments.
          expect(body.instruments).toContainEqual(expect.objectContaining({ id: instrument, isin: "INE467B01029" }));
        }
      });

      await test.step("research: a REAL model run reaches a verified terminal — no fixture banner", async () => {
        await page.goto(`/analyze/${encoded}`, { waitUntil: "domcontentloaded" });
        await expect(page.getByRole("main")).toContainText("₹");
        await page.getByTestId("research-stock-run").click();
        // A real provider round-trip is the slow case (~60s); a hang still fails, just later.
        await expect(page.getByTestId("research-stock-state")).toHaveText(/PROPOSAL READY|NEEDS EVIDENCE/, {
          timeout: 150_000,
        });
        // Research is live — the fixture era's banner must NOT be on a real run.
        await expect(page.getByTestId("research-stock-fixture-banner")).toHaveCount(0);

        const state = (await page.getByTestId("research-stock-state").textContent())?.trim();
        if (state === "PROPOSAL READY") {
          const handoff = page.getByTestId("research-stock-handoff");
          await expect(handoff, "a SOURCE_VERIFIED proposal must enable the strategy handoff").toBeEnabled();
          if (stock.symbol === "TCS") {
            // Prove the user-facing handoff once: clicking it must produce a STATED outcome
            // (a triage verdict either way), never silence. The deterministic chain below still
            // uses the professor path, so model prose cannot flake seven other chains.
            await handoff.click();
            await expect(page.getByTestId("research-stock-handoff-result")).toContainText(
              /EXPRESSIBLE|NEEDS_FEATURE|NOT_A_RULE|UNCLEAR|REJECTED|DUPLICATE/,
              { timeout: 30_000 },
            );
          }
        }
      });

      let specId: string;
      const title = `Deep journey gap ${stock.symbol} ${RUN_STAMP}`;
      // The statement is deliberately SYMBOL-FREE: tickers like TITAN and GAIL are real English
      // words, and putting them inside the rule clause perturbs the dependency parse (TITAN's run
      // came back UNCLEAR where TCS's identical grammar compiled). Per-stock identity lives in the
      // TITLE — the hypothesis id is a hash of title:statement, so the eight journeys stay distinct.
      const statement =
        "NSE liquid names gapping with gap >= 3% on relative volume >= 1.5 continue upward " +
        "intraday after realistic round-trip costs, because the opening imbalance persists.";

      await test.step("hypothesis: prose in, a family-bearing strategy out — and no duplicates", async () => {
        const posted = await request.post("/api/research/hypotheses", {
          headers: headers(baseURL!),
          data: { title, statement },
        });
        expect(posted.status()).toBe(201);
        const body = (await posted.json()) as {
          verdict: string;
          authored: { specId: string; familyId: string } | null;
        };
        expect(body.verdict).toBe("EXPRESSIBLE");
        expect(body.authored).not.toBeNull();
        specId = body.authored!.specId;
        expect(body.authored!.familyId).toMatch(/^fam_/);

        const again = await request.post("/api/research/hypotheses", {
          headers: headers(baseURL!),
          data: { title, statement },
        });
        expect(again.status()).toBe(200);
        expect(((await again.json()) as { alreadyExisted: boolean }).alreadyExisted).toBe(true);
      });

      await test.step("strategy: the registry shows it with a stage and a reason, not a bare label", async () => {
        await page.goto("/strategies", { waitUntil: "domcontentloaded" });
        await expect(page.locator("body")).toContainText(new RegExp(slugFor(stock.symbol), "i"));
        await expect(page.locator("body")).toContainText(/Not yet rehearsed|no evidence of any kind/i);
      });

      await test.step("backtest: a fresh experiment pinned to a dataset snapshot with provenance", async () => {
        const trades = await request.post("/api/strategy/trades", {
          headers: headers(baseURL!),
          data: { specId },
          timeout: 120_000,
        });
        expect(trades.status()).toBe(200);
        const body = (await trades.json()) as {
          servedFrom: string;
          trades: unknown[];
          provenance: { datasetSnapshotId: string; fingerprint: string; barCount: number; instruments: number };
        };
        expect(body.servedFrom).toBe("fresh");
        expect(body.provenance.datasetSnapshotId).toMatch(/^dss_/);
        expect(body.provenance.fingerprint).toBeTruthy();
        expect(body.provenance.barCount).toBeGreaterThanOrEqual(120);
        expect(Array.isArray(body.trades)).toBe(true);
      });

      await test.step("selection trial: the gauntlet refuses without confirm, then pins the verdict to the snapshot", async () => {
        const unconfirmed = await request.post("/api/strategy/gauntlet", {
          headers: headers(baseURL!),
          data: { specId },
        });
        expect(unconfirmed.status()).toBe(428);
        const confirmed = await request.post("/api/strategy/gauntlet", {
          headers: headers(baseURL!),
          data: { specId, confirm: true },
          timeout: 120_000,
        });
        expect(confirmed.status()).toBe(200);
        expect(String(((await confirmed.json()) as { datasetSnapshotId: string }).datasetSnapshotId)).toMatch(/^dss_/);
      });

      await test.step("holdout: the sealed budget is untouched — an unasked question is not a negative answer", async () => {
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
      await test.step("forward: confirm-gated activation, then signals recorded BEFORE their outcomes", async () => {
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

        // Time-travel the watermark before the seeded history so stored bars count as newly
        // arrived for THIS challenger (deterministic replay; documented recipe).
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

        const run = await request.post("/api/forward/run", { headers: headers(baseURL!), data: {}, timeout: 120_000 });
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

      await test.step("paper: separate ledgers, funds never negative, fills always follow their intents", async () => {
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

      await test.step("alpha health: the scorecard renders an EARNED status with decay ratios, durably", async () => {
        await page.goto("/paper?market=NSE", { waitUntil: "domcontentloaded" });
        const row = page
          .getByTestId("forward-challenger-row")
          .filter({ hasText: new RegExp(slugFor(stock.symbol), "i") });
        await expect(row).toBeVisible();
        await expect(row).toContainText(/signal\(s\)/);
        await expect(row.getByTestId("forward-paper")).toContainText(/PAPER \(separate ledger\)/);
        await expect(row.getByTestId("forward-alpha")).toContainText(
          /ALPHA (HEALTHY|DECAYING|EXECUTION_LIMITED|INSUFFICIENT_EVIDENCE)/,
        );
        await page.reload({ waitUntil: "domcontentloaded" });
        await expect(
          page.getByTestId("forward-challenger-row").filter({ hasText: new RegExp(slugFor(stock.symbol), "i") }),
        ).toBeVisible();
      });
    });
  }

  test("memory, learning and brain: the whole journey is visible in the cockpit", async ({ page, request, baseURL }, testInfo) => {
    test.skip(testInfo.project.name.includes("mobile"), "mission policy: desktop-only Playwright");
    test.setTimeout(300_000);
    await ensureLocalSession(request);

    await test.step("memory & learning: a cycle runs or honestly reports the lease holder", async () => {
      const cycle = await request.post("/api/learning/cycle", { headers: headers(baseURL!), data: {}, timeout: 240_000 });
      expect([200, 423]).toContain(cycle.status());
      if (cycle.status() === 200) {
        const report = (await cycle.json()) as { mode: string; actions: unknown[] };
        expect(typeof report.mode).toBe("string");
        expect(Array.isArray(report.actions)).toBe(true);
      }
    });

    await test.step("brain counts: eight journeys grew the numbers, read from the database the page renders", async () => {
      await page.goto("/brain", { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("brain-system")).toContainText(/PAPER ONLY/);
      const counts = await brainCounts(page);
      // Eight per-stock journeys each contributed a hypothesis, a strategy, and paper orders.
      expect(counts.hypotheses).toBeGreaterThanOrEqual(JOURNEY_STOCKS.length);
      expect(counts.strategies).toBeGreaterThanOrEqual(JOURNEY_STOCKS.length);
      expect(counts.paperOrders).toBeGreaterThanOrEqual(JOURNEY_STOCKS.length);
      await expect(page.getByTestId("brain-knowledge")).toContainText(`Hypotheses: ${counts.hypotheses}`);
    });
  });
});
