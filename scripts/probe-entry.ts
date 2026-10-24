/**
 * Gate 0 of docs/plans/cloud-clock: can the clock's own data code reach its providers from a
 * GitHub runner? Run by `.github/workflows/probe.yml` on a fresh, empty database.
 *
 * Prints statuses, counts and dates only, never prices: this repo is public, so its Actions logs are.
 * Exit 1 if any check fails.
 */
import { closeDatabase } from "@/lib/db";
import { realFundDeps } from "@/lib/fund/deps";
import { MANDATES } from "@/lib/fund/mandates";
import { ORB_CONTRACT } from "@/lib/intraday/orb";
import { getMarketSession } from "@/lib/market/calendar";
import { parseInstrument } from "@/lib/market/instruments";
import { getNormalizedCandles, getNormalizedQuote } from "@/lib/market/service";

export async function runProbe(now = new Date()): Promise<number> {
  const failed: string[] = [];
  const check = async (name: string, run: () => Promise<string>) => {
    try {
      console.log(`${name}: ${await run()}`);
    } catch (caught) {
      failed.push(name);
      console.log(`${name}: FAILED ${caught instanceof Error ? caught.message.slice(0, 160) : "error"}`);
    }
  };

  // Known answers, so a runner whose clock or calendar data differs from the laptop's is caught.
  await check("calendar", async () => {
    const monday = getMarketSession("IN", new Date("2026-10-26T04:30:00Z")).session;
    const saturday = getMarketSession("IN", new Date("2026-10-24T04:30:00Z")).session;
    if (monday !== "REGULAR" || saturday === "REGULAR") throw new Error(`Mon 10-26 ${monday}, Sat 10-24 ${saturday}`);
    return `Mon 10-26 10:00 IST ${monday}, Sat 10-24 ${saturday}`;
  });

  const to = Math.floor(now.getTime() / 1000);
  for (const id of ORB_CONTRACT.universe) {
    // Four days back, so a weekend run still reaches Friday's session.
    await check(`${id} 5m bars`, async () => {
      const { candles } = await getNormalizedCandles(parseInstrument(id), "5", to - 4 * 86_400, to);
      if (candles.length === 0) throw new Error("0 bars");
      return `${candles.length} bars`;
    });
    // STALE is normal outside the session; UNAVAILABLE means the provider did not answer.
    await check(`${id} quote`, async () => {
      const quality = (await getNormalizedQuote(parseInstrument(id))).provenance.quality;
      if (quality === "UNAVAILABLE") throw new Error("quote UNAVAILABLE");
      return `quality ${quality}`;
    });
  }

  // FN1's ingest goes through this same call. Its ingest itself needs the NSE security master, which
  // lives in the database (INSTRUMENT_UNKNOWN on an empty one), so the network part is tested here.
  await check("IN:XNSE:NIFTYBEES daily bars", async () => {
    const { candles } = await getNormalizedCandles(parseInstrument("IN:XNSE:NIFTYBEES"), "D", to - 30 * 86_400, to);
    if (candles.length === 0) throw new Error("0 bars");
    return `${candles.length} bars`;
  });
  for (const mandate of MANDATES.filter((m) => m.venue !== "NSE")) {
    await check(`${mandate.id} closes`, async () => {
      const closes = await realFundDeps.loadCloses(mandate, now);
      if (closes.length === 0) throw new Error("0 closes");
      return `${closes.length} closes, last ${closes.at(-1)!.date}`;
    });
  }

  closeDatabase();
  console.log(failed.length ? `PROBE FAILED: ${failed.join(", ")}` : "PROBE OK");
  return failed.length ? 1 : 0;
}
