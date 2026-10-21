"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AI_TASKS, catalogFor } from "@/lib/ai/catalog";
import { setSuggestionStatus } from "@/lib/data/suggestions";
import { db } from "@/lib/db";
import { userSettings } from "@/lib/db/schema";
import { getAccountIdentity } from "@/lib/session/identity";

const statusSchema = z.enum(["new", "saved", "dismissed"]);

/** Save, dismiss or restore an idea. */
export async function setSuggestionStatusAction(id: string, status: string): Promise<{ ok: boolean }> {
  const identity = await getAccountIdentity();
  const parsed = statusSchema.safeParse(status);
  if (!identity || !parsed.success || !z.uuid().safeParse(id).success) return { ok: false };
  const ok = await setSuggestionStatus(identity.profileId, id, parsed.data);
  if (ok) revalidatePath("/home");
  return { ok };
}

/** Remembers the user's model choice for a task, if the catalog allows it. */
export async function setModelPickAction(task: string, modelId: string): Promise<{ ok: boolean }> {
  const identity = await getAccountIdentity();
  const parsedTask = z.enum(AI_TASKS).safeParse(task);
  if (!identity || !parsedTask.success) return { ok: false };
  const allowed = await catalogFor(parsedTask.data);
  if (!allowed.some((m) => m.modelId === modelId)) return { ok: false };

  const [current] = await db()
    .select({ modelPicks: userSettings.modelPicks })
    .from(userSettings)
    .where(eq(userSettings.userId, identity.userId));
  const modelPicks = { ...(current?.modelPicks ?? {}), [parsedTask.data]: modelId };
  await db()
    .insert(userSettings)
    .values({ userId: identity.userId, modelPicks })
    .onConflictDoUpdate({ target: userSettings.userId, set: { modelPicks } });
  return { ok: true };
}
