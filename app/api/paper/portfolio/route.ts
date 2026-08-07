import { NextResponse } from "next/server";
import { getPaperPortfolio } from "@/lib/paper/service";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getPaperPortfolio());
}
