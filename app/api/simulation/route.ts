import { NextResponse } from "next/server";
import { z } from "zod";
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
