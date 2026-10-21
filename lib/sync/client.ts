import "server-only";
import { eq } from "drizzle-orm";
import { tokenContext } from "@/lib/accounts/provision";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secrets";
import { db } from "@/lib/db";
import { threadsTokens } from "@/lib/db/schema";
import { createThreadsClient, type ThreadsClient } from "@/lib/threads/client";
import { ThreadsApiError } from "@/lib/threads/errors";
import { refreshLongLived, shouldRefresh } from "@/lib/threads/oauth";

/** The profile has no usable token; it needs to reconnect. Not worth retrying. */
export class NotConnectedError extends Error {
  constructor(profileId: string) {
    super(`Threads profile ${profileId} is not connected.`);
    this.name = "NotConnectedError";
  }
}

/**
 * A Threads client for the profile, refreshing its long-lived token first when
 * it's due. Tokens are decrypted here, inside the step that needs them, so
 * they never travel through workflow arguments or the event log.
 */
export async function clientForProfile(profileId: string, now = new Date()): Promise<ThreadsClient> {
  const [token] = await db().select().from(threadsTokens).where(eq(threadsTokens.profileId, profileId));
  if (!token || token.expiresAt <= now) throw new NotConnectedError(profileId);

  let accessToken = decryptSecret(token.accessTokenEnc, tokenContext(profileId));
  if (shouldRefresh(token, now)) {
    try {
      const refreshed = await refreshLongLived(accessToken);
      accessToken = refreshed.accessToken;
      await db()
        .update(threadsTokens)
        .set({
          accessTokenEnc: encryptSecret(accessToken, tokenContext(profileId)),
          expiresAt: refreshed.expiresAt,
          lastRefreshedAt: now,
        })
        .where(eq(threadsTokens.profileId, profileId));
    } catch (error) {
      if (error instanceof ThreadsApiError && error.isAuthError) {
        await revokeToken(profileId);
        throw new NotConnectedError(profileId);
      }
      // Any other failure isn't fatal while the current token still works.
      console.warn(`Token refresh failed for ${profileId}; using the current token.`, error);
    }
  }
  return createThreadsClient({ accessToken });
}

/** Threads rejected the token (revoked or expired): forget it so the UI asks to reconnect. */
export async function revokeToken(profileId: string): Promise<void> {
  await db().delete(threadsTokens).where(eq(threadsTokens.profileId, profileId));
}
