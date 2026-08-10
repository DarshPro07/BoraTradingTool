import { expect, test } from "@playwright/test";

/**
 * The held-hypothesis inbox (master item 15).
 *
 * A hypothesis the triage refuses is recorded with its reason and must be VISIBLE — the owner's
 * queue of ideas waiting on a feature, not a silent swallow. Before this panel, held rows existed
 * only in the database.
 */

function headers(baseURL: string) {
  return { "content-type": "application/json", origin: baseURL, "x-marketpulse-csrf": "1" };
}

const RUN_STAMP = Date.now().toString(36);

test("a held hypothesis appears in the inbox with its held status, not silently vanished", async ({
  page,
  baseURL,
}, testInfo) => {
  const title = `Inbox held probe ${RUN_STAMP} ${testInfo.project.name}`;

  // A real refusal path: sentiment/market-cap features are not derivable from price bars, so the
  // triage holds this rather than authoring a strategy that silently drops the condition.
  const posted = await page.request.post("/api/research/hypotheses", {
    headers: headers(baseURL!),
    data: {
      title,
      statement:
        "Buy NSE stocks when market cap is below 5000 crore and news sentiment has been positive for two consecutive days, exit after three days.",
      market: "NSE",
    },
  });
  // Recording succeeds (201) even when authoring is refused — the refusal is the payload.
  expect(posted.status()).toBe(201);
  const body = await posted.json();
  expect(body.verdict).toBe("NEEDS_FEATURE");
  expect(body.authored).toBeNull();

  await page.goto("/strategies?market=NSE", { waitUntil: "domcontentloaded" });
  const inbox = page.getByTestId("hypothesis-inbox");
  await expect(inbox).toBeVisible();

  const row = page.getByTestId("hypothesis-inbox-row").filter({ hasText: title });
  await expect(row).toBeVisible();
  await expect(row).toContainText(/HELD/);

  // Refresh is a real control, and the record survives it — this is a queue, not a toast.
  await page.getByTestId("hypothesis-inbox-refresh").click();
  await expect(page.getByTestId("hypothesis-inbox-row").filter({ hasText: title })).toBeVisible();
});
