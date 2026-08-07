import { NextResponse } from "next/server";
import { getDb, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { requireMutationAccess } from "@/lib/security/request";
import { readBoundedString, readJsonObject } from "@/lib/http/input";

export async function GET() {
  const db = getDb();
  const rows = db.select().from(schema.userWatchlist).all();
  return NextResponse.json(rows.map((r) => r.ticker));
}

export async function POST(req: Request) {
  const denied = requireMutationAccess(req);
  if (denied) return denied;
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return parsed.response;
  const normalized = readBoundedString(parsed.value.ticker, {
    min: 1,
    max: 40,
    pattern: /^[A-Za-z0-9:._^-]+$/,
  })?.toUpperCase();
  if (!normalized) {
    return NextResponse.json({ error: "invalid ticker" }, { status: 400 });
  }
  const db = getDb();
  db.insert(schema.userWatchlist)
    .values({ ticker: normalized, addedAt: new Date() })
    .onConflictDoNothing()
    .run();
  return NextResponse.json({ ok: true, ticker: normalized });
}

export async function DELETE(req: Request) {
  const denied = requireMutationAccess(req);
  if (denied) return denied;
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return parsed.response;
  const ticker = readBoundedString(parsed.value.ticker, {
    min: 1,
    max: 40,
    pattern: /^[A-Za-z0-9:._^-]+$/,
  });
  if (!ticker) return NextResponse.json({ error: "invalid ticker" }, { status: 400 });
  const db = getDb();
  db.delete(schema.userWatchlist).where(eq(schema.userWatchlist.ticker, ticker.toUpperCase())).run();
  return NextResponse.json({ ok: true });
}
