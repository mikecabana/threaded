import { type NextRequest, NextResponse } from "next/server";
import { DEMO_COOKIE, SESSION_COOKIE } from "@/lib/session/cookies";

/**
 * Cheap gate for app routes: no session cookie, no app. Pages still validate
 * the session themselves (see lib/session/viewer.ts); this only saves a render.
 */
export function proxy(request: NextRequest) {
  if (request.cookies.has(DEMO_COOKIE) || request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.next();
  }
  return NextResponse.redirect(new URL("/", request.url));
}

export const config = {
  matcher: ["/home/:path*", "/studio/:path*", "/queue/:path*", "/insights/:path*", "/settings/:path*"],
};
