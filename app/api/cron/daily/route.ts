import { createGateway } from "ai";
import { syncCatalogFromGateway } from "@/lib/ai/catalog";
import { expireCredits } from "@/lib/billing/wallet";
import { safeEqual } from "@/lib/crypto/sign";
import { db } from "@/lib/db";
import { threadsTokens } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { sweepPublishing } from "@/lib/publishing/publish";
import { startSync } from "@/lib/sync/trigger";

/**
 * Vercel Cron (vercel.json, 06:00 UTC): refreshes model prices from the AI
 * Gateway, expires credits past their date, sweeps the publishing queue, then
 * starts a sync for every connected profile. Each sync is its
 * own durable workflow run, so one slow or failing account doesn't hold up
 * the rest.
 */
export async function GET(request: Request) {
  const expected = env.CRON_SECRET ? `Bearer ${env.CRON_SECRET}` : null;
  const given = request.headers.get("authorization") ?? "";
  if (!expected || !safeEqual(given, expected)) return Response.json({ error: "unauthorized" }, { status: 401 });

  let catalog: { updated: number; disabled: number } | null = null;
  if (env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN) {
    const gateway = createGateway(env.AI_GATEWAY_API_KEY ? { apiKey: env.AI_GATEWAY_API_KEY } : {});
    catalog = await syncCatalogFromGateway(() => gateway.getAvailableModels()).catch((error) => {
      console.error("Model catalog sync failed", error);
      return null;
    });
  }

  const expired = await expireCredits().catch((error) => {
    console.error("Credit expiry failed", error);
    return null;
  });
  // The publish sweeper also runs every 5 minutes (/api/cron/publish); this covers plans with daily crons only.
  await sweepPublishing().catch((error) => console.error("Publish sweep failed", error));

  const profiles = await db().select({ profileId: threadsTokens.profileId }).from(threadsTokens);
  let started = 0;
  for (const { profileId } of profiles) {
    try {
      if (await startSync(profileId, "daily")) started++;
    } catch (error) {
      console.error(`Could not start the daily sync for ${profileId}`, error);
    }
  }
  return Response.json({ profiles: profiles.length, started, catalog, expired });
}
