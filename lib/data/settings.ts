import "server-only";
import { eq } from "drizzle-orm";
import type { AiTask } from "@/lib/ai/catalog";
import { db } from "@/lib/db";
import { userSettings } from "@/lib/db/schema";

/** The user's saved model choice for a task, if any. */
export async function getModelPick(userId: string, task: AiTask): Promise<string | null> {
  const [row] = await db()
    .select({ modelPicks: userSettings.modelPicks })
    .from(userSettings)
    .where(eq(userSettings.userId, userId));
  return row?.modelPicks?.[task] ?? null;
}
