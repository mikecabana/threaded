import "server-only";
import { and, count, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { sha256, sign, unsign } from "@/lib/crypto/sign";
import { db } from "@/lib/db";
import { emailLog, users } from "@/lib/db/schema";
import { emailUserOnce } from "./alerts";
import { isEmailConfigured } from "./send";
import { verifyEmail } from "./templates";

// Adding an alert address: Threaded emails a signed link, and the address is
// only stored once that link is opened. Nothing is kept for an unconfirmed one.

const PURPOSE = "email-verify";
const TTL_MS = 24 * 3_600_000;
/** Confirmation emails a user can ask for in an hour. */
export const VERIFY_LIMIT = 3;

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

interface Payload {
  u: string;
  e: string;
  x: number;
}

export function verificationToken(userId: string, email: string, now = new Date()): string {
  const payload: Payload = { u: userId, e: email, x: now.getTime() + TTL_MS };
  return sign(`${PURPOSE}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`);
}

/** The user and address a link was made for, or null if it's been altered or has expired. */
export function readVerificationToken(token: string, now = new Date()): { userId: string; email: string } | null {
  const value = unsign(token);
  if (!value?.startsWith(`${PURPOSE}.`)) return null;
  try {
    const payload = JSON.parse(Buffer.from(value.slice(PURPOSE.length + 1), "base64url").toString()) as Payload;
    if (typeof payload.u !== "string" || typeof payload.e !== "string" || payload.x < now.getTime()) return null;
    return { userId: payload.u, email: payload.e };
  } catch {
    return null;
  }
}

export type VerificationRequest =
  | { ok: true; email: string }
  | { ok: false; reason: "invalid" | "too_many" | "already" | "failed" };

/** Emails a confirmation link to the address. */
export async function requestEmailVerification(
  userId: string,
  rawEmail: string,
  origin: string,
  now = new Date(),
): Promise<VerificationRequest> {
  const parsed = emailSchema.safeParse(rawEmail);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  const email = parsed.data;

  const [user] = await db()
    .select({ email: users.email, verifiedAt: users.emailVerifiedAt })
    .from(users)
    .where(eq(users.id, userId));
  if (user?.verifiedAt && user.email === email) return { ok: false, reason: "already" };

  const [{ recent }] = await db()
    .select({ recent: count() })
    .from(emailLog)
    .where(
      and(
        eq(emailLog.userId, userId),
        eq(emailLog.kind, "verify_email"),
        gte(emailLog.createdAt, new Date(now.getTime() - 3_600_000)),
      ),
    );
  if (recent >= VERIFY_LIMIT) return { ok: false, reason: "too_many" };

  const url = `${origin}/api/email/verify?token=${encodeURIComponent(verificationToken(userId, email, now))}`;
  if (!isEmailConfigured() && process.env.NODE_ENV !== "production") {
    console.info(`Email isn't set up here; confirm with ${url}`);
  }
  const ref = `${sha256(email).slice(0, 16)}:${now.getTime()}`;
  const sent = await emailUserOnce({ id: userId, email }, "verify_email", ref, verifyEmail({ url }));
  return sent ? { ok: true, email } : { ok: false, reason: "failed" };
}

/** Stores the address a valid link was made for, as confirmed. */
export async function confirmEmail(token: string, now = new Date()): Promise<boolean> {
  const target = readVerificationToken(token, now);
  if (!target) return false;
  const updated = await db()
    .update(users)
    .set({ email: target.email, emailVerifiedAt: now })
    .where(eq(users.id, target.userId))
    .returning({ id: users.id });
  return updated.length > 0;
}

export async function removeEmail(userId: string): Promise<void> {
  await db().update(users).set({ email: null, emailVerifiedAt: null }).where(eq(users.id, userId));
}

/** The user's confirmed alert address, if any. */
export async function alertAddress(userId: string): Promise<string | null> {
  const [user] = await db()
    .select({ email: users.email, verifiedAt: users.emailVerifiedAt })
    .from(users)
    .where(eq(users.id, userId));
  return user?.verifiedAt ? user.email : null;
}
