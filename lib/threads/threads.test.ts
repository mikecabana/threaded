import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createThreadsClient } from "./client";
import { ThreadsApiError } from "./errors";
import { buildAuthorizeUrl, cleanAuthCode, exchangeCode, exchangeForLongLived, shouldRefresh } from "./oauth";
import { parseSignedRequest } from "./signed-request";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A fetch mock that answers by path and records the URLs it saw. */
function mockFetch(routes: Record<string, unknown | ((url: URL) => unknown)>) {
  const calls: URL[] = [];
  const impl = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    calls.push(url);
    const route = routes[url.pathname];
    if (route === undefined) return json({ error: { message: `no route ${url.pathname}`, code: 100 } }, 404);
    return json(typeof route === "function" ? (route as (u: URL) => unknown)(url) : route);
  });
  return { fetch: impl as unknown as typeof fetch, calls };
}

describe("Threads client", () => {
  it("maps the profile and sends the token", async () => {
    const { fetch, calls } = mockFetch({
      "/v1.0/me": { id: "42", username: "maya", threads_biography: "hi", is_verified: true },
    });
    const profile = await createThreadsClient({ accessToken: "tok", fetch }).getProfile();
    expect(profile).toEqual({
      id: "42",
      username: "maya",
      name: "maya",
      biography: "hi",
      profilePictureUrl: null,
      isVerified: true,
    });
    expect(calls[0].searchParams.get("access_token")).toBe("tok");
  });

  it("follows pagination until an empty page", async () => {
    const post = (id: string) => ({ id, text: id, timestamp: "2026-10-01T10:00:00+0000", media_type: "TEXT_POST" });
    let page = 0;
    const { fetch, calls } = mockFetch({
      "/v1.0/me/threads": () => {
        page++;
        if (page === 1)
          return {
            data: [post("a"), post("b")],
            paging: { next: "https://graph.threads.net/v1.0/me/threads?after=X&access_token=tok" },
          };
        return { data: [], paging: {} };
      },
    });
    const pages = [];
    for await (const batch of createThreadsClient({ accessToken: "tok", fetch }).listPosts()) pages.push(batch);
    expect(pages.flat().map((p) => p.id)).toEqual(["a", "b"]);
    expect(calls[1].searchParams.get("after")).toBe("X");
    expect(pages[0][0].timestamp).toBe("2026-10-01T10:00:00.000Z");
  });

  it("reads metrics whether they come as totals or values", async () => {
    const { fetch } = mockFetch({
      "/v1.0/m1/insights": {
        data: [
          { name: "views", values: [{ value: 120 }] },
          { name: "likes", total_value: { value: 9 } },
          { name: "replies", values: [{ value: 2 }] },
        ],
      },
    });
    const insights = await createThreadsClient({ accessToken: "tok", fetch }).getPostInsights("m1");
    expect(insights).toEqual({ views: 120, likes: 9, replies: 2, reposts: 0, quotes: 0, shares: 0 });
  });

  it("splits account insights into daily views and totals", async () => {
    const { fetch } = mockFetch({
      "/v1.0/me/threads_insights": {
        data: [
          {
            name: "views",
            values: [
              { value: 10, end_time: "2026-10-01T07:00:00+0000" },
              { value: 20, end_time: "2026-10-02T07:00:00+0000" },
            ],
          },
          { name: "followers_count", total_value: { value: 2400 } },
          { name: "likes", total_value: { value: 31 } },
        ],
      },
    });
    const insights = await createThreadsClient({ accessToken: "tok", fetch }).getAccountInsights({
      since: 1,
      until: 2,
    });
    expect(insights.dailyViews).toEqual([
      { date: "2026-10-01", views: 10 },
      { date: "2026-10-02", views: 20 },
    ]);
    expect(insights.followersCount).toBe(2400);
    expect(insights.likes).toBe(31);
  });

  it("raises typed errors for Graph error envelopes", async () => {
    const { fetch } = mockFetch({
      "/v1.0/me": () => ({ error: { message: "Session has expired", type: "OAuthException", code: 190 } }),
    });
    const error = await createThreadsClient({ accessToken: "tok", fetch })
      .getProfile()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ThreadsApiError);
    expect((error as ThreadsApiError).isAuthError).toBe(true);
  });

  it("rejects responses that don't match the schema", async () => {
    const { fetch } = mockFetch({ "/v1.0/me": { id: 42 } });
    await expect(createThreadsClient({ accessToken: "tok", fetch }).getProfile()).rejects.toThrow(/Unexpected/);
  });

  it("publishes in two steps", async () => {
    const { fetch, calls } = mockFetch({
      "/v1.0/me/threads": { id: "container-1" },
      "/v1.0/container-1": { id: "container-1", status: "FINISHED" },
      "/v1.0/me/threads_publish": { id: "media-9" },
    });
    const client = createThreadsClient({ accessToken: "tok", fetch });
    const container = await client.createTextContainer({ text: "hello", replyToId: "media-1" });
    expect((await client.getContainerStatus(container)).status).toBe("FINISHED");
    expect(await client.publish(container)).toBe("media-9");
    expect(calls[0].searchParams.get("media_type")).toBe("TEXT");
    expect(calls[0].searchParams.get("reply_to_id")).toBe("media-1");
    expect(calls[2].searchParams.get("creation_id")).toBe("container-1");
  });
});

