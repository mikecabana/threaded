import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { provisionThreadsAccount } from "@/lib/accounts/provision";
import { OAUTH_COOKIE, verifyOAuthState } from "@/lib/auth/oauth-state";
import { GOAL_COOKIE } from "@/lib/goals";
import { startSession } from "@/lib/session/session";
import { createThreadsClient } from "@/lib/threads/client";
import { isThreadsLoginEnabled, threadsAppConfig } from "@/lib/threads/config";
import { ThreadsApiError } from "@/lib/threads/errors";
import { exchangeCode, exchangeForLongLived, THREADS_SCOPES } from "@/lib/threads/oauth";

function fail(request: NextRequest, reason: "denied" | "state" | "threads" | "unavailable") {
  return NextResponse.redirect(new URL(`/connect?error=${reason}`, request.url));
}

/** Meta redirects here after the user approves (or declines) Threads access. */
export async function GET(request: NextRequest) {
  if (!isThreadsLoginEnabled()) return fail(request, "unavailable");

  const params = request.nextUrl.searchParams;
  const store = await cookies();
  const state = verifyOAuthState(store.get(OAUTH_COOKIE)?.value, params.get("state"));
  store.delete({ name: OAUTH_COOKIE, path: "/api/auth/threads" });

  if (params.get("error")) return fail(request, "denied");
  const code = params.get("code");
  if (!state || !code) return fail(request, "state");

  const { appId, appSecret, redirectUri } = threadsAppConfig();
  try {
    const short = await exchangeCode({ appId, appSecret, redirectUri, code });
    const long = await exchangeForLongLived({ appSecret, shortLivedToken: short.accessToken });
    const profile = await createThreadsClient({ accessToken: long.accessToken }).getProfile();

    const account = await provisionThreadsAccount({
      profile,
      accessToken: long.accessToken,
      expiresAt: long.expiresAt,
      scopes: THREADS_SCOPES,
      timezone: state.tz,
    });
    await startSession(account.userId, request.headers.get("user-agent"));
    // Drop any demo goal so the account's own goal applies on the next paint.
    store.delete(GOAL_COOKIE);
    // Phase 1b starts the initial sync here and lands new profiles on /onboarding.
    return NextResponse.redirect(new URL("/home", request.url));
  } catch (error) {
    console.error("Threads sign-in failed", error instanceof ThreadsApiError ? error.message : error);
    return fail(request, "threads");
  }
}
