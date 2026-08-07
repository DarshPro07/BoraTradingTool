import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMutationAccess } from "@/lib/security/request";
import { runSimulationBattery } from "@/lib/simulation/battery";

export const dynamic = "force-dynamic";

/**
 * Runs the investment-mode simulation battery over a supplied return series.
 *
 * Returns are accepted rather than fetched because the caller owns the definition of a trade:
 * the backtest engine, the portfolio engine and forward paper records all produce net returns,
 * and each is a legitimate input. What this endpoint will not do is invent a series when none
 * is supplied — an empty body is a refusal, not a demonstration.
 */
const RequestSchema = z
  .object({
    returns: z.array(z.number().finite()).min(1).max(10_000),
    modelledRoundTripCost: z.number().min(0).max(0.1).optional(),
    folds: z.number().int().min(2).max(20).optional(),
    iterations: z.number().int().min(100).max(20_000).optional(),
    seed: z.number().int().optional(),
    label: z.string().max(120).optional(),
  })
  .strict();

export async function POST(request: Request) {
  // Guarded despite persisting nothing.
  //
  // Every other mutating route in the app carries this and this one did not, which made it the
  // single reachable endpoint that runs unbounded work for an unauthenticated caller: up to
  // 20,000 bootstrap iterations over 10,000 returns, synchronously, per request. "It only
  // computes" is not a reason to leave it open — CPU is the resource being spent, and any page
  // in any browser on this machine could spend it in a loop.
  //
  // `requireMutationAccess` also brings the loopback-Host and Origin checks, which is what stops
  // a DNS-rebound page from reaching it at all.
  const denied = requireMutationAccess(request);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "INVALID_JSON", message: "The request body could not be parsed as JSON." },
      { status: 400 },
    );
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "INVALID_REQUEST",
        message: parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
          .join("; "),
      },
      { status: 400 },
    );
  }

  const { returns, label, ...options } = parsed.data;
  const report = runSimulationBattery(returns, options);

  return NextResponse.json(
    { label: label ?? null, ...report },
    { headers: { "cache-control": "no-store" } },
  );
}
