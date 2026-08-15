import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { ensureLocalSession, mutationHeaders } from "./lib/session";

/**
 * NSE 30-Stock Breadth — STAGE 2 (masterclass A75/C33): "after supported ingestion".
 *
 * Stage 1 is `nse-30-stock-matrix.spec.ts`, which on a fresh database proves every stock reaches a
 * TRUTHFUL refusal (NO_STORED_DATA) through the real UI. Alphabetical file order guarantees it ran
 * before this file (workers=1), so this file starts from a store that refused everything.
 *
 * This stage then:
 *   1. ingests all 30 through the PRODUCT ingestion route (the same route the UI button calls —
 *      the button path itself is UI-proven by `ingestion-unlock.spec.ts`; a breadth sweep uses the
 *      product API for determinism, not SQL injection, and not a bypass of an unproven control);
 *   2. re-runs research through the REAL UI per stock and requires a terminal outcome that is no
 *      longer NO_STORED_DATA — because history is exactly what ingestion is responsible for.
 *
 * ## Honesty rules
 *
 *   - An ingestion refusal must be a STATED code. INSTRUMENT_UNKNOWN (not in the NSE master) is an
 *     honest per-stock outcome and is recorded, not hidden — but a sweep where NOTHING becomes
 *     ready proves nothing, so the sweep fails unless >= MIN_READY stocks are researchable. The
 *     masterclass stop-condition explicitly forbids calling "30 refusals" a completed Stage 2.
 *   - Research after ingestion may end PROPOSAL READY / NEEDS EVIDENCE / FAILED-with-stated-code —
 *     but NOT NO_STORED_DATA for a stock the sweep made ready, and never a bare failure, hang,
 *     5xx, or console error.
 *   - Every outcome lands in a per-stock matrix artifact (.tmp/nse30-stage2-matrix.json) so the
 *     run's evidence survives the terminal scrollback.
 */

const STOCKS = [
  // Large cap
  "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK",
  "HINDUNILVR", "SBIN", "BHARTIARTL", "ITC", "LT",
  // Mid cap
  "TATAMOTORS", "SUNPHARMA", "TATASTEEL", "WIPRO", "ASIANPAINT",
  "MARUTI", "TITAN", "BAJFINANCE", "HCLTECH", "POWERGRID",
  // Smaller / less followed
  "BECTORFOOD", "JYOTHYLAB", "CHAMBLFERT", "GAIL", "SIEMENS",
  "AMBUJACEM", "BERGEPAINT", "DABUR", "COLPAL", "MCDOWELL-N",
] as const;

/** A sweep where fewer than this became researchable is a vacuous Stage 2 and must fail. */
const MIN_READY = 25;

const MATRIX_PATH = path.join(process.cwd(), ".tmp", "nse30-stage2-matrix.json");

interface MatrixRow {
  symbol: string;
  ingestion: { code: string; ready: boolean; storedAfter: number; message?: string };
  research?: { terminal: string; refusal: string | null };
  problems?: string[];
}

function loadMatrix(): Record<string, MatrixRow> {
  try {
    return JSON.parse(fs.readFileSync(MATRIX_PATH, "utf8")) as Record<string, MatrixRow>;
  } catch {
    return {};
  }
}

function saveMatrix(matrix: Record<string, MatrixRow>): void {
  fs.mkdirSync(path.dirname(MATRIX_PATH), { recursive: true });
  fs.writeFileSync(MATRIX_PATH, JSON.stringify(matrix, null, 2));
}

const instrumentId = (symbol: string) => `IN:XNSE:${symbol}`;
const encodeInstrument = (symbol: string) => encodeURIComponent(instrumentId(symbol));

const ALLOWED_NOISE: RegExp[] = [/favicon/i, /Download the React DevTools/i];
const isAllowedNoise = (text: string) => ALLOWED_NOISE.some((entry) => entry.test(text));

function collectPageProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`uncaught exception: ${error.message}`));
  page.on("console", (msg) => {
    if (msg.type() !== "error" || isAllowedNoise(msg.text())) return;
    problems.push(`console error: ${msg.text()}`);
  });
  page.on("requestfailed", (request) => {
    const url = request.url();
    if (isAllowedNoise(url)) return;
    const failure = request.failure()?.errorText ?? "";
    if (url.includes("_rsc=") && failure === "net::ERR_ABORTED") return;
    problems.push(`request failed: ${request.method()} ${url} — ${failure}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 500 && !isAllowedNoise(response.url())) {
      problems.push(`server error: ${response.status()} ${response.url()}`);
    }
  });
  return problems;
}

test.describe("NSE 30-stock breadth — Stage 2: ingest all, then research all", () => {
  test("ingestion sweep: every stock reaches a stated outcome; >= 25 become researchable", async ({ request, baseURL }, testInfo) => {
    test.skip(testInfo.project.name.includes("mobile"), "mission policy: desktop-only Playwright");
    // 30 ingests; fixture-served in TEST_MODE but each validates + persists two years of bars.
    test.setTimeout(300_000);
    await ensureLocalSession(request);

    // Ingestion's phantom-instrument guard resolves against the NSE MASTER, which bootstraps
    // lazily through the product (an XNSE query triggers the official sync on a fresh DB). Warm it
    // up here so a master outage surfaces as ONE stated 503 rather than 30 INSTRUMENT_UNKNOWNs.
    const master = await request.get("/api/market/instruments?exchange=XNSE&q=RELIANCE", { timeout: 120_000 });
    expect(
      master.status(),
      `NSE master bootstrap failed (${master.status()}) — Stage 2 cannot proceed without canonical identity`,
    ).toBe(200);

    const matrix = loadMatrix();
    let ready = 0;
    for (const symbol of STOCKS) {
      const response = await request.post("/api/market/ingest", {
        headers: mutationHeaders(baseURL!),
        data: { instrumentId: instrumentId(symbol) },
        timeout: 60_000,
      });
      // A refusal is a 200 with ok:false and a CODE — a transport failure is a defect.
      expect(response.status(), `${symbol} ingest transport status`).toBe(200);
      const outcome = (await response.json()) as {
        ok: boolean; code?: string; ready?: boolean; storedAfter?: number; message?: string;
      };
      expect(
        typeof outcome.code === "string" && outcome.code.length > 0,
        `${symbol} ingestion returned no stated code`,
      ).toBe(true);
      if (outcome.ready) ready += 1;
      matrix[symbol] = {
        symbol,
        ingestion: {
          code: outcome.code ?? "MISSING",
          ready: outcome.ready === true,
          storedAfter: outcome.storedAfter ?? 0,
          message: outcome.ok ? undefined : outcome.message?.slice(0, 200),
        },
      };
      console.log(`[stage2] ingest ${symbol} → ${outcome.code} ready=${outcome.ready} bars=${outcome.storedAfter}`);
    }
    saveMatrix(matrix);

    // The masterclass stop-condition: a Stage 2 where (almost) nothing ingested proves nothing.
    expect(
      ready,
      `only ${ready}/30 became researchable — a refusal-only sweep is not a completed Stage 2`,
    ).toBeGreaterThanOrEqual(MIN_READY);
  });

  for (const symbol of STOCKS) {
    test(`${symbol} — post-ingestion research reaches a terminal outcome that is NOT a data refusal`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name.includes("mobile"), "mission policy: desktop-only Playwright");
      // A real provider round-trip is the slow case; a hang still fails, just later. Poll sized to
      // the MEASURED tail: run 9 saw HCLTECH complete in 208s (agr_68c76e0185d546c9,
      // COMPLETED/SOURCE_VERIFIED) while a 150s poll expired — 300s is ~1.4× that observation.
      test.setTimeout(330_000);

      const matrix = loadMatrix();
      const row = matrix[symbol];
      expect(row, `${symbol} has no ingestion record — the sweep test must run first`).toBeTruthy();
      if (!row.ingestion.ready) {
        // An honestly-refused instrument (e.g. INSTRUMENT_UNKNOWN from the master) cannot be
        // researched; the matrix records the stated reason and this test documents it as skipped
        // rather than pretending a pass. The sweep's MIN_READY floor keeps this rare.
        test.skip(true, `${symbol} not researchable: ${row.ingestion.code} — recorded in the matrix`);
      }

      const problems = collectPageProblems(page);
      await page.goto(`/analyze/${encodeInstrument(symbol)}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await expect(page.getByTestId("ticker-not-found"), `${symbol} fell through to TickerNotFound`).toHaveCount(0);

      const control = page.getByTestId("research-stock");
      await expect(control, `${symbol} has no research control`).toBeVisible({ timeout: 15_000 });
      const stateLabel = page.getByTestId("research-stock-state");
      await page.getByTestId("research-stock-run").click();

      await expect
        .poll(async () => ((await stateLabel.textContent()) ?? "").trim(), {
          timeout: 300_000,
          message: `${symbol} never reached a terminal research state after ingestion`,
        })
        .toMatch(/^(PROPOSAL READY|NEEDS EVIDENCE|FAILED)$/);

      const terminal = ((await stateLabel.textContent()) ?? "").trim();
      let refusal: string | null = null;
      if (terminal === "FAILED") {
        const refusalLocator = page.getByTestId("research-stock-refusal");
        await expect(refusalLocator, `${symbol} FAILED without a stated refusal`).toBeVisible();
        refusal = ((await refusalLocator.textContent()) ?? "").trim().replace(/\s+/g, " ");
        expect(refusal, `${symbol} refusal has no code`).toMatch(/^[A-Z0-9_]+\s+—/);
        // THE Stage-2 assertion: history was ingested, so a data refusal is no longer honest.
        expect(
          refusal.startsWith("NO_STORED_DATA"),
          `${symbol} still refuses for MISSING DATA after a successful ingest — ingestion did not unlock research`,
        ).toBe(false);
      }
      if (terminal === "PROPOSAL READY") {
        await expect(page.getByTestId("research-stock-proposal")).toBeVisible();
      }

      row.research = { terminal, refusal };
      row.problems = problems;
      matrix[symbol] = row;
      saveMatrix(matrix);
      console.log(`[stage2] ${symbol} → ${terminal}${refusal ? ` :: ${refusal}` : ""}`);

      expect(problems, `${symbol} page problems:\n  - ${problems.join("\n  - ")}`).toEqual([]);
    });
  }

  test("stage-2 matrix: assembled, complete, and free of silent gaps", async ({}, testInfo) => {
    test.skip(testInfo.project.name.includes("mobile"), "mission policy: desktop-only Playwright");
    const matrix = loadMatrix();
    const rows = STOCKS.map((symbol) => matrix[symbol]).filter(Boolean);
    expect(rows.length, "every stock must have a matrix row").toBe(30);
    const researched = rows.filter((row) => row.research);
    const readyRows = rows.filter((row) => row.ingestion.ready);
    // No silent truncation: every researchable stock has a recorded research outcome.
    expect(
      researched.length,
      `${readyRows.length} stocks were researchable but only ${researched.length} carry a research outcome`,
    ).toBe(readyRows.length);
    const summary = {
      total: rows.length,
      researchable: readyRows.length,
      terminals: researched.reduce<Record<string, number>>((acc, row) => {
        const key = row.research!.terminal;
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {}),
    };
    console.log(`[stage2] MATRIX SUMMARY ${JSON.stringify(summary)}`);
  });
});
