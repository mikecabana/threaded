import { ArrowUpRight, CalendarClock, Clock } from "lucide-react";
import { CopyButton } from "@/components/app/copy-button";
import { ComposeButton } from "@/components/composer/provider";
import { GoalFitRing } from "@/components/goal/goal-fit-ring";
import type { PostAuthor } from "@/components/threads/post-preview";
import { SeriesPreview, seriesParts } from "@/components/threads/series-preview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FORMAT_LABELS } from "@/lib/analysis/formats";
import { hourLabel, weekdayName } from "@/lib/analysis/time";
import type { DemoSuggestion } from "@/lib/demo/personas";
import { threadsIntentUrl } from "@/lib/threads/intent";

/**
 * A ready-to-post suggestion: Threads-style preview, goal fit, the why, and
 * actions. Account ideas (with an id) can be scheduled where posting is set up.
 */
export function PlayCard({
  author,
  play,
  suggestionId,
}: {
  author: PostAuthor;
  play: DemoSuggestion;
  suggestionId?: string;
}) {
  const posts = [play.text, ...(play.parts ?? [])];
  return (
    <Card className="p-5">
      <SeriesPreview
        author={author}
        parts={seriesParts(suggestionId ?? play.text, posts)}
        clamp={posts.length > 1 ? 3 : undefined}
        meta={<Badge variant="accent">{FORMAT_LABELS[play.format]}</Badge>}
      />
      <div className="mt-4 flex items-center gap-3 border-border border-t pt-4">
        <GoalFitRing value={play.goalFit} />
        <div className="min-w-0">
          <p className="text-fg text-sm">{play.hook}</p>
          <p className="mt-0.5 flex items-center gap-1 text-subtle text-xs">
            <Clock className="size-3" aria-hidden />
            Best slot: {weekdayName(play.bestSlot.weekday)} {hourLabel(play.bestSlot.hour)}
          </p>
        </div>
      </div>
      <p className="mt-3 rounded-xl bg-surface-2 px-3 py-2 text-muted text-sm leading-relaxed">
        <span className="font-medium text-fg">Why: </span>
        {play.rationale}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <CopyButton text={posts.join("\n\n")} />
        {suggestionId && (
          <ComposeButton draft={{ text: play.text, seriesParts: play.parts, suggestionId, ideaSlot: play.bestSlot }}>
            <CalendarClock /> Schedule
          </ComposeButton>
        )}
        <Button asChild variant="outline" size="sm">
          <a href={threadsIntentUrl(play.text)} target="_blank" rel="noopener noreferrer">
            Open in Threads
            <ArrowUpRight />
          </a>
        </Button>
      </div>
    </Card>
  );
}
