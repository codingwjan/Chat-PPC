import { NextRequest, NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE_NAME } from "@/server/auth-cookie";

export function resolveAuthRedirect(pathname: string, hasAuthCookie: boolean): string | null {
  if (pathname === "/") {
    return hasAuthCookie ? "/chat" : "/login";
  }

  if (pathname.startsWith("/chat") && !hasAuthCookie) {
    return "/login";
  }

  return null;
}

export function middleware(request: NextRequest): NextResponse {
  const hasAuthCookie = Boolean(request.cookies.get(AUTH_SESSION_COOKIE_NAME)?.value);
  const target = resolveAuthRedirect(request.nextUrl.pathname, hasAuthCookie);
  if (!target) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = target;
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/", "/chat/:path*"],
};
