import type { NextResponse } from "next/server";

const AUTH_COOKIE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const AUTH_COOKIE_VALUE = "active";

export const AUTH_SESSION_COOKIE_NAME = "chatppc.auth";

function resolveExpiry(sessionExpiresAt: string | null | undefined): Date {
  if (sessionExpiresAt) {
    const parsed = new Date(sessionExpiresAt);
    if (Number.isFinite(parsed.getTime())) {
      return parsed;
    }
  }

  return new Date(Date.now() + AUTH_COOKIE_TTL_MS);
}

function isSecureCookie(): boolean {
  return process.env.NODE_ENV === "production";
}

export function setAuthSessionCookie(
  response: NextResponse,
  session: { sessionExpiresAt?: string | null },
): void {
  response.cookies.set({
    name: AUTH_SESSION_COOKIE_NAME,
    value: AUTH_COOKIE_VALUE,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: isSecureCookie(),
    expires: resolveExpiry(session.sessionExpiresAt),
  });
}

export function clearAuthSessionCookie(response: NextResponse): void {
  response.cookies.set({
    name: AUTH_SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: isSecureCookie(),
    expires: new Date(0),
    maxAge: 0,
  });
}
