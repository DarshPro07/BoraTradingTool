import { NextResponse } from "next/server";
import { readJsonObject } from "@/lib/http/input";
import {
  createOwnerSession,
  OWNER_SESSION_COOKIE,
  requireMutationAccess,
} from "@/lib/security/request";

export async function POST(request: Request) {
  const denied = requireMutationAccess(request);
  if (denied) return denied;
  if (request.headers.has("authorization")) {
    return NextResponse.json({ error: "OWNER_ROLE_REQUIRED" }, { status: 403 });
  }

  const parsed = await readJsonObject(request);
  if (!parsed.ok) return parsed.response;
  const token = typeof parsed.value.token === "string" ? parsed.value.token : "";
  const session = createOwnerSession(token);
  if (!session) {
    return NextResponse.json(
      { error: "INVALID_OWNER_TOKEN", message: "The owner token is invalid or is not configured safely." },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ authenticated: true });
  response.cookies.set(OWNER_SESSION_COOKIE, session, {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: 15 * 60,
  });
  return response;
}

export async function DELETE(request: Request) {
  const denied = requireMutationAccess(request);
  if (denied) return denied;
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(OWNER_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return response;
}
