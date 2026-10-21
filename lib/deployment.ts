// Where this deployment lives, and where the live app lives. Nothing here
// hardcodes a domain: on Vercel the production URL comes from
// VERCEL_PROJECT_PRODUCTION_URL (the project's vercel.app URL until a custom
// domain is added, then that domain), so buying a domain later needs no code
// change. Functions take the environment as an argument so they're testable.

/** process.env, or a stand-in in tests. Reads APP_URL, THREADS_REDIRECT_URI, PREVIEW_ORIGINS and Vercel's system variables. */
type Env = Record<string, string | undefined>;

const https = (host: string | undefined) => (host ? `https://${host}` : null);

/** The live app's origin: APP_URL if set, else Vercel's production domain. Null when neither is known. */
export function productionOrigin(env: Env = process.env): string | null {
  if (env.APP_URL) return new URL(env.APP_URL).origin;
  return https(env.VERCEL_PROJECT_PRODUCTION_URL);
}

/**
 * The one Threads redirect URL registered with Meta, which only accepts exact
 * matches. Every deployment sends people there; a preview's sign-in is relayed
 * back to it (lib/auth/oauth-relay.ts).
 */
export function threadsCallbackUrl(env: Env = process.env): string | null {
  if (env.THREADS_REDIRECT_URI) return env.THREADS_REDIRECT_URI;
  const origin = productionOrigin(env);
  return origin ? `${origin}/api/auth/threads/callback` : null;
}

/**
 * Whether `origin` is one of this project's preview deployments, per
 * PREVIEW_ORIGINS: comma-separated origins where `*` stands for one URL label
 * fragment, e.g. "https://threaded-*-acme.vercel.app" covers both
 * threaded-git-my-branch-acme.vercel.app and threaded-3k2j1h-acme.vercel.app.
 */
export function isPreviewOrigin(origin: string, env: Env = process.env): boolean {
  const patterns = (env.PREVIEW_ORIGINS ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return patterns.some((pattern) => {
    const regex = new RegExp(
      `^${pattern
        .split("*")
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("[a-z0-9-]+")}$`,
      "i",
    );
    return regex.test(origin);
  });
}

/**
 * Whether Threads sign-in can work on this deployment: anywhere the callback
 * is known, except previews that aren't in PREVIEW_ORIGINS (the production
 * callback won't relay to them).
 */
export function signInAvailableHere(env: Env = process.env): boolean {
  if (!threadsCallbackUrl(env)) return false;
  if (env.VERCEL_ENV !== "preview") return true;
  return [https(env.VERCEL_BRANCH_URL), https(env.VERCEL_URL)].some(
    (origin) => origin !== null && isPreviewOrigin(origin, env),
  );
}
