import { expect, test, type Page, type Request } from "@playwright/test";

/**
 * P0 DIAGNOSTIC — where do the twenty minutes go between "server answered" and "UI settled"?
 *
 * ## The measurement that motivates this
 *
 * From a fresh database, with phase stamps in `e2e/ingestion-unlock.spec.ts`:
 *
 *   +0.1s     subject selected
 *   +1.5s     research#1 terminal: FAILED :: NO_STORED_DATA
 *   +1.7s     ingest done: 260 daily bars
 *   +1249.6s  research#2 terminal: PROPOSAL READY      ← twenty minutes later
 *
 * The server, in that same run, logged exactly ONE research call and finished it in 48.6 seconds:
 *
 *   [gateway]  claude-code wall=48639ms api=45932ms turns=1
 *   [research] evidence-packet=10ms provider-probe=354ms model-call=48644ms
 *
 * So roughly twenty minutes elapse AFTER the server has produced the answer. That is not model
 * latency, and it is not lane contention (measured: 57.5s loaded vs 58.0s idle).
 *
 * ## What this spec is for
 *
 * Three explanations remain, and they demand different fixes. This separates them instead of
 * guessing:
 *
 *   A. THE BROWSER NEVER RECEIVED / FINISHED THE RESPONSE.
 *      → `requestfinished` never fires, or fires very late. A server/transport defect.
 *
 *   B. THE PAGE UPDATED, BUT PLAYWRIGHT COULD NOT SEE IT.
 *      → `page.evaluate` reads the terminal state promptly while `locator.textContent()` does
 *        not. A test-harness defect: `textContent()` inherits `actionTimeout`, which this repo
 *        never sets, so it is UNBOUNDED — and an outer `expect.poll` timeout bounds the LOOP, not
 *        an in-flight callback.
 *
 *   C. THE CLIENT NEVER APPLIED THE STATE.
 *      → Both read paths keep returning the stale value long after the response finished. A React
 *        state/closure/cache defect in `ResearchThisStock`.
 *
 * Every boundary is stamped against one clock so the three are distinguishable in one run.
 */

const CANDIDATES = [
  "IN:XNSE:RELIANCE",
  "IN:XNSE:TCS",
  "IN:XNSE:INFY",
  "IN:XNSE:SBIN",
  "IN:XNSE:ITC",
  "IN:XNSE:WIPRO",
  // Reserve candidates: after the breadth suites ingest the whole 30-security acceptance
  // universe, no real name has an empty store — but the boundary-attribution scenario needs one,
  // and the canonical store is deliberately append-only. These two SYNTHETIC fixture-master rows
  // (TEST_MODE only, TEST_FIXTURE-provenanced) are master-known, fixture-servable, and traded by
  // no other spec — so at least one stays empty on a shared acceptance database.
  "IN:XNSE:BANKBE",
  "IN:XNSE:SMALLSME",
];

const RESEARCH_URL = "/api/research/stock";

interface RequestMark {
  url: string;
  method: string;
  startedAt: number;
  headersAt: number | null;
  finishedAt: number | null;
  failedAt: number | null;
  failure: string | null;
  status: number | null;
}

/** Tracks the full lifecycle of every request so a pending one can be named on timeout. */
function traceRequests(page: Page, t0: () => number): Map<Request, RequestMark> {
  const marks = new Map<Request, RequestMark>();
  page.on("request", (request) => {
    marks.set(request, {
      url: request.url(),
      method: request.method(),
      startedAt: t0(),
      headersAt: null,
      finishedAt: null,
      failedAt: null,
      failure: null,
      status: null,
    });
  });
  page.on("response", (response) => {
    const mark = marks.get(response.request());
    if (!mark) return;
    mark.headersAt = t0();
    mark.status = response.status();
  });
  page.on("requestfinished", (request) => {
    const mark = marks.get(request);
    if (mark) mark.finishedAt = t0();
  });
  page.on("requestfailed", (request) => {
    const mark = marks.get(request);
    if (!mark) return;
    mark.failedAt = t0();
    mark.failure = request.failure()?.errorText ?? "unknown";
  });
  return marks;
}

