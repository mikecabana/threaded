import "server-only";
import { and, eq, gt, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { randomToken, sha256 } from "@/lib/crypto/sign";
import { db } from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import { DEMO_COOKIE, SESSION_COOKIE } from "./cookies";

// Sessions are opaque random tokens in an httpOnly cookie. Only a SHA-256 of
// the token is stored, so a database leak can't be replayed as a login.

export const SESSION_TTL_DAYS = 30;
const DAY_MS = 86_400_000;

/** Creates a session row and sets the cookie. Route Handlers and Server Actions only. */
export async function startSession(userId: string, userAgent: string | null): Promise<void> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * DAY_MS);
  await db()
    .insert(sessions)
    .values({ idHash: sha256(token), userId, expiresAt, userAgent: userAgent?.slice(0, 300) ?? null });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  store.delete(DEMO_COOKIE);
}

/** The signed-in user's id, or null. Safe to call while rendering. */
export async function readSessionUserId(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const [row] = await db()
    .select({ userId: sessions.userId })
    .from(sessions)
    // The database's clock, so rendering doesn't read the time (Cache Components prerenders).
    .where(and(eq(sessions.idHash, sha256(token)), gt(sessions.expiresAt, sql`now()`)))
    .limit(1);
  return row?.userId ?? null;
}

/** Deletes the current session and its cookie. Route Handlers and Server Actions only. */
export async function endSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token)
    await db()
      .delete(sessions)
      .where(eq(sessions.idHash, sha256(token)));
  store.delete(SESSION_COOKIE);
}
