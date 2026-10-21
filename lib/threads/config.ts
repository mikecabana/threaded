import "server-only";
import { signInAvailableHere, threadsCallbackUrl } from "@/lib/deployment";
import { env, requireEnv } from "@/lib/env";

/**
 * Real Threads sign-in needs the Meta app, a database, both secrets and a
 * known callback URL. Previews also need to be listed in PREVIEW_ORIGINS (see
 * lib/auth/oauth-relay.ts); DEMO_MODE=1 turns sign-in off entirely.
 */
export function isThreadsLoginEnabled(): boolean {
  return (
    env.DEMO_MODE !== "1" &&
    signInAvailableHere() &&
    Boolean(
      env.THREADS_APP_ID && env.THREADS_APP_SECRET && env.DATABASE_URL && env.SECRETS_ENC_KEY && env.SESSION_SECRET,
    )
  );
}

export function threadsAppConfig() {
  const redirectUri = threadsCallbackUrl();
  if (!redirectUri) throw new Error("Set THREADS_REDIRECT_URI or APP_URL (or deploy on Vercel). See docs/SETUP.md.");
  return {
    appId: requireEnv("THREADS_APP_ID"),
    appSecret: requireEnv("THREADS_APP_SECRET"),
    redirectUri,
  };
}
