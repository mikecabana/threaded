import { safeEqual } from "@/lib/crypto/sign";
import { env } from "@/lib/env";
import { sweepPublishing } from "@/lib/publishing/publish";

/**
 * Vercel Cron (vercel.json, every 5 minutes): the safety net for scheduled
 * posts. Overdue posts whose run was lost get a new one; posts stuck mid-publish
 * are marked failed so the user can check Threads and retry.
 */
export async function GET(request: Request) {
  const expected = env.CRON_SECRET ? `Bearer ${env.CRON_SECRET}` : null;
  const given = request.headers.get("authorization") ?? "";
  if (!expected || !safeEqual(given, expected)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { restarted, stuck } = await sweepPublishing();
  return Response.json({ restarted: restarted.length, stuck });
}
