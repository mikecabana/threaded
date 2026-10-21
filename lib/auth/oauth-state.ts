import "server-only";
import { z } from "zod";
import { randomToken, safeEqual, sign, unsign } from "@/lib/crypto/sign";

// The OAuth round trip keeps a signed, short-lived cookie holding the CSRF
// state plus what we need after Meta redirects back (the browser's timezone).

export const OAUTH_COOKIE = "threaded_oauth";
export const OAUTH_COOKIE_MAX_AGE = 10 * 60;

const stateSchema = z.object({ state: z.string().min(16).max(512), tz: z.string().max(64).optional(), at: z.number() });
export type OAuthState = z.infer<typeof stateSchema>;

/** `state` defaults to a random token; previews pass a relay state that carries their origin. */
export function createOAuthState(
  tz: string | undefined,
  state = randomToken(24),
  now = Date.now(),
): { cookie: string; state: string } {
  const value: OAuthState = { state, tz, at: now };
  return { cookie: sign(Buffer.from(JSON.stringify(value)).toString("base64url")), state: value.state };
}

/** Validates the cookie and the `state` Meta echoed back. Returns null on any mismatch. */
export function verifyOAuthState(
  cookie: string | undefined,
  returnedState: string | null,
  now = Date.now(),
): OAuthState | null {
  if (!cookie || !returnedState) return null;
  const payload = unsign(cookie);
  if (!payload) return null;
  try {
    const parsed = stateSchema.safeParse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    if (!parsed.success) return null;
    if (now - parsed.data.at > OAUTH_COOKIE_MAX_AGE * 1000) return null;
    return safeEqual(parsed.data.state, returnedState) ? parsed.data : null;
  } catch {
    return null;
  }
}