test.describe("research hang — boundary attribution", () => {
  test("locate the gap between server completion and UI settle", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes("mobile"), "mission policy: desktop-only Playwright");
    // Bounded well under the observed 20-minute stall: this spec exists to REPORT the gap, and it
    // must fail with diagnostics rather than sit there.
    test.setTimeout(420_000);

    const started = Date.now();
    const at = () => Date.now() - started;
    const stamp = (label: string) => console.log(`[hang] +${(at() / 1000).toFixed(1)}s ${label}`);
    const marks = traceRequests(page, at);

    // ── Precondition: an instrument with NO history, so research#1 refuses cheaply ───────────
    let subject: string | null = null;
    for (const candidate of CANDIDATES) {
      const res = await page.request.get(
        `/api/market/ingest?instrumentId=${encodeURIComponent(candidate)}`,
        { timeout: 15_000 },
      );
      const body = (await res.json()) as { stored: number; known: boolean };
      if (body.known && body.stored === 0) {
        subject = candidate;
        break;
      }
    }
    expect(subject, "no candidate has an empty store — run against a fresh database").not.toBeNull();
    stamp(`subject ${subject}`);

    await page.goto(`/analyze/${encodeURIComponent(subject!)}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("research-stock")).toBeVisible({ timeout: 15_000 });

    // ── Ingest first, so the single research call under study is the SUCCESSFUL one ──────────
    await page.getByTestId("research-stock-run").click();
    await expect(page.getByTestId("research-stock-refusal")).toBeVisible({ timeout: 60_000 });
    stamp("research#1 refused");

    await page.getByTestId("research-stock-ingest").click();
    await expect(page.getByTestId("research-stock-ingest-result")).toBeVisible({ timeout: 120_000 });
    stamp("ingest complete");

    // ── The call under study ────────────────────────────────────────────────────────────────
    await page.getByTestId("research-stock-run").click();
    stamp("research#2 clicked");

    /**
     * Two independent read paths, polled together.
     *
     * `page.evaluate` runs in the page and returns the DOM's own view. `locator.textContent()`
     * goes through Playwright's actionability machinery. If they disagree — evaluate reports the
     * terminal state while textContent does not — the defect is in the harness (explanation B),
     * not the product. If both stay stale, the client never applied the state (explanation C).
     *
     * `evaluate` carries its own explicit timeout precisely because the unbounded-inner-await
     * problem is one of the things under investigation; a diagnostic must not exhibit the bug it
     * is measuring.
     */
    const readViaEvaluate = async (): Promise<string> =>
      page.evaluate(
        () =>
          document.querySelector('[data-testid="research-stock-state"]')?.textContent?.trim() ??
          "(absent)",
      );

    const TERMINAL = /^(PROPOSAL READY|NEEDS EVIDENCE|FAILED)$/;
    let evaluateTerminalAt: number | null = null;
    let responseFinishedAt: number | null = null;
    let lastEvaluate = "";

    const deadline = Date.now() + 300_000;
    while (Date.now() < deadline) {
      const value = await readViaEvaluate();
      if (value !== lastEvaluate) {
        lastEvaluate = value;
        stamp(`DOM state -> ${value}`);
      }
      if (TERMINAL.test(value) && evaluateTerminalAt === null && value !== "FAILED") {
        evaluateTerminalAt = at();
        stamp(`DOM reached terminal (${value})`);
      }

      // Has the research response actually completed on the wire? Track the LATEST research POST:
      // the refusal→ingest→research flow makes TWO calls, and the DOM terminal this loop accepts
      // (non-FAILED) belongs to the SECOND. Latching the first (the instant refusal) paired one
      // call's wire-finish with the OTHER call's DOM settle, and the "UI gap" silently absorbed
      // the entire legitimate ~50s second model call — a measurement defect reporting a UI defect.
      for (const mark of marks.values()) {
        if (mark.url.includes(RESEARCH_URL) && mark.method === "POST" && mark.finishedAt !== null) {
          if (responseFinishedAt === null || mark.finishedAt > responseFinishedAt) {
            responseFinishedAt = mark.finishedAt;
            stamp(
              `research POST finished on the wire: status=${mark.status} ` +
                `headers=+${((mark.headersAt ?? 0) / 1000).toFixed(1)}s ` +
                `finished=+${(mark.finishedAt / 1000).toFixed(1)}s`,
            );
          }
        }
      }

      if (evaluateTerminalAt !== null && responseFinishedAt !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }

    // ── Now, and only now, ask the locator — the path suspected of hanging ──────────────────
    stamp("querying via locator.textContent() with an explicit 30s bound");
    let locatorValue = "(timed out)";
    try {
      locatorValue = await Promise.race([
        page.getByTestId("research-stock-state").textContent({ timeout: 30_000 }),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error("locator.textContent did not settle in 30s")), 31_000),
        ),
      ]).then((value) => (value ?? "").trim());
    } catch (caught) {
      locatorValue = `(threw: ${caught instanceof Error ? caught.message : String(caught)})`;
    }
    stamp(`locator.textContent() -> ${locatorValue}`);

    // ── Report every request still pending: the §30 diagnostic ──────────────────────────────
    const pending = [...marks.values()].filter((m) => m.finishedAt === null && m.failedAt === null);
    stamp(`pending requests: ${pending.length}`);
    for (const mark of pending) {
      console.log(
        `[hang]   PENDING ${mark.method} ${mark.url} started=+${(mark.startedAt / 1000).toFixed(1)}s ` +
          `status=${mark.status ?? "-"} headers=${mark.headersAt === null ? "never" : "yes"}`,
      );
    }

    console.log(
      `[hang] ATTRIBUTION responseFinished=${responseFinishedAt === null ? "NEVER" : `+${(responseFinishedAt / 1000).toFixed(1)}s`} ` +
        `domTerminal=${evaluateTerminalAt === null ? "NEVER" : `+${(evaluateTerminalAt / 1000).toFixed(1)}s`} ` +
        `locator="${locatorValue}"`,
    );

    // The assertions state the expected healthy behaviour. Each failure names its explanation.
    expect(
      responseFinishedAt,
      "A: the research POST never finished on the wire — server/transport defect",
    ).not.toBeNull();
    expect(
      evaluateTerminalAt,
      "C: the DOM never reached a terminal state — the client did not apply the response",
    ).not.toBeNull();
    expect(
      evaluateTerminalAt! - responseFinishedAt!,
      "the UI took more than 30s to reflect a response that had already arrived",
    ).toBeLessThan(30_000);
    expect(
      locatorValue,
      "B: page.evaluate saw the terminal state but locator.textContent() did not — harness defect",
    ).toMatch(TERMINAL);
  });
});
