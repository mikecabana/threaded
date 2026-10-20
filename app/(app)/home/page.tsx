import type { Metadata } from "next";
import { Suspense } from "react";
import { KpiTile } from "@/components/home/kpi-tile";
import { PlayCard } from "@/components/home/play-card";
import { BestTimeCard, TopPostsCard, UpNextCard } from "@/components/home/side-cards";
import { Reveal, Stagger, StaggerItem } from "@/components/motion/reveal";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { bestTimeToPost, buildKpis, topPosts } from "@/lib/analysis/summary";
import { zonedParts } from "@/lib/analysis/time";
import { GOAL_META } from "@/lib/goals";
import { requireViewer } from "@/lib/session/viewer";

export const metadata: Metadata = { title: "Home" };

export default function HomePage() {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <HomeContent />
    </Suspense>
  );
}

function greeting(hour: number): string {
  if (hour < 5) return "Up late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

async function HomeContent() {
  const viewer = await requireViewer();
  const { persona, data, goal, now, timezone } = viewer;
  const author = { ...persona.profile, avatarHue: persona.avatarHue };
  const kpis = buildKpis(goal, data.posts, data.days, now);
  const best = bestTimeToPost(goal, data.posts, timezone, now);
  const top = topPosts(goal, data.posts, now);
  const firstName = persona.profile.name.split(" ")[0];
  // Remount the staggered groups when what they show changes, so new items animate in.
  const revealKey = `${persona.id}:${goal}`;

  return (
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
          <Stagger key={`plays:${revealKey}`} className="grid gap-4" delay={0.15}>
            {persona.suggestions[goal].map((play) => (
              <StaggerItem key={play.text}>
                <PlayCard author={author} play={play} />
              </StaggerItem>
            ))}
          </Stagger>
        </section>

        <Stagger key={`side:${revealKey}`} className="flex flex-col gap-4" delay={0.25}>
          <StaggerItem>
            <BestTimeCard best={best} goal={goal} now={now} />
          </StaggerItem>
          <StaggerItem>
            <UpNextCard author={author} post={persona.upNext} />
          </StaggerItem>
          <StaggerItem>
            <TopPostsCard author={author} posts={top} goal={goal} now={now} />
          </StaggerItem>
        </Stagger>
      </div>
    </div>
  );
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
