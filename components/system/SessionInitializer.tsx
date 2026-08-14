"use client";

import { useEffect } from "react";

/**
 * Initializes the invisible local session on app load.
 *
 * The server auto-generates a secure session secret. This component fetches a session cookie
 * once when the app mounts. All subsequent mutations via mutationFetch include the cookie
 * automatically (SameSite=Strict) plus the custom mutation header.
 *
 * Zero human friction — no token to type, no login to remember.
 */
export function SessionInitializer() {
  useEffect(() => {
    // Fetch the local session cookie. The server creates it automatically.
    void fetch("/api/session", { credentials: "same-origin" }).catch(() => {});
  }, []);
  return null;
}
