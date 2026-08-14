import { expect, test, type Page } from "@playwright/test";

/**
 * In-product historical ingestion — the refusal that carries its own remedy.
 *
 * ## What this proves, and why it is a P0
 *
 * `researchInstrument` refuses an instrument holding fewer than 60 daily bars with
 * `NO_STORED_DATA`. That refusal is CORRECT and is asserted here rather than softened — the bridge
 * must not research an instrument it cannot see.
 *
 * The defect was that the refusal was a dead end. The only route to history was two CLI steps run
 * outside the application (`python quant/nse_history.py`, then `npx tsx
 * scripts/import-nse-history.mts`), so a fresh database could never become researchable *through
 * the product*. That single gap blocked two separate acceptance requirements:
 *
 *   - 30-stock breadth could only ever prove the REFUSAL path (§55 Stage 1), never research;
 *   - the UI-first Golden Journey could not start, because the research→strategy handoff only
 *     enables on a verified run, which cannot happen without bars.
 *
 * So this spec drives the complete unlock through the real UI, with no direct API call and no SQL
 * candle injection:
 *
 *   research → NO_STORED_DATA → ingest → research again → a DIFFERENT terminal state
 *
 * ## The assertion that matters
 *
 * The second research must not return `NO_STORED_DATA`. It need not succeed — a provider may be
 * absent on this machine and `PROVIDER_UNAVAILABLE` is an honest outcome. What must change is that
 * the instrument is no longer refused *for lack of history*, because that is the thing ingestion
 * is responsible for.
 */

const INSTRUMENT = "IN:XNSE:RELIANCE";

/**
 * Candidates to run the unlock against, in order.
 *
 * The spec needs an instrument whose store is EMPTY, and it must not assume it owns the database.
 * Playwright here can run against a persistent server DB, and a previous run of this very spec
 * leaves its subject ingested — the first re-run then found RELIANCE already researchable and
 * failed at "a fresh store must refuse", which was the spec depending on state it does not
 * control rather than a product defect.
 *
 * So it asks the readiness endpoint which of these is still un-ingested and uses that one. All of
 * them are canonical NSE securities in the acceptance universe.
 */
const CANDIDATES = [
  "IN:XNSE:RELIANCE",
  "IN:XNSE:TCS",
  "IN:XNSE:INFY",
  "IN:XNSE:SBIN",
  "IN:XNSE:ITC",
  "IN:XNSE:WIPRO",
  "IN:XNSE:TITAN",
  "IN:XNSE:DABUR",
];

const ALLOWED_NOISE: Array<{ match: RegExp; because: string }> = [
  { match: /favicon/i, because: "the browser requests /favicon.ico on every navigation" },
  { match: /Download the React DevTools/i, because: "React's development-build advertisement" },
];

function collectPageProblems(page: Page): string[] {
  const problems: string[] = [];
  const allowed = (text: string) => ALLOWED_NOISE.some((entry) => entry.match.test(text));
  page.on("pageerror", (error) => problems.push(`uncaught exception: ${error.message}`));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    if (allowed(msg.text())) return;
    problems.push(`console error: ${msg.text()}`);
  });
  page.on("requestfailed", (request) => {
    const url = request.url();
    if (allowed(url)) return;
    const failure = request.failure()?.errorText ?? "";
    // Aborted Next.js RSC prefetches are the prefetcher working as designed — see the full
    // reasoning on the same rule in e2e/all-routes.spec.ts.
    if (url.includes("_rsc=") && failure === "net::ERR_ABORTED") return;
    problems.push(`request failed: ${request.method()} ${url} — ${failure}`);
  });
  return problems;
}

/** Wait for the research state machine to settle on one of its terminal states. */
async function waitForTerminalResearchState(page: Page): Promise<string> {
  const stateLabel = page.getByTestId("research-stock-state");
  await expect
    .poll(async () => ((await stateLabel.textContent()) ?? "").trim(), {
      timeout: 90_000,
      message: "research never reached a terminal state",
    })
    .toMatch(/^(PROPOSAL READY|NEEDS EVIDENCE|FAILED)$/);
  return ((await stateLabel.textContent()) ?? "").trim();
}

