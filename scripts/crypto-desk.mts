/**
 * The trading desk's crypto (Solana) roles — PAPER ONLY. No wallet, no key, no signing.
 *
 *   quant  <SYMBOL>                              verified token, live price, computed daily technicals
 *   buy    <SYMBOL> --usdc 20 --thesis "..."     paper swap USDC -> token at a live Jupiter quote
 *   sell   <SYMBOL> --qty 0.1|--all --thesis "..." paper swap token -> USDC
 *   status                                       paper USDC, positions marked at a live exit quote
 *
 * Usage: npx tsx scripts/crypto-desk.mts quant SOL
 */
import { computeTechnicals } from "@/lib/data/technicals";
import { findVerifiedToken, getSwapQuote, USDC_MINT, USDC_DECIMALS, JupiterUnavailable } from "@/lib/crypto/jupiter";
import { cryptoPaperState, placeCryptoPaperOrder } from "@/lib/crypto/paper";
import { getYahooCandles } from "@/lib/providers/yahoo";

const [command, symbol] = process.argv.slice(2);
const flag = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const out = (value: unknown) => console.log(JSON.stringify(value, null, 2));

async function token(sym: string) {
  const found = await findVerifiedToken(sym);
  if (!found) {
    out({ verdict: "UNKNOWN_OR_UNVERIFIED", reason: `No Jupiter-verified token has the symbol ${sym}. Unverified tokens are refused: scam tokens copy names.` });
    process.exit(1);
  }
  return found;
}

try {
  if (command === "quant" && symbol) {
    const t = await token(symbol);
    const now = Math.floor(Date.now() / 1000);
    let technicals: unknown = "UNAVAILABLE: Yahoo has no daily series for this token";
    try {
      const candles = await getYahooCandles(`${symbol.toUpperCase()}-USD`, "D", now - 400 * 86_400, now);
      // Crypto never closes; today's bar is still forming, so structural levels read closed bars.
      if (candles.length >= 200) technicals = computeTechnicals(candles, { lastBarConfirmed: false });
      else technicals = `INSUFFICIENT_HISTORY: ${candles.length} daily bars, 200 needed`;
    } catch (caught) {
      technicals = `UNAVAILABLE: ${caught instanceof Error ? caught.message : String(caught)}`;
    }
    out({ token: t, technicals, source: { price: "Jupiter tokens v2", candles: `Yahoo ${symbol.toUpperCase()}-USD daily` } });
  } else if ((command === "buy" || command === "sell") && symbol) {
    const thesis = flag("thesis");
    if (!thesis || thesis.length < 10) throw new Error('--thesis "<why>" is required: every paper swap carries its reasoning');
    const t = await token(symbol);
    let amount: number;
    if (command === "buy") amount = Number(flag("usdc"));
    else if (process.argv.includes("--all")) {
      amount = cryptoPaperState().positions.find((p) => p.mint === t.mint)?.quantity ?? 0;
    } else amount = Number(flag("qty"));
    if (!(amount > 0)) throw new Error(command === "buy" ? "--usdc must be positive" : "--qty must be positive, or --all");
    const minute = new Date().toISOString().slice(0, 16);
    const result = await placeCryptoPaperOrder({
      token: t,
      side: command === "buy" ? "BUY" : "SELL",
      amount,
      thesis,
      idempotencyKey: `crypto-${command}-${t.symbol}-${amount}-${minute}`,
    });
    out(result);
  } else if (command === "status") {
    const state = cryptoPaperState();
    const marked = [];
    for (const p of state.positions) {
      // Marked at what a sell would actually return now, not at a mid price.
      const atomic = BigInt(Math.floor(p.quantity * 10 ** (await token(p.symbol)).decimals));
      const quote = await getSwapQuote({ inputMint: p.mint, outputMint: USDC_MINT, amount: atomic });
      const exitValue = quote.outAmount / 10 ** USDC_DECIMALS;
      marked.push({ ...p, exitValueUsdc: exitValue, unrealizedPnl: exitValue - p.quantity * p.averageCost });
    }
    out({ account: state.account, positions: marked, recentOrders: state.recentOrders });
  } else {
    console.error("usage: crypto-desk.mts quant|buy|sell <SYMBOL> ... | status   (see header)");
    process.exit(2);
  }
} catch (caught) {
  if (caught instanceof JupiterUnavailable) {
    out({ verdict: "JUPITER_UNAVAILABLE", reason: caught.message });
    process.exit(1);
  }
  throw caught;
}
