import { z } from "zod";
import { graphUrl } from "./endpoints";
import { ThreadsApiError } from "./errors";
import type { PostInsights, ThreadsMediaType, ThreadsPost, ThreadsProfile } from "./types";

// Typed client for graph.threads.net. Every response is validated with Zod so
// an API change fails loudly here instead of corrupting stored data.
// Field and metric names checked against Meta's docs (Oct 2026).

const PROFILE_FIELDS = "id,username,name,threads_profile_picture_url,threads_biography,is_verified";
const POST_FIELDS = "id,text,timestamp,media_type,permalink,is_quote_post,topic_tag";
const POST_METRICS = ["views", "likes", "replies", "reposts", "quotes", "shares"] as const;
/** Account metrics that take a date range. followers_count doesn't, so it's read on its own. */
const ACCOUNT_METRICS = ["views", "likes", "replies", "reposts", "quotes", "clicks"] as const;
/** Account insights don't go back before Apr 13, 2024 (Unix seconds; Meta's docs). */
export const ACCOUNT_INSIGHTS_EPOCH = 1712991600;

const errorEnvelope = z.object({
  error: z.object({
    message: z.string(),
    type: z.string().optional(),
    code: z.number().optional(),
    error_subcode: z.number().optional(),
    fbtrace_id: z.string().optional(),
  }),
});

const profileSchema = z.object({
  id: z.string(),
  username: z.string(),
  name: z.string().nullish(),
  threads_profile_picture_url: z.string().nullish(),
  threads_biography: z.string().nullish(),
  is_verified: z.boolean().nullish(),
});

const postSchema = z.object({
  id: z.string(),
  text: z.string().nullish(),
  timestamp: z.string(),
  media_type: z.string(),
  permalink: z.string().nullish(),
  is_quote_post: z.boolean().nullish(),
  topic_tag: z.string().nullish(),
});

const pageSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    data: z.array(item),
    paging: z
      .object({ cursors: z.object({ after: z.string().optional() }).optional(), next: z.string().optional() })
      .optional(),
  });

const metricSchema = z.object({
  name: z.string(),
  values: z.array(z.object({ value: z.number(), end_time: z.string().optional() })).optional(),
  total_value: z.object({ value: z.number() }).optional(),
  /** `clicks` comes back per link. */
  link_total_values: z.array(z.object({ value: z.number(), link_url: z.string().optional() })).optional(),
});
const insightsSchema = z.object({ data: z.array(metricSchema) });

const idSchema = z.object({ id: z.string() });

const mediaSchema = z.object({ id: z.string(), permalink: z.string().nullish(), timestamp: z.string().nullish() });

const containerStatusSchema = z.object({
  id: z.string(),
  status: z.enum(["IN_PROGRESS", "FINISHED", "PUBLISHED", "ERROR", "EXPIRED"]),
  error_message: z.string().nullish(),
});

const publishingLimitSchema = z.object({
  data: z.array(
    z.object({
      quota_usage: z.number(),
      config: z.object({ quota_total: z.number(), quota_duration: z.number() }).optional(),
    }),
  ),
});

const MEDIA_TYPES = new Set<ThreadsMediaType>([
  "TEXT_POST",
  "IMAGE",
  "VIDEO",
  "CAROUSEL_ALBUM",
  "AUDIO",
  "REPOST_FACADE",
]);

export interface AccountInsights {
  /** Daily views, oldest first (YYYY-MM-DD in UTC). */
  dailyViews: { date: string; views: number }[];
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
  clicks: number;
}

const debugTokenSchema = z.object({
  data: z.object({ data_access_expires_at: z.number().optional(), is_valid: z.boolean().optional() }),
});

export interface ContainerStatus {
  id: string;
  status: z.infer<typeof containerStatusSchema>["status"];
  errorMessage: string | null;
}

export interface ThreadsClientOptions {
  accessToken: string;
  fetch?: typeof fetch;
  baseUrl?: string;
}

