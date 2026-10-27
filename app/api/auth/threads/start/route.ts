import { type NextRequest, NextResponse } from "next/server";
import { relayState } from "@/lib/auth/oauth-relay";
import { createOAuthState, OAUTH_COOKIE, OAUTH_COOKIE_MAX_AGE } from "@/lib/auth/oauth-state";
import { randomToken } from "@/lib/crypto/sign";
import { isPreviewOrigin } from "@/lib/deployment";
import { env } from "@/lib/env";
import { isThreadsLoginEnabled, threadsAppConfig } from "@/lib/threads/config";
import { buildAuthorizeUrl, signInScopes } from "@/lib/threads/oauth";

/**
 * Starts Threads sign-in: sets the state cookie and sends the browser to Meta.
 * Meta always returns to the registered (production) callback; a preview
 * deployment marks the state so production relays the browser back here.
 */
export function GET(request: NextRequest) {
  const unavailable = () => NextResponse.redirect(new URL("/connect?error=unavailable", request.url));
  if (!isThreadsLoginEnabled()) return unavailable();
  const { appId, appSecret, redirectUri } = threadsAppConfig();
  const here = request.nextUrl.origin;
  const relay = here !== new URL(redirectUri).origin;
  if (relay && !isPreviewOrigin(here)) return unavailable();

  const tz = request.nextUrl.searchParams.get("tz")?.slice(0, 64) || undefined;
  const nonce = randomToken(24);
  const { cookie, state } = createOAuthState(tz, relay ? relayState(nonce, here, appSecret) : nonce);

  const scopes = signInScopes(env.THREADS_KEYWORD_SEARCH === "1");
  const response = NextResponse.redirect(buildAuthorizeUrl({ appId, redirectUri, state, scopes }));
  response.cookies.set(OAUTH_COOKIE, cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/threads",
    maxAge: OAUTH_COOKIE_MAX_AGE,
  });
  return response;
}