describe("OAuth", () => {
  it("builds the authorize URL", () => {
    const url = new URL(buildAuthorizeUrl({ appId: "app", redirectUri: "https://x.test/cb", state: "s1" }));
    expect(url.origin + url.pathname).toBe("https://threads.net/oauth/authorize");
    expect(url.searchParams.get("scope")).toBe("threads_basic,threads_manage_insights,threads_content_publish");
    expect(url.searchParams.get("state")).toBe("s1");
  });

  it("strips Meta's #_ suffix from codes", () => {
    expect(cleanAuthCode("abc#_")).toBe("abc");
    expect(cleanAuthCode("abc")).toBe("abc");
  });

  it("exchanges a code, then upgrades to a long-lived token", async () => {
    const { fetch, calls } = mockFetch({
      "/oauth/access_token": { access_token: "short", user_id: 42 },
      "/access_token": { access_token: "long", token_type: "bearer", expires_in: 5_184_000 },
    });
    const short = await exchangeCode(
      { appId: "a", appSecret: "s", redirectUri: "https://x.test/cb", code: "c#_" },
      fetch,
    );
    expect(short).toEqual({ accessToken: "short", userId: "42" });
    const now = new Date("2026-10-20T00:00:00Z");
    const long = await exchangeForLongLived({ appSecret: "s", shortLivedToken: short.accessToken }, fetch, now);
    expect(long.accessToken).toBe("long");
    expect(long.expiresAt.toISOString()).toBe("2026-12-19T00:00:00.000Z");
    expect(calls[1].searchParams.get("grant_type")).toBe("th_exchange_token");
  });

  it("refreshes only tokens that are old enough and expiring soon", () => {
    const now = new Date("2026-10-20T00:00:00Z");
    const day = 86_400_000;
    const at = (offsetDays: number) => new Date(now.getTime() + offsetDays * day);
    expect(shouldRefresh({ expiresAt: at(10), lastRefreshedAt: at(-50) }, now)).toBe(true);
    expect(shouldRefresh({ expiresAt: at(40), lastRefreshedAt: at(-20) }, now)).toBe(false);
    expect(shouldRefresh({ expiresAt: at(10), lastRefreshedAt: new Date(now.getTime() - 3_600_000) }, now)).toBe(false);
  });
});

describe("signed_request", () => {
  const secret = "app-secret";
  const make = (payload: object, key = secret) => {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = createHmac("sha256", key).update(body).digest("base64url");
    return `${sig}.${body}`;
  };

  it("accepts a correctly signed payload", () => {
    const parsed = parseSignedRequest(make({ algorithm: "HMAC-SHA256", user_id: 42, issued_at: 1 }), secret);
    expect(parsed?.user_id).toBe("42");
  });

  it("rejects forged, malformed or wrong-algorithm requests", () => {
    expect(parseSignedRequest(make({ algorithm: "HMAC-SHA256", user_id: "1" }, "wrong"), secret)).toBeNull();
    expect(parseSignedRequest("garbage", secret)).toBeNull();
    expect(parseSignedRequest(make({ algorithm: "none", user_id: "1" }), secret)).toBeNull();
    expect(parseSignedRequest(`${make({ algorithm: "HMAC-SHA256", user_id: "1" })}.extra`, secret)).toBeNull();
  });
});
