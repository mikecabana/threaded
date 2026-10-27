import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { provisionThreadsAccount } from "@/lib/accounts/provision";
import { relayOrigin } from "@/lib/auth/oauth-relay";
import { OAUTH_COOKIE, verifyOAuthState } from "@/lib/auth/oauth-state";
import { isPreviewOrigin } from "@/lib/deployment";
import { env } from "@/lib/env";
import { GOAL_COOKIE } from "@/lib/goals";
import { startSession } from "@/lib/session/session";
import { startSync } from "@/lib/sync/trigger";
import { createThreadsClient } from "@/lib/threads/client";
import { isThreadsLoginEnabled, threadsAppConfig } from "@/lib/threads/config";
import { ThreadsApiError } from "@/lib/threads/errors";
import { exchangeCode, exchangeForLongLived, signInScopes } from "@/lib/threads/oauth";

function fail(request: NextRequest, reason: "denied" | "state" | "threads" | "unavailable") {
  return NextResponse.redirect(new URL(`/connect?error=${reason}`, request.url));
}

/** Meta redirects here after the user approves (or declines) Threads access. */
export async function GET(request: NextRequest) {
  if (!isThreadsLoginEnabled()) return fail(request, "unavailable");

  const params = request.nextUrl.searchParams;
  const { appId, appSecret, redirectUri } = threadsAppConfig();

  // A sign-in that started on a preview deployment: send the browser (and
  // Meta's answer) back there, if the preview is one of ours.
  const returnTo = relayOrigin(params.get("state"), appSecret);
  if (returnTo && returnTo !== request.nextUrl.origin) {
    if (!isPreviewOrigin(returnTo)) return fail(request, "state");
    const target = new URL("/api/auth/threads/callback", returnTo);
    target.search = request.nextUrl.search;
    return NextResponse.redirect(target);
  }

  const store = await cookies();
  const state = verifyOAuthState(store.get(OAUTH_COOKIE)?.value, params.get("state"));
  store.delete({ name: OAUTH_COOKIE, path: "/api/auth/threads" });

  if (params.get("error")) return fail(request, "denied");
  const code = params.get("code");
  if (!state || !code) return fail(request, "state");

  try {
    const short = await exchangeCode({ appId, appSecret, redirectUri, code });
    const long = await exchangeForLongLived({ appSecret, shortLivedToken: short.accessToken });
    const profile = await createThreadsClient({ accessToken: long.accessToken }).getProfile();

    const account = await provisionThreadsAccount({
      profile,
      accessToken: long.accessToken,
      expiresAt: long.expiresAt,
      scopes: signInScopes(env.THREADS_KEYWORD_SEARCH === "1"),
      timezone: state.tz,
    });
    await startSession(account.userId, request.headers.get("user-agent"));
    // Drop any demo goal so the account's own goal applies on the next paint.
    store.delete(GOAL_COOKIE);
    if (!account.lastSyncedAt) {
      // The Read plays the first sync live. If it can't start, The Read
      // offers a "Start sync" button instead, so sign-in still succeeds.
      await startSync(account.profileId, "initial").catch((error) =>
        console.error("Could not start the first sync", error),
      );
      return NextResponse.redirect(new URL("/onboarding/analyzing", request.url));
    }
    return NextResponse.redirect(new URL("/home", request.url));
  } catch (error) {
    console.error("Threads sign-in failed", error instanceof ThreadsApiError ? error.message : error);
    return fail(request, "threads");
  }
}
