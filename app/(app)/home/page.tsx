import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { composerConfig } from "@/components/composer/config";
import { ComposerProvider } from "@/components/composer/provider";
import { FirstSync, NoPlaysYet } from "@/components/home/empty-states";
import { KpiTile } from "@/components/home/kpi-tile";
import { PlayCard } from "@/components/home/play-card";
import { BestTimeCard, demoSlotLabel, TopPostsCard, UpNextCard } from "@/components/home/side-cards";
import { Reveal, Stagger, StaggerItem } from "@/components/motion/reveal";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { bestTimeToPost, buildKpis, topPosts } from "@/lib/analysis/summary";
import { zonedParts } from "@/lib/analysis/time";
import { listSuggestions } from "@/lib/data/suggestions";
import type { DemoSuggestion } from "@/lib/demo/personas";
import { GOAL_META, type Goal } from "@/lib/goals";
import { nextScheduledPost } from "@/lib/publishing/posts";
import { slotLabel } from "@/lib/publishing/slots";
import { requireViewer, type Viewer } from "@/lib/session/viewer";
import { latestSyncRun } from "@/lib/sync/sync";

export const metadata: Metadata = { title: "Home" };

export default function HomePage() {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <HomeContent />
    </Suspense>
  );
}

/** The best recent ideas for the goal: saved ones first, then by goal fit. */
async function accountPlays(profileId: string, goal: Goal) {
  const recent = await listSuggestions(profileId, { statuses: ["saved", "new"], goal, sinceDays: 7, limit: 20 });
  return recent
    .sort((a, b) => Number(b.status === "saved") - Number(a.status === "saved") || b.goalFit - a.goalFit)
    .slice(0, 3);
}

function greeting(hour: number): string {
  if (hour < 5) return "Up late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

async function HomeContent() {
  const viewer = await requireViewer();
  const { profile, data, goal, now, timezone } = viewer;
  const author = profile;
  const firstName = profile.name.split(" ")[0];
  if (data.posts.length === 0) {
    // Until the first sync has finished, The Read is where it plays out.
    const run = viewer.kind === "account" ? await latestSyncRun(profile.id) : null;
    if (viewer.kind === "account" && run?.status !== "succeeded") redirect("/onboarding/analyzing");
    return <FirstSync firstName={firstName} />;
  }

  const kpis = buildKpis(goal, data.posts, data.days, now);
  const best = bestTimeToPost(goal, data.posts, timezone, now);
  const top = topPosts(goal, data.posts, now);
  // Account ideas carry an id, so they can be scheduled; the demo's samples can't.
  const plays: { play: DemoSuggestion; id?: string }[] =
    viewer.kind === "demo"
      ? viewer.persona.suggestions[goal].map((play) => ({ play }))
      : (await accountPlays(profile.id, goal)).map((play) => ({ play, id: play.id }));
  const upNext = await upNextFor(viewer);
  // Remount the staggered groups when what they show changes, so new items animate in.
  const revealKey = `${profile.id}:${goal}`;

  const content = (
    <div className="mx-auto max-w-6xl">
      <Reveal className="mb-6">
        <h1 className="font-semibold text-2xl tracking-tight sm:text-3xl">
          {greeting(zonedParts(now, timezone).hour)}, {firstName}
        </h1>
        <p className="mt-1 text-muted">
          Working toward <span className="text-accent">{GOAL_META[goal].label.toLowerCase()}</span>.{" "}
          {GOAL_META[goal].pitch}
        </p>
      </Reveal>

      <Stagger key={`kpis:${revealKey}`} className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Key metrics">
        {kpis.map((kpi, i) => (
          <StaggerItem key={kpi.id}>
            <KpiTile kpi={kpi} northStar={i === 0} />
          </StaggerItem>
        ))}
      </Stagger>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-labelledby="plays-heading">
          <div className="mb-3 flex items-center gap-2">
            <h2 id="plays-heading" className="font-semibold text-lg">
              Today's plays
            </h2>
            {viewer.kind === "demo" && <Badge>Sample</Badge>}
          </div>
          {plays.length > 0 ? (
            <Stagger key={`plays:${revealKey}`} className="grid gap-4" delay={0.15}>
              {plays.map(({ play, id }) => (
                <StaggerItem key={play.text}>
                  <PlayCard author={author} play={play} suggestionId={id} />
                </StaggerItem>
              ))}
            </Stagger>
          ) : (
            <NoPlaysYet goal={goal} />
          )}
        </section>

        <Stagger key={`side:${revealKey}`} className="flex flex-col gap-4" delay={0.25}>
          <StaggerItem>
            <BestTimeCard best={best} goal={goal} now={now} />
          </StaggerItem>
          {upNext && (
            <StaggerItem>
              <UpNextCard author={author} post={upNext} now={now} />
            </StaggerItem>
          )}
          <StaggerItem>
            <TopPostsCard author={author} posts={top} goal={goal} now={now} />
          </StaggerItem>
        </Stagger>
      </div>
    </div>
  );
  const composer = viewer.kind === "account" ? composerConfig(viewer) : null;
  return composer ? <ComposerProvider config={composer}>{content}</ComposerProvider> : content;
}

/** The next post going out: the account's soonest scheduled post, or the demo's sample. */
async function upNextFor(viewer: Viewer) {
  if (viewer.kind === "demo") {
    const { upNext } = viewer.persona;
    return { text: upNext.text, label: demoSlotLabel(upNext) };
  }
  const next = await nextScheduledPost(viewer.profile.id, viewer.now);
  if (!next) return null;
  return {
    text: next.text,
    label: slotLabel(next.scheduledFor, viewer.timezone, viewer.now),
    startsAt: next.scheduledFor.toISOString(),
  };
}

function HomeSkeleton() {
  return (
    <div className="mx-auto max-w-6xl" aria-busy>
      <Skeleton className="mb-2 h-8 w-64" />
      <Skeleton className="mb-6 h-5 w-96 max-w-full" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32 rounded-2xl" />
        ))}
      </div>
      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid gap-4">
          <Skeleton className="h-64 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-36 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
