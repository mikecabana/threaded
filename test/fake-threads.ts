import { vi } from "vitest";

// An in-memory Graph API for integration tests: install() stubs global fetch so
// code under test talks to it exactly as it would to graph.threads.net.

export interface FakePost {
  id: string;
  text: string;
  timestamp: string;
  media_type?: string;
  insights?: Partial<Record<"views" | "likes" | "replies" | "reposts" | "quotes" | "shares", number>>;
}

export interface FakeThreadsOptions {
  posts: FakePost[];
  followers?: number;
  /** Views per account-insights day. */
  dailyViews?: number;
  /** Path substrings that answer with an OAuth error. */
  authFailures?: string[];
  pageSize?: number;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export function installFakeThreads(options: FakeThreadsOptions) {
  const calls: URL[] = [];
  const pageSize = options.pageSize ?? 2;

  const handler = async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    calls.push(url);
    if (options.authFailures?.some((p) => url.pathname.includes(p))) {
      return json({ error: { message: "Error validating access token", type: "OAuthException", code: 190 } }, 400);
    }
    const path = url.pathname.replace(/^\/v[\d.]+/, "");

    if (path === "/refresh_access_token") {
      return json({ access_token: "refreshed-token", token_type: "bearer", expires_in: 5_184_000 });
    }
    if (path === "/me") return json({ id: "1789", username: "maya.builds", name: "Maya Chen", is_verified: false });
    if (path === "/me/threads") {
      const since = Number(url.searchParams.get("since") ?? 0) * 1000;
      const offset = Number(url.searchParams.get("after") ?? 0);
      const visible = options.posts.filter((p) => Date.parse(p.timestamp) >= since);
      const page = visible.slice(offset, offset + pageSize);
      // Like the real API, `next` repeats the original query (since, fields…) plus a cursor.
      const nextUrl = new URL(url);
      nextUrl.searchParams.set("after", String(offset + pageSize));
      const next = offset + pageSize < visible.length ? nextUrl.toString() : undefined;
      return json({
        data: page.map((p) => ({
          id: p.id,
          text: p.text,
          timestamp: p.timestamp,
          media_type: p.media_type ?? "TEXT_POST",
        })),
        paging: next ? { next } : {},
      });
    }
    if (path === "/me/threads_insights") {
      const since = Number(url.searchParams.get("since")) * 1000;
      return json({
        data: [
          {
            name: "views",
            values: [{ value: options.dailyViews ?? 100, end_time: new Date(since + 86_400_000).toISOString() }],
          },
          { name: "likes", total_value: { value: 7 } },
          { name: "replies", total_value: { value: 2 } },
          { name: "reposts", total_value: { value: 1 } },
          { name: "quotes", total_value: { value: 0 } },
          { name: "clicks", total_value: { value: 3 } },
          { name: "followers_count", total_value: { value: options.followers ?? 2400 } },
        ],
      });
    }
    const insights = path.match(/^\/([^/]+)\/insights$/);
    if (insights) {
      const post = options.posts.find((p) => p.id === insights[1]);
      if (!post) return json({ error: { message: "Unsupported get request", code: 100 } }, 400);
      return json({
        data: Object.entries({
          views: 0,
          likes: 0,
          replies: 0,
          reposts: 0,
          quotes: 0,
          shares: 0,
          ...post.insights,
        }).map(([name, value]) => ({ name, values: [{ value }] })),
      });
    }
    return json({ error: { message: `fake has no route for ${url.pathname}`, code: 100 } }, 404);
  };

  vi.stubGlobal("fetch", vi.fn(handler));
  return { calls, restore: () => vi.unstubAllGlobals() };
}
