/**
 * Jupiter (Solana) market data — READ ONLY. Nothing here signs or sends a transaction.
 *
 * Adapted from AutoHedge's `tools/jupiter_*.py` (The-Swarm-Corporation, MIT), rewritten rather than
 * vendored. Its `ultra_tools.execute_trade` — signing swaps with a wallet private key — is
 * deliberately NOT ported: real crypto execution needs the owner's explicit go-ahead
 * (docs/plans/autohedge-intake/03-architecture.md).
 *
 * Access basis (checked 2026-09-19 against Jupiter's developer docs): keyless requests to
 * lite-api.jup.ag are documented at 30 req/min and being phased out; a free key from
 * portal.jup.ag gives 60 req/min on api.jup.ag. `JUPITER_API_KEY` switches automatically.
 */

export class JupiterUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JupiterUnavailable";
  }
}

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDC_DECIMALS = 6;

function base(): { url: string; headers: Record<string, string> } {
  const key = process.env.JUPITER_API_KEY?.trim();
  return key
    ? { url: "https://api.jup.ag", headers: { "x-api-key": key, Accept: "application/json" } }
    : { url: "https://lite-api.jup.ag", headers: { Accept: "application/json" } };
}

async function get<T>(path: string, params: Record<string, string>): Promise<T> {
  const { url, headers } = base();
  const query = new URLSearchParams(params).toString();
  let response: Response;
  try {
    response = await fetch(`${url}${path}?${query}`, { headers, signal: AbortSignal.timeout(10_000) });
  } catch (caught) {
    throw new JupiterUnavailable(`Jupiter unreachable: ${caught instanceof Error ? caught.message : String(caught)}`);
  }
  if (!response.ok) throw new JupiterUnavailable(`Jupiter ${path} answered HTTP ${response.status}`);
  return (await response.json()) as T;
}

export interface JupiterToken {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  verified: boolean;
  usdPrice: number | null;
  liquidityUsd: number | null;
}

/** Resolve a symbol to its token. Only an exact, VERIFIED symbol match counts: scam tokens copy names. */
export async function findVerifiedToken(symbol: string): Promise<JupiterToken | null> {
  const rows = await get<Array<Record<string, unknown>>>("/tokens/v2/search", { query: symbol });
  const wanted = symbol.trim().toUpperCase();
  const token = rows
    .map((row) => ({
      mint: String(row.id ?? ""),
      symbol: String(row.symbol ?? ""),
      name: String(row.name ?? ""),
      decimals: Number(row.decimals),
      verified: row.isVerified === true || (Array.isArray(row.tags) && row.tags.includes("verified")),
      usdPrice: typeof row.usdPrice === "number" ? row.usdPrice : null,
      liquidityUsd: typeof row.liquidity === "number" ? row.liquidity : null,
    }))
    .filter((t) => t.symbol.toUpperCase() === wanted && t.verified && t.mint && Number.isInteger(t.decimals))
    // Several verified tokens can share a symbol; the deepest market is the one people mean.
    .sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0))[0];
  return token ?? null;
}

export interface JupiterQuote {
  inAmount: number;
  outAmount: number;
  /**
   * Fraction, e.g. 0.004 = 0.4% — despite Jupiter naming the field `priceImpactPct`. Measured
   * 2026-09-19: a 5,000,000 USDC→SOL quote filled 0.513% worse than a 10 USDC one and reported
   * 0.00514. Reading it as a percent would have let a 50%-impact fill through a 1% cap.
   */
  priceImpact: number;
  route: string;
}

/** A swap quote in atomic units. The out amount already carries AMM fees and price impact. */
export async function getSwapQuote(input: {
  inputMint: string;
  outputMint: string;
  amount: bigint;
  slippageBps?: number;
}): Promise<JupiterQuote> {
  const quote = await get<Record<string, unknown>>("/swap/v1/quote", {
    inputMint: input.inputMint,
    outputMint: input.outputMint,
    amount: input.amount.toString(),
    slippageBps: String(input.slippageBps ?? 50),
  });
  const outAmount = Number(quote.outAmount);
  if (!Number.isFinite(outAmount) || outAmount <= 0) {
    throw new JupiterUnavailable(`Jupiter returned no usable quote (${String(quote.error ?? "no outAmount")})`);
  }
  const plan = Array.isArray(quote.routePlan) ? (quote.routePlan as Array<{ swapInfo?: { label?: string } }>) : [];
  return {
    inAmount: Number(quote.inAmount),
    outAmount,
    priceImpact: Math.abs(Number(quote.priceImpactPct ?? 0)),
    route: plan.map((step) => step.swapInfo?.label ?? "?").join(" > ") || "unknown",
  };
}
