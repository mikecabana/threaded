import "server-only";
import { env, requireEnv } from "@/lib/env";

/**
 * Real Threads sign-in needs the Meta app, a database and both secrets. Preview
 * deployments (DEMO_MODE=1) stay demo-only because Meta requires exact
 * redirect URLs.
 */
export function isThreadsLoginEnabled(): boolean {
  return (
    env.DEMO_MODE !== "1" &&
    Boolean(
      env.THREADS_APP_ID &&
        env.THREADS_APP_SECRET &&
        env.THREADS_REDIRECT_URI &&
        env.DATABASE_URL &&
        env.SECRETS_ENC_KEY &&
        env.SESSION_SECRET,
    )
  );
}

export function threadsAppConfig() {
  return {
    appId: requireEnv("THREADS_APP_ID"),
    appSecret: requireEnv("THREADS_APP_SECRET"),
    redirectUri: requireEnv("THREADS_REDIRECT_URI"),
  };
}