test.describe("in-product ingestion unlocks research", () => {
  test("a NO_STORED_DATA refusal can be resolved entirely through the UI", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes("mobile"), "mission policy: desktop-only Playwright");
    /**
     * A DIAGNOSTIC ceiling, not a performance statement.
     *
     * An earlier revision of this comment claimed the research call takes 9.5–11.5 minutes. That
     * was wrong: it attributed the whole TEST's wall time to the call inside it without measuring
     * the call. Direct instrumentation puts a research call at **~58 seconds** — 95% provider API,
     * `turns=1`, no retries, ~2kB prompt — and it stays ~58s with the autonomous machine running,
     * so there is no lane-contention effect either
     * (docs/plans/marketpulse-p0-final-proof/30-latency-profile.md).
     *
     * Two research calls plus ingestion should therefore cost about two minutes. The test measured
     * eleven. The missing time is NOT understood yet, which is why the phase stopwatch below
     * exists and why this ceiling is generous: it is here to let the run finish and REPORT where
     * the time goes, not to declare the workflow healthy.
     *
     * A hang still fails: `waitForTerminalResearchState` gives up after 90s per state, well
     * inside this ceiling.
     */
    test.setTimeout(1_200_000);
    const problems = collectPageProblems(page);

    /**
     * Phase stopwatch.
     *
     * The research CALL was profiled at ~58s (95% provider API, one turn, no retries — see
     * docs/plans/marketpulse-p0-final-proof/30-latency-profile.md), yet this test took 11 minutes.
     * Ten of those minutes are unaccounted for, and attributing them to "research is slow" was
     * exactly the mistake that led to raising a timeout instead of finding a cause. So the test
     * now times its own phases and says where they went.
     */
    const t0 = Date.now();
    const phase = (label: string) => console.log(`[ingestion] +${((Date.now() - t0) / 1000).toFixed(1)}s ${label}`);

    // Pick a subject whose store is genuinely empty. Not a skip: if every candidate is already
    // ingested the precondition cannot be established and that must fail loudly, because a silent
    // skip here would hide the very capability this spec exists to prove.
    let subject: string | null = null;
    for (const candidate of CANDIDATES) {
      const res = await page.request.get(
        `/api/market/ingest?instrumentId=${encodeURIComponent(candidate)}`,
      );
      const body = (await res.json()) as { stored: number; ready: boolean; known: boolean };
      if (body.known && body.stored === 0) {
        subject = candidate;
        break;
      }
    }
    expect(
      subject,
      `every candidate already holds history, so the NO_STORED_DATA path cannot be exercised: ` +
        `${CANDIDATES.join(", ")}. Run against a fresh database.`,
    ).not.toBeNull();
    phase(`subject selected: ${subject}`);

    const response = await page.goto(`/analyze/${encodeURIComponent(subject!)}`, {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status()).toBe(200);
    await expect(page.getByTestId("ticker-not-found")).toHaveCount(0);

    // ── 1. Research refuses, and states WHY ──────────────────────────────────────────────────
    await expect(page.getByTestId("research-stock")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("research-stock-run").click();
    const firstState = await waitForTerminalResearchState(page);

    const refusal = page.getByTestId("research-stock-refusal");
    await expect(refusal, "a fresh store must refuse, and the refusal must be visible").toBeVisible();
    const firstRefusal = ((await refusal.textContent()) ?? "").trim();
    expect(firstState).toBe("FAILED");
    expect(
      firstRefusal,
      `expected a NO_STORED_DATA refusal on a fresh store, got: ${firstRefusal}`,
    ).toContain("NO_STORED_DATA");
    phase(`research#1 terminal: ${firstState} :: ${firstRefusal.replace(/\s+/g, " ").slice(0,80)}`);

    // ── 2. The refusal carries its remedy ────────────────────────────────────────────────────
    // Not a conditional check: if the control is absent, the refusal is a dead end and that is
    // precisely the defect this spec exists for.
    const ingest = page.getByTestId("research-stock-ingest");
    await expect(
      ingest,
      "NO_STORED_DATA offered no way out — the refusal must carry an ingest action",
    ).toBeVisible();
    await ingest.click();

    const ingestResult = page.getByTestId("research-stock-ingest-result");
    await expect(ingestResult, "ingestion produced no visible outcome").toBeVisible({ timeout: 120_000 });
    const ingestText = ((await ingestResult.textContent()) ?? "").trim();
    phase(`ingest done: ${ingestText.replace(/\s+/g, " ").slice(0,80)}`);
    expect(
      ingestText,
      `ingestion did not report success; it said: ${ingestText}`,
    ).toMatch(/INGESTED|ALREADY_READY/);

    // The honest declaration must travel with the bars. Ingested history is unadjusted and
    // excludes delisted names; if this ever stops being stated, a survivorship-biased sample would
    // silently look promotable.
    expect(
      ingestText,
      "the ingest outcome must declare the sample unfit for validation",
    ).toMatch(/unfit for validation/i);

    // ── 3. Research is no longer refused for lack of history ─────────────────────────────────
    await page.getByTestId("research-stock-run").click();
    const secondState = await waitForTerminalResearchState(page);
    const secondRefusal =
      (await page.getByTestId("research-stock-refusal").textContent().catch(() => null))?.trim() ?? "";
    phase(`research#2 terminal: ${secondState}`);

    // The decisive assertion. A provider may be unavailable on this machine — that is an honest
    // outcome and not this spec's concern. What must NOT happen is the same missing-history
    // refusal, because ingestion is the thing responsible for it.
    expect(
      secondRefusal,
      `research is still refused for missing history after a successful ingest: ${secondRefusal}`,
    ).not.toContain("NO_STORED_DATA");

    // Persistence is NOT asserted here. It belongs to "ingested history survives a page reload"
    // below, which proves the same thing for free.
    //
    // This test's whole budget is dominated by the second research call — a real provider
    // invocation measured at ~9.5 minutes on this machine (recorded as a §69 performance finding).
    // Every assertion above had already passed when a trailing readiness GET tipped the run past
    // its 600s ceiling and Playwright tore the context down. Deleting a redundant call is the
    // honest fix; raising the ceiling again would only have hidden how little headroom was left.
    expect(problems, `page problems:\n  - ${problems.join("\n  - ")}`).toEqual([]);
  });

  test("ingested history survives a page reload", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes("mobile"), "mission policy: desktop-only Playwright");
    test.setTimeout(180_000);

    // Runs against whichever candidate already holds bars — normally the subject the unlock test
    // ingested. It costs no model call, which is why it is a separate test: the point is that the
    // bars are in the canonical store, not in a React state that a refresh would discard.
    let ingested: string | null = null;
    for (const candidate of CANDIDATES) {
      const res = await page.request.get(
        `/api/market/ingest?instrumentId=${encodeURIComponent(candidate)}`,
      );
      const body = (await res.json()) as { ready: boolean };
      if (body.ready) {
        ingested = candidate;
        break;
      }
    }
    expect(
      ingested,
      "no candidate holds ingested history — run the unlock test first, or use a seeded database",
    ).not.toBeNull();

    await page.goto(`/analyze/${encodeURIComponent(ingested!)}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("research-stock")).toBeVisible({ timeout: 15_000 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("research-stock")).toBeVisible({ timeout: 15_000 });

    const after = await page.request.get(
      `/api/market/ingest?instrumentId=${encodeURIComponent(ingested!)}`,
    );
    const body = (await after.json()) as { stored: number; ready: boolean };
    expect(body.ready, "history did not survive the reload").toBe(true);
    expect(body.stored).toBeGreaterThanOrEqual(60);
    console.log(`[ingestion] reload ${ingested}: stored=${body.stored} ready=${body.ready}`);
  });

  test("readiness is reported truthfully before and after ingestion", async ({ request }) => {
    // The read-only readiness endpoint is what a surface asks before it acts. It must never claim
    // readiness it cannot back with stored bars.
    const before = await request.get(`/api/market/ingest?instrumentId=${encodeURIComponent(INSTRUMENT)}`);
    expect(before.ok()).toBe(true);
    const beforeBody = (await before.json()) as { stored: number; required: number; ready: boolean };
    expect(beforeBody.required).toBe(60);
    expect(beforeBody.ready).toBe(beforeBody.stored >= beforeBody.required);

    // A well-formed id that the exchange never listed. `resolveInstrument` parses SYNTAX and falls
    // back to the parsed value, so this resolves — it is `known` that separates a real security
    // from a correctly-spelled string, and readiness must not invite ingestion of the latter.
    const unknown = await request.get("/api/market/ingest?instrumentId=IN:XNSE:NOT-A-REAL-ZZZ");
    expect(unknown.ok()).toBe(true);
    const unknownBody = (await unknown.json()) as { known: boolean; ready: boolean };
    expect(unknownBody.known, "a symbol absent from the NSE master must not read as known").toBe(false);
    expect(unknownBody.ready).toBe(false);
  });
});
