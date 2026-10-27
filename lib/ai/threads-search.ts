import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { threadsTokens } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { clientForProfile } from "@/lib/sync/client";
import { KEYWORD_SEARCH_SCOPE } from "@/lib/threads/oauth";
import { pickThreadsPosts, THREADS_DAYS, type ThreadsPost } from "./research-prompt";

// Recent popular Threads posts on a Studio topic, for the research step
// (./research-prompt.ts). The search runs on the author's own connection
// (threads_keyword_search), within their 2,200 searches a day. The posts are
// read in memory: only links to them are stored.

/** Threads' default page; the best 15 of other people's posts are kept. */
const SEARCH_LIMIT = 25;
/** The batch waits on the search, so a slow one is given up on. */
const SEARCH_TIMEOUT_MS = 8000;

/**
 * Whether Studio reads Threads posts on a topic for this profile: "on" when
 * the connection has keyword search, "reconnect" when sign-in now asks for it
 * but this connection predates that, "off" otherwise.
 */
export async function threadsSearchStatus(profileId: string): Promise<"on" | "reconnect" | "off"> {
  const [token] = await db()
    .select({ scopes: threadsTokens.scopes })
    .from(threadsTokens)
    .where(eq(threadsTokens.profileId, profileId));
  if (!token) return "off";
  if (token.scopes.includes(KEYWORD_SEARCH_SCOPE)) return "on";
  return env.THREADS_KEYWORD_SEARCH === "1" ? "reconnect" : "off";
}

/** Never throws: without posts, the research goes ahead with the web alone. */
export async function topicPosts(input: {
  profileId: string;
  username: string;
  topic: string;
  now: Date;
  signal?: AbortSignal;
}): Promise<ThreadsPost[]> {
  try {
    if ((await threadsSearchStatus(input.profileId)) !== "on") return [];
    const client = await clientForProfile(input.profileId, input.now);
    const results = await client.keywordSearch({
      query: input.topic,
      type: "TOP",
      since: new Date(input.now.getTime() - THREADS_DAYS * 86_400_000),
      limit: SEARCH_LIMIT,
      signal: AbortSignal.any([AbortSignal.timeout(SEARCH_TIMEOUT_MS), ...(input.signal ? [input.signal] : [])]),
    });
    return pickThreadsPosts(results, input.username);
  } catch (error) {
    if (!input.signal?.aborted) {
      console.warn(`Threads search skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
    return [];
  }
}
