"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { removeEmail, requestEmailVerification, VERIFY_LIMIT } from "@/lib/email/verify";
import { getAccountIdentity } from "@/lib/session/identity";

export type EmailFormState = { ok: boolean; message: string } | null;

const MESSAGES = {
  invalid: "That doesn't look like an email address.",
  too_many: `That's ${VERIFY_LIMIT} confirmation emails this hour. Try again later.`,
  already: "Alerts already go to that address.",
  failed: "The email couldn't be sent. Try again in a minute.",
} as const;

/** This deployment's origin, for the link in the email: it's where the person is signed in. */
async function requestOrigin(): Promise<string> {
  const h = await headers();
  const origin = h.get("origin");
  if (origin) return origin;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  return `${h.get("x-forwarded-proto") ?? "https"}://${host}`;
}

/** Sends a confirmation link to the address; it's saved once the link is opened. */
export async function requestEmailAction(_state: EmailFormState, formData: FormData): Promise<EmailFormState> {
  const identity = await getAccountIdentity();
  if (!identity) return { ok: false, message: "Sign in again to add an email." };
  const result = await requestEmailVerification(
    identity.userId,
    String(formData.get("email") ?? ""),
    await requestOrigin(),
  );
  if (!result.ok) return { ok: false, message: MESSAGES[result.reason] };
  return { ok: true, message: `Check ${result.email} for a link to confirm it. It works for 24 hours.` };
}

/** Stops alert emails and forgets the address. */
export async function removeEmailAction(): Promise<void> {
  const identity = await getAccountIdentity();
  if (!identity) return;
  await removeEmail(identity.userId);
  revalidatePath("/settings");
}