/** Sums a metric whether it comes back as a total, per link, or as per-day values. */
function metricTotal(metric: z.infer<typeof metricSchema> | undefined): number {
  if (!metric) return 0;
  if (metric.total_value) return metric.total_value.value;
  if (metric.link_total_values) return metric.link_total_values.reduce((sum, v) => sum + v.value, 0);
  return (metric.values ?? []).reduce((sum, v) => sum + v.value, 0);
}

export function createThreadsClient({
  accessToken,
  fetch: fetchImpl = fetch,
  baseUrl = graphUrl(),
}: ThreadsClientOptions) {
  async function call<T extends z.ZodType>(
    method: "GET" | "POST",
    path: string,
    params: Record<string, string | number | undefined>,
    schema: T,
  ): Promise<z.infer<T>> {
    const url = new URL(path.startsWith("http") ? path : `${baseUrl}${path}`);
    for (const [key, value] of Object.entries(params))
      if (value !== undefined) url.searchParams.set(key, String(value));
    if (!url.searchParams.has("access_token")) url.searchParams.set("access_token", accessToken);

    const response = await fetchImpl(url, { method, cache: "no-store" });
    const body: unknown = await response.json().catch(() => null);
    const failure = errorEnvelope.safeParse(body);
    if (!response.ok || failure.success) {
      const error = failure.success ? failure.data.error : undefined;
      throw new ThreadsApiError(error?.message ?? `Threads API ${response.status}`, {
        status: response.status,
        code: error?.code,
        subcode: error?.error_subcode,
        type: error?.type,
        traceId: error?.fbtrace_id,
      });
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ThreadsApiError(`Unexpected Threads API response for ${path}: ${parsed.error.message}`, {
        status: response.status,
      });
    }
    return parsed.data;
  }

  return {
    async getProfile(): Promise<ThreadsProfile> {
      const p = await call("GET", "/me", { fields: PROFILE_FIELDS }, profileSchema);
      return {
        id: p.id,
        username: p.username,
        name: p.name ?? p.username,
        biography: p.threads_biography ?? "",
        profilePictureUrl: p.threads_profile_picture_url ?? null,
        isVerified: p.is_verified ?? false,
      };
    },

    /** Pages through the user's posts, newest first. `since`/`until` are Unix seconds. */
    async *listPosts(
      options: { since?: number; until?: number; pageSize?: number } = {},
    ): AsyncGenerator<ThreadsPost[]> {
      const query = {
        fields: POST_FIELDS,
        limit: options.pageSize ?? 50,
        since: options.since,
        until: options.until,
      };
      let path: string | undefined = "/me/threads";
      let params: Record<string, string | number | undefined> = query;
      while (path) {
        const page: z.infer<ReturnType<typeof pageSchema<typeof postSchema>>> = await call(
          "GET",
          path,
          params,
          pageSchema(postSchema),
        );
        yield page.data.map((p) => ({
          id: p.id,
          text: p.text ?? "",
          timestamp: new Date(p.timestamp).toISOString(),
          mediaType: MEDIA_TYPES.has(p.media_type as ThreadsMediaType)
            ? (p.media_type as ThreadsMediaType)
            : "TEXT_POST",
          permalink: p.permalink ?? "",
          isQuotePost: p.is_quote_post ?? false,
          topicTag: p.topic_tag ?? null,
        }));
        if (page.data.length === 0) break;
        // Prefer `next` (a full URL that already carries the query and token);
        // Meta's docs only promise the `after` cursor, so fall back to it.
        if (page.paging?.next) {
          path = page.paging.next;
          params = {};
        } else if (page.paging?.cursors?.after) {
          path = "/me/threads";
          params = { ...query, after: page.paging.cursors.after };
        } else {
          path = undefined;
        }
      }
    },

    async getPostInsights(mediaId: string): Promise<PostInsights> {
      const { data } = await call("GET", `/${mediaId}/insights`, { metric: POST_METRICS.join(",") }, insightsSchema);
      const byName = new Map(data.map((m) => [m.name, m]));
      return {
        views: metricTotal(byName.get("views")),
        likes: metricTotal(byName.get("likes")),
        replies: metricTotal(byName.get("replies")),
        reposts: metricTotal(byName.get("reposts")),
        quotes: metricTotal(byName.get("quotes")),
        shares: metricTotal(byName.get("shares")),
      };
    },

    /** Account insights between two Unix-second timestamps (clamped to what Threads keeps). */
    async getAccountInsights(range: { since: number; until: number }): Promise<AccountInsights> {
      const since = Math.max(range.since, ACCOUNT_INSIGHTS_EPOCH);
      const { data } = await call(
        "GET",
        "/me/threads_insights",
        { metric: ACCOUNT_METRICS.join(","), since, until: Math.max(range.until, since) },
        insightsSchema,
      );
      const byName = new Map(data.map((m) => [m.name, m]));
      const views = byName.get("views");
      return {
        dailyViews: (views?.values ?? []).map((v) => ({
          date: (v.end_time ? new Date(v.end_time) : new Date()).toISOString().slice(0, 10),
          views: v.value,
        })),
        likes: metricTotal(byName.get("likes")),
        replies: metricTotal(byName.get("replies")),
        reposts: metricTotal(byName.get("reposts")),
        quotes: metricTotal(byName.get("quotes")),
        clicks: metricTotal(byName.get("clicks")),
      };
    },

    /** The follower count as of now (Threads keeps no history of it). */
    async getFollowersCount(): Promise<number> {
      const { data } = await call("GET", "/me/threads_insights", { metric: "followers_count" }, insightsSchema);
      return metricTotal(data.find((m) => m.name === "followers_count"));
    },

    async getPublishingLimit(): Promise<{ used: number; total: number }> {
      const { data } = await call(
        "GET",
        "/me/threads_publishing_limit",
        { fields: "quota_usage,config" },
        publishingLimitSchema,
      );
      return { used: data[0]?.quota_usage ?? 0, total: data[0]?.config?.quota_total ?? 250 };
    },

    /** Step 1 of publishing: a text container. Returns the container id. */
    async createTextContainer(input: { text: string; replyToId?: string; topicTag?: string }): Promise<string> {
      const { id } = await call(
        "POST",
        "/me/threads",
        { media_type: "TEXT", text: input.text, reply_to_id: input.replyToId, topic_tag: input.topicTag },
        idSchema,
      );
      return id;
    },

    async getContainerStatus(containerId: string): Promise<ContainerStatus> {
      const s = await call("GET", `/${containerId}`, { fields: "id,status,error_message" }, containerStatusSchema);
      return { id: s.id, status: s.status, errorMessage: s.error_message ?? null };
    },

    /** A published post's link and time. */
    async getPost(mediaId: string): Promise<{ id: string; permalink: string | null; timestamp: string | null }> {
      const p = await call("GET", `/${mediaId}`, { fields: "id,permalink,timestamp" }, mediaSchema);
      return { id: p.id, permalink: p.permalink ?? null, timestamp: p.timestamp ?? null };
    },

    /**
     * When Threads stops sharing this user's data with the app (GET /debug_token
     * on the user's own token). Null when Threads doesn't say.
     */
    async getDataAccessExpiry(): Promise<Date | null> {
      const { data } = await call("GET", "/debug_token", { input_token: accessToken }, debugTokenSchema);
      return data.data_access_expires_at ? new Date(data.data_access_expires_at * 1000) : null;
    },

    /** Step 2 of publishing. Returns the published media id. */
    async publish(containerId: string): Promise<string> {
      const { id } = await call("POST", "/me/threads_publish", { creation_id: containerId }, idSchema);
      return id;
    },
  };
}

export type ThreadsClient = ReturnType<typeof createThreadsClient>;
