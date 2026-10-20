"use client";

import { ArrowUpRight, Bookmark, BookmarkCheck, Clock, X } from "lucide-react";
import { m } from "motion/react";
import { CopyButton } from "@/components/app/copy-button";
import { GoalFitRing } from "@/components/goal/goal-fit-ring";
import { revealSpring } from "@/components/motion/springs";
import { type PostAuthor, PostPreview } from "@/components/threads/post-preview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FORMAT_LABELS, type PostFormat } from "@/lib/analysis/formats";
import { hourLabel, weekdayName } from "@/lib/analysis/time";
import { threadsIntentUrl } from "@/lib/threads/intent";
import { THREADS_MAX_LENGTH, threadsLength } from "@/lib/threads/length";
import { cn } from "@/lib/utils";

export interface IdeaView {
  text?: string;
  format?: string;
  hook?: string;
  rationale?: string;
  goalFit?: number;
  bestSlot?: { weekday?: number; hour?: number };
}

/**
 * One idea, from its first streamed characters to a saved post. While
 * streaming, fields fill in as the model writes them; once final, the actions
 * appear.
 */
export function IdeaCard({
  author,
  idea,
  streaming,
  saved,
  onToggleSave,
  onDismiss,
}: {
  author: PostAuthor;
  idea: IdeaView;
  streaming: boolean;
  saved?: boolean;
  onToggleSave?: () => void;
  onDismiss?: () => void;
}) {
  const text = idea.text ?? "";
  const length = threadsLength(text);
  const format = idea.format && idea.format in FORMAT_LABELS ? FORMAT_LABELS[idea.format as PostFormat] : null;
  const slot = idea.bestSlot;

  return (
    <m.article
      layout
      initial={{ opacity: 0, y: 18, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: -24, scale: 0.97, transition: { duration: 0.2 } }}
      transition={revealSpring}
      aria-busy={streaming}
    >
      <Card className={cn("p-5 transition-colors", saved && "border-accent/50")}>
        <PostPreview
          author={author}
          text={text}
          meta={
            <>
              {format && <Badge variant="accent">{format}</Badge>}
              {!streaming && onDismiss && (
                <button
                  type="button"
                  onClick={onDismiss}
                  aria-label="Dismiss idea"
                  className="rounded-full p-1 text-subtle transition-colors hover:bg-surface-2 hover:text-fg"
                >
                  <X className="size-4" />
                </button>
              )}
            </>
          }
          trailing={
            streaming && <span className="ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 animate-pulse bg-accent" />
          }
        />

        {(idea.goalFit !== undefined || idea.hook) && (
          <div className="mt-4 flex items-center gap-3 border-border border-t pt-4">
            {idea.goalFit !== undefined && <GoalFitRing value={Math.round(idea.goalFit)} />}
            <div className="min-w-0 flex-1">
              {idea.hook && <p className="text-fg text-sm">{idea.hook}</p>}
              {slot?.weekday !== undefined && slot.hour !== undefined && (
                <p className="mt-0.5 flex items-center gap-1 text-subtle text-xs">
                  <Clock className="size-3" aria-hidden />
                  Best slot: {weekdayName(slot.weekday)} {hourLabel(slot.hour)}
                </p>
              )}
            </div>
            <span
              className={cn(
                "self-start font-mono text-xs tabular",
                length > THREADS_MAX_LENGTH ? "text-negative" : "text-subtle",
              )}
              title="Threads counts emoji as several characters"
            >
              {length}/{THREADS_MAX_LENGTH}
            </span>
          </div>
        )}

        {idea.rationale && (
          <p className="mt-3 rounded-xl bg-surface-2 px-3 py-2 text-muted text-sm leading-relaxed">
            <span className="font-medium text-fg">Why: </span>
            {idea.rationale}
          </p>
        )}

        {!streaming && (
          <m.div
            className="mt-4 flex flex-wrap gap-2"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={revealSpring}
          >
            <CopyButton text={text} />
            <Button asChild variant="outline" size="sm">
              <a href={threadsIntentUrl(text)} target="_blank" rel="noopener noreferrer">
                Open in Threads
                <ArrowUpRight />
              </a>
            </Button>
            {onToggleSave && (
              <Button variant={saved ? "secondary" : "outline"} size="sm" onClick={onToggleSave} aria-pressed={saved}>
                {saved ? <BookmarkCheck /> : <Bookmark />}
                {saved ? "Saved" : "Save"}
              </Button>
            )}
          </m.div>
        )}
      </Card>
    </m.article>
  );
}
