import { Dna } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { type ReactNode, Suspense } from "react";
import { FormatTopicMatrixTable } from "@/components/insights/format-topic-matrix";
import { Heatmap } from "@/components/insights/heatmap";
import { PostTable } from "@/components/insights/post-table";
import { TrendChart } from "@/components/insights/trend-chart";
import { Reveal } from "@/components/motion/reveal";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { METRIC_PHRASE } from "@/lib/analysis/facts";
import {
  followersLine,
  followersTrend,
  formatTopicMatrix,
  heatmapLine,
  matrixLine,
  postRows,
  postsLine,
  viewsLine,
  viewsTrend,
  weekHeatmap,
} from "@/lib/analysis/insights";
import { latestDna, loadPostFeatures } from "@/lib/data/intelligence";
import { demoFeatures } from "@/lib/demo/generate";
import { GOAL_META } from "@/lib/goals";
import { requireViewer } from "@/lib/session/viewer";

export const metadata: Metadata = { title: "Insights" };

export default function InsightsPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <Reveal className="mb-6">
        <h1 className="font-semibold text-2xl tracking-tight sm:text-3xl">Insights</h1>
        <p className="mt-1 text-muted">What your audience rewards, in plain English.</p>
      </Reveal>
      <Suspense fallback={<InsightsSkeleton />}>
        <InsightsContent />
      </Suspense>
    </div>
  );
}

/** A chart with its headline and the one line that says what it means. */
function Section({
  title,
  line,
  children,
  className,
}: {
  title: string;
  line: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Reveal className={className}>
      <Card className="h-full p-5">
        <h2 className="font-semibold">{title}</h2>
        <p className="mt-1 mb-4 text-muted text-sm leading-relaxed">{line}</p>
        {children}
      </Card>
    </Reveal>
  );
}

async function InsightsContent() {
  const viewer = await requireViewer();
  const { data, goal, now, timezone, profile } = viewer;
  if (data.posts.length === 0) {
    return (
      <Card className="flex flex-col items-start gap-4 p-6">
        <p className="text-muted leading-relaxed">
          Insights fill in once your posts are synced. If you just connected, give it a minute.
        </p>
        <Button asChild size="sm" variant="outline">
          <Link href="/home">Back to Home</Link>
        </Button>
      </Card>
    );
  }

  const [features, hasDna] =
    viewer.kind === "demo"
      ? [demoFeatures(viewer.persona), true]
      : await Promise.all([loadPostFeatures(profile.id), latestDna(profile.id).then(Boolean)]);
  const views = viewsTrend(data.days, data.posts);
  const followers = followersTrend(data.days, data.posts);
  const cells = weekHeatmap(goal, data.posts, timezone, now);
  const matrix = formatTopicMatrix(goal, data.posts, features, now);
  const rows = postRows(data.posts, features, now);
  const goalLabel = GOAL_META[goal].label.toLowerCase();

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {hasDna && (
        <Reveal className="lg:col-span-2">
          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-muted text-sm">
              <span className="font-medium text-fg">Your Profile DNA</span>: your voice and what your audience rewards,
              in one place.
            </p>
            <Button asChild size="sm" variant="outline">
              <Link href="/onboarding/dna">
                <Dna /> See your DNA
              </Link>
            </Button>
          </Card>
        </Reveal>
      )}
      <Section title="Views" line={viewsLine(data.days, data.posts)} className="lg:col-span-2">
        <TrendChart points={views} label="Views" />
      </Section>
      <Section title="Followers" line={followersLine(followers, data.posts)} className="lg:col-span-2">
        {followers.length > 1 ? (
          <TrendChart points={followers} label="Followers" format="number" zeroBased={false} />
        ) : null}
      </Section>
      <Section title="Best hours" line={heatmapLine(goal, cells)}>
        <Heatmap cells={cells} goalLabel={goalLabel} />
      </Section>
      <Section title="Formats × topics" line={matrixLine(matrix)}>
        {matrix.cells.length > 0 && (
          <FormatTopicMatrixTable
            matrix={matrix}
            metricLabel={METRIC_PHRASE[matrix.metric].baseline.replace(/^your (median |typical )?/, "")}
          />
        )}
      </Section>
      <Section title="Your posts" line={postsLine(rows)} className="lg:col-span-2">
        <PostTable rows={rows} now={now.toISOString()} />
      </Section>
    </div>
  );
}

function InsightsSkeleton() {
  return (
    <div className="grid gap-5 lg:grid-cols-2" aria-busy>
      <Skeleton className="h-72 rounded-2xl lg:col-span-2" />
      <Skeleton className="h-72 rounded-2xl lg:col-span-2" />
      <Skeleton className="h-64 rounded-2xl" />
      <Skeleton className="h-64 rounded-2xl" />
    </div>
  );
}
