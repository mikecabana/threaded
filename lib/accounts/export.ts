import "server-only";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accountDaily,
  creditLedger,
  demographics,
  emailLog,
  generations,
  postFeatures,
  postMetrics,
  posts,
  profileDna,
  scheduledPosts,
  suggestions,
  threadsProfiles,
  userSettings,
  users,
  wallets,
  workspaces,
} from "@/lib/db/schema";
import type { AccountIdentity } from "@/lib/session/identity";

// "Download my data" in Settings (and the right to data portability under
// Quebec's Law 25): everything Threaded keeps about an account, as one JSON
// file. Secrets (the Threads token, an AI Gateway key) and internal ids that
// mean nothing outside Threaded are left out.

export const EXPORT_FORMAT = "threaded-export.v1";

const iso = (date: Date | null | undefined) => date?.toISOString() ?? null;

export async function exportAccount(identity: AccountIdentity, now = new Date()) {
  const { userId, workspaceId, profileId } = identity;
  const [[user], [profile], [workspace], [wallet]] = await Promise.all([
    db().select().from(users).where(eq(users.id, userId)),
    db().select().from(threadsProfiles).where(eq(threadsProfiles.id, profileId)),
    db().select().from(workspaces).where(eq(workspaces.id, workspaceId)),
    db().select().from(wallets).where(eq(wallets.workspaceId, workspaceId)),
  ]);
  if (!user || !profile || !workspace) return null;

  const [postRows, daily, demographicRows, dna, generationRows, scheduled, ledger, settings, emails] =
    await Promise.all([
      db().select().from(posts).where(eq(posts.profileId, profileId)).orderBy(desc(posts.postedAt)),
      db().select().from(accountDaily).where(eq(accountDaily.profileId, profileId)).orderBy(asc(accountDaily.date)),
      db().select().from(demographics).where(eq(demographics.profileId, profileId)),
      db().select().from(profileDna).where(eq(profileDna.profileId, profileId)).orderBy(asc(profileDna.version)),
      db().select().from(generations).where(eq(generations.profileId, profileId)).orderBy(desc(generations.createdAt)),
      db()
        .select()
        .from(scheduledPosts)
        .where(eq(scheduledPosts.profileId, profileId))
        .orderBy(desc(scheduledPosts.scheduledFor)),
      db()
        .select()
        .from(creditLedger)
        .where(eq(creditLedger.workspaceId, workspaceId))
        .orderBy(asc(creditLedger.createdAt)),
      db().select().from(userSettings).where(eq(userSettings.userId, userId)),
      db().select().from(emailLog).where(eq(emailLog.userId, userId)).orderBy(asc(emailLog.createdAt)),
    ]);

  const postIds = postRows.map((p) => p.id);
  const generationIds = generationRows.map((g) => g.id);
  const [metrics, features, ideas] = await Promise.all([
    postIds.length
      ? db().select().from(postMetrics).where(inArray(postMetrics.postId, postIds)).orderBy(asc(postMetrics.capturedAt))
      : [],
    postIds.length ? db().select().from(postFeatures).where(inArray(postFeatures.postId, postIds)) : [],
    generationIds.length ? db().select().from(suggestions).where(inArray(suggestions.generationId, generationIds)) : [],
  ]);

  const group = <T, K>(rows: T[], key: (row: T) => K) => {
    const map = new Map<K, T[]>();
    for (const row of rows) {
      const list = map.get(key(row));
      if (list) list.push(row);
      else map.set(key(row), [row]);
    }
    return map;
  };
  const metricsByPost = group(metrics, (m) => m.postId);
  // The latest labels for each post.
  const labels = new Map<string, (typeof features)[number]>();
  for (const f of features) if ((labels.get(f.postId)?.version ?? -1) < f.version) labels.set(f.postId, f);
  const ideasByGeneration = group(ideas, (s) => s.generationId);

  return {
    format: EXPORT_FORMAT,
    exportedAt: now.toISOString(),
    account: {
      threadsUserId: profile.id,
      username: profile.username,
      name: profile.name,
      biography: profile.biography,
      profilePictureUrl: profile.profilePictureUrl,
      isVerified: profile.isVerified,
      timezone: profile.timezone,
      goal: profile.activeGoal,
      topics: profile.topics?.list ?? [],
      alertEmail: user.email,
      alertEmailConfirmedAt: iso(user.emailVerifiedAt),
      joinedAt: iso(user.createdAt),
      lastSyncedAt: iso(profile.lastSyncedAt),
    },
    settings: { models: settings[0]?.modelPicks ?? null, voice: settings[0]?.voicePrefs ?? null },
    billing: {
      mode: workspace.billingMode,
      ownKeyLast4: workspace.byokKeyLast4,
      plan: workspace.stripeSubscriptionId
        ? {
            status: workspace.subscriptionStatus,
            periodEnd: iso(workspace.subscriptionPeriodEnd),
            endsAtPeriodEnd: workspace.subscriptionCancelAtPeriodEnd,
          }
        : null,
      autoRecharge: workspace.autoRecharge,
      credits: { balance: wallet?.balance ?? 0, reserved: wallet?.reserved ?? 0 },
      ledger: ledger.map((row) => ({ at: iso(row.createdAt), change: row.delta, kind: row.kind, note: row.note })),
    },
    posts: postRows.map((post) => {
      const label = labels.get(post.id);
      return {
        id: post.id,
        postedAt: iso(post.postedAt),
        text: post.text,
        mediaType: post.mediaType,
        permalink: post.permalink,
        isQuotePost: post.isQuotePost,
        topicTag: post.topicTag,
        postedWithThreaded: post.viaThreaded,
        labels: label ? { format: label.format, topic: label.topic, hook: label.hookType, tone: label.tone } : null,
        insights: (metricsByPost.get(post.id) ?? []).map(
          ({ capturedAt, views, likes, replies, reposts, quotes, shares }) => ({
            capturedAt: iso(capturedAt),
            views,
            likes,
            replies,
            reposts,
            quotes,
            shares,
          }),
        ),
      };
    }),
    accountInsights: daily.map(({ profileId: _, ...day }) => day),
    audience: demographicRows.map((row) => ({
      capturedAt: iso(row.capturedAt),
      breakdown: row.breakdown,
      data: row.data,
    })),
    profileDna: dna.map((row) => ({
      version: row.version,
      generatedAt: iso(row.generatedAt),
      model: row.model,
      dna: row.data,
    })),
    studio: generationRows.map((generation) => ({
      createdAt: iso(generation.createdAt),
      goal: generation.goal,
      model: generation.model,
      request: generation.steer,
      status: generation.status,
      creditsCharged: generation.creditsCharged,
      research: generation.research
        ? {
            queries: generation.research.queries,
            brief: generation.research.brief,
            sources: generation.research.sources,
            threadsSummary: generation.research.conversation ?? null,
            threadsPosts: generation.research.threads ?? [],
          }
        : null,
      ideas: (ideasByGeneration.get(generation.id) ?? []).map((idea) => ({
        text: idea.text,
        format: idea.format,
        hook: idea.hook,
        why: idea.rationale,
        goalFit: idea.goalFit,
        bestSlot: idea.bestSlot,
        status: idea.status,
        postedAs: idea.postedMediaId,
        performanceVsUsual: idea.perfVsBaseline === null ? null : Number(idea.perfVsBaseline),
      })),
    })),
    scheduledPosts: scheduled.map((post) => ({
      text: post.text,
      seriesParts: post.seriesParts.map((part) => part.text),
      topicTag: post.topicTag,
      scheduledFor: iso(post.scheduledFor),
      status: post.status,
      publishedAt: iso(post.publishedAt),
      permalink: post.permalink,
      lastError: post.lastError,
      createdAt: iso(post.createdAt),
    })),
    emailsSent: emails.map((email) => ({ at: iso(email.createdAt), kind: email.kind, status: email.status })),
  };
}

export type AccountExport = NonNullable<Awaited<ReturnType<typeof exportAccount>>>;
