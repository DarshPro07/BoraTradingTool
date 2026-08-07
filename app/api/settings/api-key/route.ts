import { NextResponse } from "next/server";

export async function GET() {
  const active = !!process.env.FINNHUB_API_KEY?.trim();
  return NextResponse.json({ active });
}
