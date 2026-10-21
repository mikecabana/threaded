import { type NextRequest, NextResponse } from "next/server";
import { createOAuthState, OAUTH_COOKIE, OAUTH_COOKIE_MAX_AGE } from "@/lib/auth/oauth-state";
import { isThreadsLoginEnabled, threadsAppConfig } from "@/lib/threads/config";
import { buildAuthorizeUrl } from "@/lib/threads/oauth";

/** Starts Threads sign-in: sets the state cookie and sends the browser to Meta. */
export function GET(request: NextRequest) {
  if (!isThreadsLoginEnabled()) {
    return NextResponse.redirect(new URL("/connect?error=unavailable", request.url));
  }
  const { appId, redirectUri } = threadsAppConfig();
  const tz = request.nextUrl.searchParams.get("tz")?.slice(0, 64) || undefined;
  const { cookie, state } = createOAuthState(tz);

  const response = NextResponse.redirect(buildAuthorizeUrl({ appId, redirectUri, state }));
  response.cookies.set(OAUTH_COOKIE, cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/threads",
    maxAge: OAUTH_COOKIE_MAX_AGE,
  });
  return response;
}
