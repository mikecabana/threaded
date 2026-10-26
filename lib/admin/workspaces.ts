import "server-only";
import { and, count, desc, eq, gt, ilike, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import {
  creditLedger,
  creditLots,
  generations,
  memberships,
  threadsProfiles,
  threadsTokens,
  users,
  wallets,
  workspaces,
} from "@/lib/db/schema";

// Workspace lookup for /admin: find an account by its Threads username,
// workspace name or id, alert email, or Stripe customer id, then see its
// money and its recent AI use in one place.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface WorkspaceMatch {
  id: string;
  name: string;
  usernames: string[];
  billingMode: "credits" | "byok";
  balance: number;
  createdAt: Date;
}

export async function searchWorkspaces(query: string, limit = 20): Promise<WorkspaceMatch[]> {
  const q = query.trim().replace(/^@/, "");
  if (q.length < 2) return [];
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const rows = await db()
    .selectDistinct({
      id: workspaces.id,
      name: workspaces.name,
      billingMode: workspaces.billingMode,
      balance: wallets.balance,
      createdAt: workspaces.createdAt,
    })
    .from(workspaces)
    .leftJoin(wallets, eq(wallets.workspaceId, workspaces.id))
    .leftJoin(threadsProfiles, eq(threadsProfiles.workspaceId, workspaces.id))
    .leftJoin(memberships, eq(memberships.workspaceId, workspaces.id))
    .leftJoin(users, eq(users.id, memberships.userId))
    .where(
      or(
        ilike(threadsProfiles.username, like),
        ilike(workspaces.name, like),
        ilike(users.email, like),
        eq(workspaces.stripeCustomerId, q),
        eq(threadsProfiles.id, q),
        UUID.test(q) ? eq(workspaces.id, q) : undefined,
      ),
    )
    .orderBy(desc(workspaces.createdAt))
    .limit(limit);
  const profiles = rows.length
    ? await db()
        .select({ workspaceId: threadsProfiles.workspaceId, username: threadsProfiles.username })
        .from(threadsProfiles)
        .where(
          inArray(
            threadsProfiles.workspaceId,
            rows.map((r) => r.id),
          ),
        )
    : [];
  return rows.map((row) => ({
    ...row,
    balance: row.balance ?? 0,
    usernames: profiles.filter((p) => p.workspaceId === row.id).map((p) => p.username),
  }));
}

export async function workspaceDetail(workspaceId: string) {
  if (!UUID.test(workspaceId)) return null;
  const [workspace] = await db().select().from(workspaces).where(eq(workspaces.id, workspaceId));
  if (!workspace) return null;
  const actor = alias(users, "actor");
  const [wallet, lots, profiles, members, ledger, recent] = await Promise.all([
    db().select().from(wallets).where(eq(wallets.workspaceId, workspaceId)),
    db()
      .select({ open: count(), remaining: sql<number>`coalesce(sum(${creditLots.remaining}), 0)::int` })
      .from(creditLots)
      .where(and(eq(creditLots.workspaceId, workspaceId), gt(creditLots.remaining, 0))),
    db()
      .select({
        id: threadsProfiles.id,
        username: threadsProfiles.username,
        name: threadsProfiles.name,
        lastSyncedAt: threadsProfiles.lastSyncedAt,
        connected: sql<boolean>`${threadsTokens.profileId} is not null`,
      })
      .from(threadsProfiles)
      .leftJoin(threadsTokens, eq(threadsTokens.profileId, threadsProfiles.id))
      .where(eq(threadsProfiles.workspaceId, workspaceId)),
    db()
      .select({
        id: users.id,
        email: users.email,
        emailVerifiedAt: users.emailVerifiedAt,
        isStaff: users.isStaff,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.workspaceId, workspaceId)),
    db()
      .select({
        id: creditLedger.id,
        kind: creditLedger.kind,
        delta: creditLedger.delta,
        ref: creditLedger.ref,
        note: creditLedger.note,
        actor: actor.threadsUserId,
        createdAt: creditLedger.createdAt,
      })
      .from(creditLedger)
      .leftJoin(actor, eq(actor.id, creditLedger.actorUserId))
      .where(eq(creditLedger.workspaceId, workspaceId))
      .orderBy(desc(creditLedger.createdAt))
      .limit(50),
    db()
      .select({
        id: generations.id,
        model: generations.model,
        status: generations.status,
        billingMode: generations.billingMode,
        creditsCharged: generations.creditsCharged,
        costUsd: generations.costUsd,
        error: generations.error,
        createdAt: generations.createdAt,
      })
      .from(generations)
      .innerJoin(threadsProfiles, eq(threadsProfiles.id, generations.profileId))
      .where(eq(threadsProfiles.workspaceId, workspaceId))
      .orderBy(desc(generations.createdAt))
      .limit(20),
  ]);
  return {
    workspace,
    wallet: wallet[0] ?? { balance: 0, reserved: 0 },
    lots: lots[0] ?? { open: 0, remaining: 0 },
    profiles,
    members,
    ledger,
    generations: recent.map((g) => ({ ...g, costUsd: g.costUsd === null ? null : Number(g.costUsd) })),
  };
}

export type WorkspaceDetail = NonNullable<Awaited<ReturnType<typeof workspaceDetail>>>;
