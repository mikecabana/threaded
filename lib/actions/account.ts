"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { deleteThreadsData, disconnectThreadsProfile } from "@/lib/accounts/provision";
import { endPlanForDeletedAccount } from "@/lib/billing/subscription";
import { randomToken } from "@/lib/crypto/sign";
import { db } from "@/lib/db";
import { threadsProfiles } from "@/lib/db/schema";
import { getAccountIdentity } from "@/lib/session/identity";
import { endSession } from "@/lib/session/session";

// "Account & data" in Settings (the export is a Route Handler:
// app/api/account/export).

/** Stops syncing and posting: forgets the Threads token and keeps the data. Reconnecting signs in again. */
export async function disconnectThreadsAction(): Promise<void> {
  const identity = await getAccountIdentity();
  if (!identity) redirect("/connect");
  await disconnectThreadsProfile(identity.profileId);
  revalidatePath("/", "layout");
}

export type DeleteAccountState = { error: string } | null;

/**
 * Deletes the account after the person types their username: ends a running
 * plan, removes their data (lib/accounts/provision.ts) and signs them out,
 * then shows the confirmation code on the deletion status page.
 */
export async function deleteAccountAction(_state: DeleteAccountState, form: FormData): Promise<DeleteAccountState> {
  const identity = await getAccountIdentity();
  if (!identity) redirect("/connect");
  const [profile] = await db()
    .select({ username: threadsProfiles.username })
    .from(threadsProfiles)
    .where(eq(threadsProfiles.id, identity.profileId));
  const typed = String(form.get("confirm") ?? "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
  if (!profile || typed !== profile.username.toLowerCase()) {
    return { error: `Type your username, @${profile?.username ?? ""}, to confirm.` };
  }

  const code = randomToken(12);
  // Before the profile goes: it's how the plan is found.
  await endPlanForDeletedAccount(identity.profileId);
  await deleteThreadsData(identity.profileId, code);
  await endSession();
  redirect(`/data-deletion?code=${code}`);
}
