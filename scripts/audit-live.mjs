/**
 * What can the running system actually DO? (not: does the page return 200)
 *
 * Reads the live app with a real browser and prints one line per capability: the fund watchdog's
 * own verdict, each mandate's NAV and gates, the paper book, the learning state, the strategy
 * registry, every screen's load time, and the refusal the broker endpoint gives.
 *
 * Usage:  npx next dev -p 3100   (or next start)
 *         node scripts/audit-live.mjs
 */
import { chromium } from "@playwright/test";
const BASE = "http://127.0.0.1:3100";
const log = (k, v) => console.log(`${k} :: ${v}`);
const b = await chromium.launch();
const page = await (await b.newContext()).newPage();
const errs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 110)); });
async function go(path, ms = 200000) {
  const t0 = Date.now();
  try { const r = await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: ms }); return { s: r?.status(), ms: Date.now() - t0 }; }
  catch { return { s: "TIMEOUT", ms: Date.now() - t0 }; }
}
const txt = async (sel) => (await page.locator(sel).first().innerText().catch(() => "")).replace(/\s+/g, " ").trim();

let r = await go("/fund"); log("fund.load", `${r.s} ${r.ms}ms`);
log("fund.health", (await txt('[data-testid="fund-health"]')).slice(0, 420));
for (const id of ["FN1", "FC1", "FC2"]) log(`fund.${id}`, ((await txt(`[data-testid="mandate-${id}"]`)) || "MISSING").slice(0, 230));
log("fund.gatesPASS", String(await page.locator('[data-testid^="gate-"]:has-text("PASS")').count()));
r = await go("/paper"); log("paper.load", `${r.s} ${r.ms}ms`); log("paper.body", (await txt("main")).slice(0, 420));
r = await go("/learning"); log("learning.load", `${r.s} ${r.ms}ms`); log("learning.body", (await txt("main")).slice(0, 300));
r = await go("/strategies"); log("strategies.load", `${r.s} ${r.ms}ms`); log("strategies.rows", String(await page.locator("table tbody tr").count())); log("strategies.body", (await txt("main")).slice(0, 300));
for (const p of ["/command", "/scanner", "/analyst", "/edge-factory", "/experiments", "/library", "/memory", "/jobs", "/data-quality", "/audit", "/dashboard", "/portfolio", "/brain", "/research", "/trades"]) {
  const x = await go(p, 150000); log("screen" + p, `${x.s} ${x.ms}ms`);
}
const res = await page.request.post(BASE + "/api/trade/place", { data: { symbol: "RELIANCE", side: "BUY", qty: 1 }, failOnStatusCode: false });
log("api.trade.place", `${res.status()} ${(await res.text()).slice(0, 150).replace(/\s+/g, " ")}`);
log("console.errors", errs.length ? errs.slice(0, 6).join(" | ") : "none");
await b.close();
