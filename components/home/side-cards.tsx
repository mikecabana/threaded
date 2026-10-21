import { CalendarClock, Flame } from "lucide-react";
import { type PostAuthor, PostPreview } from "@/components/threads/post-preview";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { BestTime, RankedPost } from "@/lib/analysis/summary";
import { hourLabel, weekdayName } from "@/lib/analysis/time";
import { formatMetric, timeAgo } from "@/lib/format";
import { GOAL_META, type Goal } from "@/lib/goals";
import { Countdown } from "./countdown";

export function BestTimeCard({ best, goal, now }: { best: BestTime | null; goal: Goal; now: Date }) {
  return (
    <Card className="relative overflow-hidden">
      <div
        aria-hidden
        className="absolute -top-16 -right-16 size-48 rounded-full opacity-25 blur-2xl"
        style={{ background: "radial-gradient(closest-side, var(--accent), transparent)" }}
      />
      <CardHeader>
        <CardTitle>Best time to post {best?.day ?? "today"}</CardTitle>
        <Flame className="size-4 text-accent" aria-hidden />
      </CardHeader>
      <CardContent className="pt-3">
        {best ? (
          <>
            <p className="font-semibold text-3xl tracking-tight">{best.label}</p>
            <p className="mt-1 text-muted text-sm">
              <Countdown to={best.startsAt} serverNow={now.toISOString()} /> · from your{" "}
              {GOAL_META[goal].short.toLowerCase()} history
            </p>
          </>
        ) : (
          <p className="text-muted text-sm">Post a few more times and we'll find your best hours.</p>
        )}
      </CardContent>
    </Card>
  );
}

export function UpNextCard({
  author,
  post,
  now,
}: {
  author: PostAuthor;
  /** `startsAt` adds a live countdown (real scheduled posts). */
  post: { text: string; label: string; startsAt?: string };
  now: Date;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Up next</CardTitle>
        <Badge variant="outline">
          <CalendarClock /> {post.label}
        </Badge>
      </CardHeader>
      <CardContent className="pt-4">
        <PostPreview author={author} text={post.text} clamp={4} />
        {post.startsAt && (
          <p className="mt-3 text-subtle text-xs">
            Posts <Countdown to={post.startsAt} serverNow={now.toISOString()} />, even if you're offline.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Demo personas describe their next post by weekday and hour. */
export const demoSlotLabel = (slot: { weekday: number; hour: number }) =>
  `${weekdayName(slot.weekday)} ${hourLabel(slot.hour)}`;

export function TopPostsCard({
  author,
  posts,
  goal,
  now,
}: {
  author: PostAuthor;
  posts: RankedPost[];
  goal: Goal;
  now: Date;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>What's working for {GOAL_META[goal].short.toLowerCase()}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 pt-4">
        {posts.map(({ post, outperformance }) => (
          <PostPreview
            key={post.id}
            author={author}
            text={post.text}
            insights={post.insights}
            clamp={2}
            meta={
              <>
                {outperformance >= 1.2 && (
                  <Badge variant="positive">{formatMetric(outperformance, "multiplier")} views</Badge>
                )}
                <span className="text-xs">{timeAgo(post.timestamp, now)}</span>
              </>
            }
          />
        ))}
      </CardContent>
    </Card>
  );
}
