"use server";

import { revalidatePath } from "next/cache";
import { voiceFormSchema } from "@/lib/ai/voice";
import { db } from "@/lib/db";
import { userSettings } from "@/lib/db/schema";
import { getAccountIdentity } from "@/lib/session/identity";

export type VoiceFormState = { ok: boolean; message: string } | null;

/** Saves Settings → Voice. Studio applies it to every batch from now on. */
export async function saveVoiceAction(_state: VoiceFormState, form: FormData): Promise<VoiceFormState> {
  const identity = await getAccountIdentity();
  if (!identity) return { ok: false, message: "Your session ended. Sign in again to save." };
  const parsed = voiceFormSchema.safeParse({
    emoji: form.get("emoji") ?? "",
    casing: form.get("casing") ?? "",
    spice: form.get("spice") ?? "",
    bannedWords: form.get("bannedWords") ?? "",
    notes: form.get("notes") ?? "",
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check your settings." };
  const voicePrefs = parsed.data;
  await db()
    .insert(userSettings)
    .values({ userId: identity.userId, voicePrefs })
    .onConflictDoUpdate({ target: userSettings.userId, set: { voicePrefs } });
  revalidatePath("/settings");
  revalidatePath("/studio");
  return { ok: true, message: "Saved. Studio uses these from your next batch." };
}
