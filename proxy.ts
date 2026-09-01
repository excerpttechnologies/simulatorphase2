import { NextRequest, NextResponse } from "next/server";

const AUTH_COOKIE = "smsim_auth";

const DISABLED_AUTH_PAGES = ["/register", "/forgot-password"];

/**
 * Auth is in-memory only (React AuthContext). Route protection is client-side (AuthGuard).
 * Clear any legacy httpOnly cookie on every response so refresh cannot restore a session.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.match(/\.(png|jpg|jpeg|svg|ico|gif|webp|mp4|glb|rar|woff|woff2|ttf|otf|css|js)$/)
  ) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  if (DISABLED_AUTH_PAGES.some((r) => pathname.startsWith(r))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const response = NextResponse.next();
  response.cookies.set(AUTH_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
