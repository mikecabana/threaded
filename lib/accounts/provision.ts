import "server-only";
import { eq } from "drizzle-orm";
import { grantCredits } from "@/lib/billing/wallet";
import { encryptSecret } from "@/lib/crypto/secrets";
import { sha256 } from "@/lib/crypto/sign";
import { db, type Tx } from "@/lib/db";
import {
  deletionRequests,
  memberships,
  sessions,
  threadsProfiles,
  threadsTokens,
  users,
  wallets,
  workspaces,
} from "@/lib/db/schema";
import { TRIAL_CREDITS } from "@/lib/pricing";
import type { ThreadsProfile } from "@/lib/threads/types";

export const tokenContext = (profileId: string) => `threads-token:${profileId}`;

export interface ProvisionInput {
  profile: ThreadsProfile;
  accessToken: string;
  expiresAt: Date;
  scopes: readonly string[];
  /** IANA zone from the browser at sign-in; only used for brand-new profiles. */
  timezone?: string;
}

export interface ProvisionResult {
  userId: string;
  workspaceId: string;
  profileId: string;
  isNewProfile: boolean;
  trialGranted: boolean;
  /** Null until the first sync finishes. */
  lastSyncedAt: Date | null;
}

export function isValidTimeZone(zone: string | undefined): zone is string {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Signs in (or signs up) a Threads account in one transaction: user,
 * workspace, membership, profile, encrypted token and wallet. The free trial
 * is granted once per Threads account, ever. The ledger keeps a hashed
 * reference that survives data deletion, so deleting and reconnecting
 * doesn't earn a second trial.
 */
export async function provisionThreadsAccount(input: ProvisionInput): Promise<ProvisionResult> {
  const { profile } = input;
  return db().transaction(async (tx) => {
    const [existing] = await tx
      .select({ workspaceId: threadsProfiles.workspaceId, lastSyncedAt: threadsProfiles.lastSyncedAt })
      .from(threadsProfiles)
      .where(eq(threadsProfiles.id, profile.id))
      .for("update");

    const userId = await upsertUser(tx, profile.id);
    let workspaceId: string;

    if (existing) {
      workspaceId = existing.workspaceId;
      await tx
        .update(threadsProfiles)
        .set({
          username: profile.username,
          name: profile.name,
          biography: profile.biography,
          profilePictureUrl: profile.profilePictureUrl,
          isVerified: profile.isVerified,
        })
        .where(eq(threadsProfiles.id, profile.id));
    } else {
      const [workspace] = await tx
        .insert(workspaces)
        .values({ name: `@${profile.username}` })
        .returning({ id: workspaces.id });
      workspaceId = workspace.id;
      await tx.insert(memberships).values({ userId, workspaceId, role: "owner" });
      await tx.insert(wallets).values({ workspaceId });
      await tx.insert(threadsProfiles).values({
        id: profile.id,
        workspaceId,
        username: profile.username,
        name: profile.name,
        biography: profile.biography,
        profilePictureUrl: profile.profilePictureUrl,
        isVerified: profile.isVerified,
        timezone: isValidTimeZone(input.timezone) ? input.timezone : "UTC",
      });
    }

    await tx.insert(memberships).values({ userId, workspaceId, role: "owner" }).onConflictDoNothing();

    const sealed = encryptSecret(input.accessToken, tokenContext(profile.id));
    await tx
      .insert(threadsTokens)
      .values({ profileId: profile.id, accessTokenEnc: sealed, expiresAt: input.expiresAt, scopes: [...input.scopes] })
      .onConflictDoUpdate({
        target: threadsTokens.profileId,
        set: {
          accessTokenEnc: sealed,
          expiresAt: input.expiresAt,
          scopes: [...input.scopes],
          lastRefreshedAt: null,
          // A fresh consent starts a new grant.
          grantedAt: new Date(),
          dataAccessExpiresAt: null,
          accessCheckedAt: null,
        },
      });

    const trialGranted = await grantTrialOnce(tx, workspaceId, profile.id);
    return {
      userId,
      workspaceId,
      profileId: profile.id,
      isNewProfile: !existing,
      trialGranted,
      lastSyncedAt: existing?.lastSyncedAt ?? null,
    };
  });
}

async function upsertUser(tx: Tx, threadsUserId: string): Promise<string> {
  const [row] = await tx
    .insert(users)
    .values({ threadsUserId })
    .onConflictDoUpdate({ target: users.threadsUserId, set: { threadsUserId } })
    .returning({ id: users.id });
  return row.id;
}

async function grantTrialOnce(tx: Tx, workspaceId: string, threadsUserId: string): Promise<boolean> {
  const granted = await grantCredits(
    {
      workspaceId,
      amount: TRIAL_CREDITS,
      kind: "trial",
      ref: `trial:${sha256(threadsUserId)}`,
    },
    tx,
  );
  if (!granted) return false;
  await tx.update(threadsProfiles).set({ trialGrantedAt: new Date() }).where(eq(threadsProfiles.id, threadsUserId));
  return true;
}

/** Meta uninstall callback: the app's access was revoked, so drop the token. */
export async function disconnectThreadsProfile(threadsUserId: string): Promise<void> {
  await db().delete(threadsTokens).where(eq(threadsTokens.profileId, threadsUserId));
}

/** What a workspace keeps once its last profile is deleted: the ledger and Stripe ids, for accounting. */
export const DELETED_WORKSPACE_NAME = "Deleted account";

/**
 * Meta data-deletion callback, and "Delete account" in Settings: removes the
 * profile and everything synced from it, the user and their sessions. The
 * workspace, its wallet and ledger rows stay for accounting, renamed and
 * stripped of the AI key, auto-recharge and anything else that identifies
 * the person.
 */
export async function deleteThreadsData(threadsUserId: string, confirmationCode: string): Promise<void> {
  await db().transaction(async (tx) => {
    await tx.insert(deletionRequests).values({ confirmationCode, threadsUserIdHash: sha256(threadsUserId) });
    const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.threadsUserId, threadsUserId));
    // Cascades to tokens, posts, metrics, features, daily rows, DNA, generations and schedules.
    const [profile] = await tx
      .delete(threadsProfiles)
      .where(eq(threadsProfiles.id, threadsUserId))
      .returning({ workspaceId: threadsProfiles.workspaceId });
    if (user) {
      await tx.delete(sessions).where(eq(sessions.userId, user.id));
      // Cascades to memberships, settings and the email log.
      await tx.delete(users).where(eq(users.id, user.id));
    }
    if (profile) {
      const [other] = await tx
        .select({ id: threadsProfiles.id })
        .from(threadsProfiles)
        .where(eq(threadsProfiles.workspaceId, profile.workspaceId))
        .limit(1);
      if (!other) {
        await tx
          .update(workspaces)
          .set({
            name: DELETED_WORKSPACE_NAME,
            billingMode: "credits",
            byokKeyEnc: null,
            byokKeyLast4: null,
            autoRecharge: null,
            autoRechargePendingAt: null,
            billingNotice: null,
          })
          .where(eq(workspaces.id, profile.workspaceId));
      }
    }
    await tx
      .update(deletionRequests)
      .set({ completedAt: new Date() })
      .where(eq(deletionRequests.confirmationCode, confirmationCode));
  });
}
