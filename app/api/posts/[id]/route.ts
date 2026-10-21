import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { scheduledPosts } from "@/lib/db/schema";
import { getAccountIdentity } from "@/lib/session/identity";

/** A queued post's progress. The composer polls this after "Post now". */
export async function GET(_request: Request, context: RouteContext<"/api/posts/[id]">) {
  const identity = await getAccountIdentity();
  if (!identity) return Response.json({ error: "not_signed_in" }, { status: 401 });
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "not_found" }, { status: 404 });

  const [post] = await db()
    .select({
      status: scheduledPosts.status,
      scheduledFor: scheduledPosts.scheduledFor,
      permalink: scheduledPosts.permalink,
      lastError: scheduledPosts.lastError,
    })
    .from(scheduledPosts)
    .where(and(eq(scheduledPosts.id, id), eq(scheduledPosts.profileId, identity.profileId)));
  if (!post) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(post, { headers: { "cache-control": "no-store" } });
}
