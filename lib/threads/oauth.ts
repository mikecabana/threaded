import { z } from "zod";
import { authorizeUrl, tokenHost } from "./endpoints";
import { ThreadsApiError } from "./errors";

// Threads OAuth: authorize → short-lived token (1h) → long-lived token (60d),
// refreshed before it expires. Endpoints checked against Meta's docs (Oct 2026).

/** Requested at sign-in. Read replies and keyword search come in a later phase. */
export const THREADS_SCOPES = ["threads_basic", "threads_manage_insights", "threads_content_publish"] as const;

export function buildAuthorizeUrl(input: {
  appId: string;
  redirectUri: string;
  state: string;
  scopes?: readonly string[];
}): string {
  const url = new URL(authorizeUrl());
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", (input.scopes ?? THREADS_SCOPES).join(","));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", input.state);
  return url.toString();
}

/** Meta sometimes appends "#_" to the code in the redirect; it isn't part of the code. */
export function cleanAuthCode(code: string): string {
  return code.replace(/#_$/, "");
}

// The response's user_id is a JSON number too large for JavaScript to hold
// exactly, so it isn't read: the profile id comes from GET /me as a string.
const shortTokenSchema = z.object({ access_token: z.string() });
const longTokenSchema = z.object({
  access_token: z.string(),
  token_type: z.string().optional(),
  expires_in: z.number(),
});

export interface LongLivedToken {
  accessToken: string;
  expiresAt: Date;
}

async function readToken<T extends z.ZodType>(response: Response, schema: T, step: string): Promise<z.infer<T>> {
  const body: unknown = await response.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!response.ok || !parsed.success) {
    const error = (body as { error?: { message?: string; code?: number; type?: string } } | null)?.error;
    throw new ThreadsApiError(error?.message ?? `Threads ${step} failed (${response.status})`, {
      status: response.status,
      code: error?.code,
      type: error?.type,
    });
  }
  return parsed.data;
}

export async function exchangeCode(
  input: { appId: string; appSecret: string; redirectUri: string; code: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ accessToken: string }> {
  const response = await fetchImpl(`${tokenHost()}/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: input.appId,
      client_secret: input.appSecret,
      grant_type: "authorization_code",
      redirect_uri: input.redirectUri,
      code: cleanAuthCode(input.code),
    }),
    cache: "no-store",
  });
  const token = await readToken(response, shortTokenSchema, "code exchange");
  return { accessToken: token.access_token };
}

export async function exchangeForLongLived(
  input: { appSecret: string; shortLivedToken: string },
  fetchImpl: typeof fetch = fetch,
  now = new Date(),
): Promise<LongLivedToken> {
  const url = new URL(`${tokenHost()}/access_token`);
  url.searchParams.set("grant_type", "th_exchange_token");
  url.searchParams.set("client_secret", input.appSecret);
  url.searchParams.set("access_token", input.shortLivedToken);
  const token = await readToken(await fetchImpl(url, { cache: "no-store" }), longTokenSchema, "token exchange");
  return { accessToken: token.access_token, expiresAt: new Date(now.getTime() + token.expires_in * 1000) };
}

/** Extends a long-lived token by another 60 days. It must be at least 24 hours old and unexpired. */
export async function refreshLongLived(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
  now = new Date(),
): Promise<LongLivedToken> {
  const url = new URL(`${tokenHost()}/refresh_access_token`);
  url.searchParams.set("grant_type", "th_refresh_token");
  url.searchParams.set("access_token", accessToken);
  const token = await readToken(await fetchImpl(url, { cache: "no-store" }), longTokenSchema, "token refresh");
  return { accessToken: token.access_token, expiresAt: new Date(now.getTime() + token.expires_in * 1000) };
}

/** Refresh when the token is older than a day and has under two weeks left. */
export function shouldRefresh(
  token: { expiresAt: Date; lastRefreshedAt: Date | null; createdAt?: Date },
  now = new Date(),
) {
  const issuedAt = token.lastRefreshedAt ?? token.createdAt ?? new Date(0);
  const oldEnough = now.getTime() - issuedAt.getTime() >= 24 * 3_600_000;
  const expiringSoon = token.expiresAt.getTime() - now.getTime() <= 14 * 86_400_000;
  return oldEnough && expiringSoon;
}
