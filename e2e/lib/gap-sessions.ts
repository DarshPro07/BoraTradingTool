import type Database from "better-sqlite3";

/**
 * Deterministic 5-MINUTE gap sessions — the intraday twin of the daily gap recipe.
 *
 * The strategy-progression leg made autonomously authored NSE strategies be born INTRADAY (5m,
 * the product the ₹1,000 capital basis can actually trade), which the master run then proved the
 * hard way: the journey's gap strategies became 5m while the specs still seeded daily-only
 * histories, so the forward stage truthfully emitted zero signals over bars that did not exist.
 * This seeds what those strategies actually trade: sessions of 75 five-minute bars where every
 * third session OPENS gapped ≥4% above the prior session's close ON HEAVY VOLUME and continues
 * upward through the day — so gap_pct and rvol genuinely fire, continuations genuinely win, and
 * ninety-six sessions give the gauntlet's 30-trade floor real room.
 *
 * Count-guarded per instrument, so a shared acceptance database is never double-seeded.
 */
export function seedGapSessions5m(
  db: Database.Database,
  ticker: string,
  sessionOpenUtc: number,
  sessions = 96,
): void {
  const existing = db
    .prepare("SELECT COUNT(*) AS n FROM price_candles WHERE ticker = ? AND resolution = '5'")
    .get(ticker) as { n: number };
  if (existing.n >= sessions * 75 - 100) return;

  const insert = db.prepare(
    "INSERT INTO price_candles (ticker, resolution, time, open, high, low, close, volume) VALUES (?, '5', ?, ?, ?, ?, ?, ?)",
  );
  db.transaction(() => {
    let prevClose = 100;
    for (let session = 0; session < sessions; session += 1) {
      const gapSession = session % 3 === 0;
      const open = gapSession ? prevClose * 1.04 : prevClose * 1.001;
      const close = gapSession ? open * 1.012 : open * 1.001;
      const sessionStart = sessionOpenUtc - 200 * 86_400 + session * 86_400;
      // FRONT-LOADED continuation on gap sessions: the signal fires at the session's opening bar
      // and forward outcomes measure the NEXT bar — a linear drift makes that next bar a sliver
      // (+0.016%) that fees honestly eat, verdicting every challenger FAILS_POLICY. Real gap
      // continuations are front-loaded anyway; ~70% of the day's move lands in the first two
      // bars so the next-bar outcome carries a genuine, fee-surviving gain.
      const progress = (bar: number): number => {
        const t = Math.min(1, bar / 74);
        return gapSession ? Math.min(1, 0.7 * Math.min(1, bar / 2) + 0.3 * t) : t;
      };
      for (let bar = 0; bar < 75; bar += 1) {
        const barOpen = open + (close - open) * progress(bar);
        const barClose = open + (close - open) * progress(bar + 1);
        insert.run(
          ticker,
          sessionStart + bar * 300,
          barOpen,
          Math.max(barOpen, barClose) * 1.002,
          Math.min(barOpen, barClose) * 0.998,
          barClose,
          gapSession ? 4_000 : 1_000,
        );
      }
      prevClose = close;
    }
  })();
}
