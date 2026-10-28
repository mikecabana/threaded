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
  /** What /debug_token says about data access (Unix seconds); omit for an error. */
  dataAccessExpiresAt?: number;
  /** More keyword-search results, after the usual ones. */
  searchExtra?: { username: string; text: string }[];
  /** Publishing behaviour (see the publishing routes below). */
  publishing?: {
    quotaUsed?: number;
    /** Statuses the container reports, in order; the last one repeats. Defaults to FINISHED. */
    containerStatuses?: string[];
  };
}

export interface FakePublished {
  containerId: string;
  mediaId: string;
  text: string;
  topicTag: string | null;
  /** The post it replies to (the part before, in a series). */
  replyToId: string | null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/**
 * Keyword search: two posts by other people, a reply, and one of the user's
 * own (which Studio leaves out). A query with "zzz" finds nothing.
 */
export function searchResults(query: string, ownUsername: string) {
  if (!query || /zzz/i.test(query)) return [];
  const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
  const post = (id: string, username: string, text: string, ago: number, isReply = false) => ({
    id,
    text,
    media_type: "TEXT_POST",
    permalink: `https://www.threads.net/@${username}/post/${id.toUpperCase()}`,
    timestamp: day(ago),
    username,
    is_reply: isReply,
  });
  return [
    post("kw1", "sec.daily", `${query} broke half the internet this week. Patch before the weekend.`, 1),
    post("kw2", "ops.notes", `Hot take: ${query} is overblown if you keep your dependencies current.`, 2),
    post("kw3", "random.dev", "@sec.daily same here, we patched yesterday", 1, true),
    post("kw4", ownUsername, `My own thoughts on ${query}`, 3),
  ];
}

export function installFakeThreads(options: FakeThreadsOptions) {
  const calls: URL[] = [];
  const pageSize = options.pageSize ?? 2;
  const containers = new Map<
    string,
    { text: string; topicTag: string | null; replyToId: string | null; checks: number }
  >();
  const published: FakePublished[] = [];

  const realFetch = globalThis.fetch;
  const handler = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    // Only Threads is faked; anything else (local mock servers) goes through.
    if (url.hostname !== "graph.threads.net") return realFetch(input, init);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    calls.push(url);
    if (options.authFailures?.some((p) => url.pathname.includes(p))) {
      return json({ error: { message: "Error validating access token", type: "OAuthException", code: 190 } }, 400);
    }
    const path = url.pathname.replace(/^\/v[\d.]+/, "");

    if (path === "/refresh_access_token") {
      return json({ access_token: "refreshed-token", token_type: "bearer", expires_in: 5_184_000 });
    }
    if (path === "/me") return json({ id: "1789", username: "maya.builds", name: "Maya Chen", is_verified: false });
    if (path === "/debug_token") {
      if (options.dataAccessExpiresAt === undefined) {
        return json({ error: { message: "Only testers can debug tokens", type: "OAuthException", code: 200 } }, 403);
      }
      return json({ data: { data_access_expires_at: options.dataAccessExpiresAt, is_valid: true } });
    }

    // Publishing: containers, their status, publish, and the 24h quota.
    if (path === "/me/threads" && method === "POST") {
      const id = `container-${containers.size + 1}`;
      containers.set(id, {
        text: url.searchParams.get("text") ?? "",
        topicTag: url.searchParams.get("topic_tag"),
        replyToId: url.searchParams.get("reply_to_id"),
        checks: 0,
      });
      return json({ id });
    }
    if (path === "/me/threads_publish" && method === "POST") {
      const containerId = url.searchParams.get("creation_id") ?? "";
      const container = containers.get(containerId);
      if (!container) return json({ error: { message: "Invalid creation_id", code: 100 } }, 400);
      if (published.some((p) => p.containerId === containerId)) {
        return json({ error: { message: "Container already published", code: 100 } }, 400);
      }
      const mediaId = `media-${published.length + 1}`;
      published.push({
        containerId,
        mediaId,
        text: container.text,
        topicTag: container.topicTag,
        replyToId: container.replyToId,
      });
      return json({ id: mediaId });
    }
    if (path === "/me/threads_publishing_limit") {
      return json({
        data: [
          { quota_usage: options.publishing?.quotaUsed ?? 0, config: { quota_total: 250, quota_duration: 86400 } },
        ],
      });
    }
    const container = containers.get(path.slice(1));
    if (container) {
      const statuses = options.publishing?.containerStatuses ?? ["FINISHED"];
      const status = statuses[Math.min(container.checks++, statuses.length - 1)];
      return json({ id: path.slice(1), status, error_message: status === "ERROR" ? "Media upload failed" : null });
    }
    const media = published.find((p) => `/${p.mediaId}` === path);
    if (media) {
      return json({
        id: media.mediaId,
        permalink: `https://www.threads.net/@maya.builds/post/${media.mediaId}`,
        timestamp: new Date().toISOString(),
      });
    }

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
    if (path === "/me/threads_insights" && url.searchParams.get("metric") === "followers_count") {
      return json({ data: [{ name: "followers_count", total_value: { value: options.followers ?? 2400 } }] });
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
          { name: "clicks", link_total_values: [{ value: 3, link_url: "https://example.com" }] },
        ],
      });
    }
    if (path === "/keyword_search") {
      const query = url.searchParams.get("q") ?? "";
      const extra = (options.searchExtra ?? []).map((p, i) => ({ id: `kx${i}`, ...p, is_reply: false }));
      return json({ data: [...searchResults(query, "maya.builds"), ...extra] });
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
  return { calls, published, restore: () => vi.unstubAllGlobals() };
}
