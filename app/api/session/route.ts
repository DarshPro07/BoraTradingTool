import { NextResponse } from "next/server";
import { createLocalSession, LOCAL_SESSION_COOKIE } from "@/lib/security/request";

export const dynamic = "force-dynamic";

/**
 * Issue a local session to the browser.
 *
 * The server auto-generates a secure session secret on startup. The browser receives it as a
 * SameSite=Strict, HttpOnly cookie. No human enters a token — the loopback binding + origin check
 * + session + mutation header together form the invisible security boundary.
 */
export async function GET() {
  const session = createLocalSession();
  const response = NextResponse.json({ ok: true });
  response.cookies.set(LOCAL_SESSION_COOKIE, session, {
    httpOnly: true,
    sameSite: "strict",
    secure: false, // loopback is always http
    path: "/",
    maxAge: 8 * 60 * 60, // 8 hours
  });
  return response;
}
